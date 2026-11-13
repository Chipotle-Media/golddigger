import { readdir, readFile } from 'node:fs/promises';
import { DEMO_CHANNELS, DEMO_CAMPAIGNS } from './seed.js';
import { ConflictError, NotFoundError } from './errors.js';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

const CAMPAIGN_COLUMNS = {
  channelId: 'channel_id', name: 'name', niche: 'niche', references: '"references"', format: 'format', days: 'days', time: 'time',
  budgetMonthly: 'budget_monthly', maxPerPiece: 'max_per_piece', scriptTool: 'script_tool', clipsTool: 'clips_tool',
  instructions: 'instructions', autoPublish: 'auto_publish', status: 'status', metrics: 'metrics'
};

const CAMPAIGN_SELECT = `
  SELECT c.id, c.channel_id, c.name, c.niche, c."references", c.format, c.days, c.time, c.budget_monthly, c.max_per_piece,
         c.script_tool, c.clips_tool, c.instructions, c.auto_publish, c.status, c.metrics, c.created_at, c.updated_at,
         COALESCE((SELECT max(version) FROM workflow_versions w WHERE w.campaign_id = c.id), 0) AS workflow_version
  FROM campaigns c`;

const toCampaign = (r) => ({
  id: Number(r.id), channelId: Number(r.channel_id), name: r.name, niche: r.niche, references: r.references, format: r.format,
  days: r.days, time: r.time, budgetMonthly: Number(r.budget_monthly), maxPerPiece: Number(r.max_per_piece),
  scriptTool: r.script_tool, clipsTool: r.clips_tool, instructions: r.instructions, autoPublish: r.auto_publish,
  status: r.status, metrics: r.metrics, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  workflowVersion: Number(r.workflow_version)
});
const toChannel = (r) => ({
  id: Number(r.id), name: r.name, niche: r.niche, mark: r.mark, theme: r.theme, provider: r.provider,
  isDemo: r.is_demo, metrics: r.metrics, createdAt: r.created_at.toISOString()
});

/** Almacén en PostgreSQL. El controlador `pg` se carga solo aquí, para que pruebas y modo demo no lo necesiten. */
export async function createPostgresStore(connectionString) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
  pool.on('error', (err) => console.error('PostgreSQL:', err.message));
  const q = (text, params) => pool.query(text, params);

  async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async function seedWorkspace(client, workspaceId) {
    const chIds = [];
    for (const ch of DEMO_CHANNELS) {
      const { rows } = await client.query(
        `INSERT INTO channels (workspace_id, name, niche, mark, theme, is_demo, metrics) VALUES ($1,$2,$3,$4,$5,true,$6) RETURNING id`,
        [workspaceId, ch.name, ch.niche, ch.mark, ch.theme, ch.metrics]);
      chIds.push(rows[0].id);
    }
    for (const c of DEMO_CAMPAIGNS) {
      await client.query(
        `INSERT INTO campaigns (workspace_id, channel_id, name, niche, "references", format, days, time, budget_monthly, max_per_piece,
           script_tool, clips_tool, instructions, auto_publish, status, metrics)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [workspaceId, chIds[c.channel], c.name, c.niche, c.references, c.format, c.days, c.time, c.budgetMonthly, c.maxPerPiece,
          c.scriptTool, c.clipsTool, c.instructions, c.autoPublish, c.status, c.metrics]);
    }
  }

  return {
    kind: 'postgres',

    /** Aplica en orden las migraciones nuevas de server/migrations, cada una en su transacción, con bloqueo para no correr dos veces. */
    async migrate() {
      const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
      await tx(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(727274)');
        await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
        const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
        for (const f of files) {
          if (done.has(f)) continue;
          await c.query(await readFile(new URL(f, MIGRATIONS_DIR), 'utf8'));
          await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
          console.log(`Migración aplicada: ${f}`);
        }
      });
    },
    async close() { await pool.end(); },
    async health() { await q('SELECT 1'); return true; },
    async countUsers() { return Number((await q('SELECT count(*) FROM users')).rows[0].count); },

    async createUser({ email, name, passwordHash, workspaceName, joinWorkspaceId }) {
      return tx(async (c) => {
        if ((await c.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email])).rowCount) {
          throw new ConflictError('Ya existe un usuario con ese correo.');
        }
        const user = (await c.query('INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id, email, name',
          [email, name, passwordHash])).rows[0];
        let workspace;
        if (joinWorkspaceId) {
          workspace = (await c.query('SELECT id, name FROM workspaces WHERE id = $1', [joinWorkspaceId])).rows[0];
          if (!workspace) throw new NotFoundError('Espacio de trabajo no encontrado.');
        } else {
          workspace = (await c.query('INSERT INTO workspaces (name) VALUES ($1) RETURNING id, name', [workspaceName || 'Mi espacio de trabajo'])).rows[0];
          await seedWorkspace(c, workspace.id);
        }
        const hasMembers = (await c.query('SELECT 1 FROM memberships WHERE workspace_id = $1', [workspace.id])).rowCount > 0;
        const role = hasMembers ? 'editor' : 'owner';
        await c.query('INSERT INTO memberships (user_id, workspace_id, role) VALUES ($1,$2,$3)', [user.id, workspace.id, role]);
        return { user: { id: Number(user.id), email: user.email, name: user.name }, workspace: { id: Number(workspace.id), name: workspace.name, role } };
      });
    },
    async findUserByEmail(email) {
      const r = (await q('SELECT id, email, name, password_hash FROM users WHERE lower(email) = lower($1)', [email])).rows[0];
      return r ? { id: Number(r.id), email: r.email, name: r.name, passwordHash: r.password_hash } : null;
    },
    async setPassword(userId, passwordHash) {
      await tx(async (c) => {
        const r = await c.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
        if (!r.rowCount) throw new NotFoundError('Usuario no encontrado.');
        await c.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      });
    },
    async touchLogin(userId) { await q('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]); },
    async listWorkspaces() {
      return (await q(`SELECT w.id, w.name, count(m.user_id)::int AS members FROM workspaces w
                       LEFT JOIN memberships m ON m.workspace_id = w.id GROUP BY w.id ORDER BY w.id`)).rows
        .map((r) => ({ id: Number(r.id), name: r.name, members: r.members }));
    },
    async defaultWorkspaceFor(userId) {
      const r = (await q(`SELECT w.id, w.name, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
                          WHERE m.user_id = $1 ORDER BY m.created_at LIMIT 1`, [userId])).rows[0];
      return r ? { id: Number(r.id), name: r.name, role: r.role } : null;
    },

    async createSession({ tokenHash, userId, workspaceId, expiresAt, userAgent, ip }) {
      await q('INSERT INTO sessions (token_hash, user_id, workspace_id, expires_at, user_agent, ip) VALUES ($1,$2,$3,$4,$5,$6)',
        [tokenHash, userId, workspaceId, expiresAt, userAgent?.slice(0, 300) || null, ip || null]);
    },
    async getSession(tokenHash) {
      const r = (await q(`SELECT s.expires_at, u.id AS user_id, u.email, u.name, w.id AS workspace_id, w.name AS workspace_name, m.role
                          FROM sessions s JOIN users u ON u.id = s.user_id JOIN workspaces w ON w.id = s.workspace_id
                          JOIN memberships m ON m.user_id = s.user_id AND m.workspace_id = s.workspace_id
                          WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash])).rows[0];
      if (!r) return null;
      return {
        user: { id: Number(r.user_id), email: r.email, name: r.name },
        workspace: { id: Number(r.workspace_id), name: r.workspace_name, role: r.role },
        expiresAt: r.expires_at.toISOString()
      };
    },
    async deleteSession(tokenHash) { await q('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]); },
    async purgeExpiredSessions() { await q('DELETE FROM sessions WHERE expires_at <= now()'); },

    async listChannels(ws) { return (await q('SELECT * FROM channels WHERE workspace_id = $1 ORDER BY id', [ws])).rows.map(toChannel); },
    async getChannel(ws, id) { const r = (await q('SELECT * FROM channels WHERE workspace_id = $1 AND id = $2', [ws, id])).rows[0]; return r ? toChannel(r) : null; },

    async listCampaigns(ws) { return (await q(`${CAMPAIGN_SELECT} WHERE c.workspace_id = $1 ORDER BY c.id`, [ws])).rows.map(toCampaign); },
    async getCampaign(ws, id) { const r = (await q(`${CAMPAIGN_SELECT} WHERE c.workspace_id = $1 AND c.id = $2`, [ws, id])).rows[0]; return r ? toCampaign(r) : null; },
    async createCampaign(ws, data) {
      const keys = Object.keys(CAMPAIGN_COLUMNS).filter((k) => data[k] !== undefined);
      const cols = keys.map((k) => CAMPAIGN_COLUMNS[k]);
      const { rows } = await q(`INSERT INTO campaigns (workspace_id, ${cols.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
        [ws, ...keys.map((k) => data[k])]);
      return this.getCampaign(ws, Number(rows[0].id));
    },
    async updateCampaign(ws, id, patch) {
      const keys = Object.keys(CAMPAIGN_COLUMNS).filter((k) => patch[k] !== undefined);
      if (!keys.length) return this.getCampaign(ws, id);
      const sets = keys.map((k, i) => `${CAMPAIGN_COLUMNS[k]} = $${i + 3}`);
      const r = await q(`UPDATE campaigns SET ${sets.join(', ')}, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
        [ws, id, ...keys.map((k) => patch[k])]);
      return r.rowCount ? this.getCampaign(ws, id) : null;
    },

    async getWorkflow(ws, campaignId) {
      if (!(await q('SELECT 1 FROM campaigns WHERE workspace_id = $1 AND id = $2', [ws, campaignId])).rowCount) return null;
      const r = (await q(`SELECT v.version, v.nodes, v.created_at, u.name AS saved_by FROM workflow_versions v
                          LEFT JOIN users u ON u.id = v.created_by WHERE v.campaign_id = $1 ORDER BY v.version DESC LIMIT 1`, [campaignId])).rows[0];
      if (!r) return { version: 0, nodes: null, savedAt: null, savedBy: null };
      return { version: r.version, nodes: r.nodes, savedAt: r.created_at.toISOString(), savedBy: r.saved_by };
    },
    async saveWorkflow(ws, campaignId, { nodes, userId, baseVersion }) {
      const result = await tx(async (c) => {
        const camp = await c.query('SELECT id FROM campaigns WHERE workspace_id = $1 AND id = $2 FOR UPDATE', [ws, campaignId]);
        if (!camp.rowCount) throw new NotFoundError('Campaña no encontrada.');
        // jsonb reordena las claves: la comparación se hace en la base, no como texto.
        const last = (await c.query('SELECT version, nodes = $2::jsonb AS same FROM workflow_versions WHERE campaign_id = $1 ORDER BY version DESC LIMIT 1',
          [campaignId, JSON.stringify(nodes)])).rows[0];
        const current = last ? last.version : 0;
        if (baseVersion !== undefined && baseVersion !== current) {
          throw new ConflictError('Alguien guardó una versión más reciente de este flujo. Recarga para ver los cambios.', { currentVersion: current });
        }
        if (last?.same) return { unchanged: true };
        await c.query('INSERT INTO workflow_versions (campaign_id, version, nodes, created_by) VALUES ($1,$2,$3,$4)',
          [campaignId, current + 1, JSON.stringify(nodes), userId]);
        return { unchanged: false };
      });
      const wf = await this.getWorkflow(ws, campaignId);
      return result.unchanged ? { ...wf, unchanged: true } : wf;
    }
  };
}
