import { DEMO_CHANNELS, DEMO_CAMPAIGNS } from './seed.js';
import { ConflictError, NotFoundError } from './errors.js';

/**
 * Almacén en memoria con la misma interfaz que el de PostgreSQL.
 * Se usa en las pruebas y en desarrollo local sin base de datos. Los datos se pierden al reiniciar.
 */
export function createMemoryStore() {
  let seq = 0;
  const id = () => ++seq;
  const now = () => new Date().toISOString();
  const db = { users: [], workspaces: [], memberships: [], sessions: new Map(), channels: [], campaigns: [], workflows: [] };
  const clone = (x) => structuredClone(x);
  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });
  const campaignOut = (c) => {
    const versions = db.workflows.filter((w) => w.campaignId === c.id);
    const { workspaceId, ...rest } = c;
    return clone({ ...rest, workflowVersion: versions.length ? Math.max(...versions.map((w) => w.version)) : 0 });
  };

  function seedWorkspace(workspaceId) {
    const chIds = DEMO_CHANNELS.map((ch) => {
      const row = { id: id(), workspaceId, provider: 'youtube', isDemo: true, createdAt: now(), ...clone(ch) };
      db.channels.push(row);
      return row.id;
    });
    for (const { channel, ...c } of DEMO_CAMPAIGNS) {
      db.campaigns.push({ id: id(), workspaceId, channelId: chIds[channel], createdAt: now(), updatedAt: now(), ...clone(c) });
    }
  }

  return {
    kind: 'memory',
    async migrate() {},
    async close() {},
    async health() { return true; },
    async countUsers() { return db.users.length; },

    async createUser({ email, name, passwordHash, workspaceName, joinWorkspaceId }) {
      if (db.users.some((u) => u.email === email)) throw new ConflictError('Ya existe un usuario con ese correo.');
      const user = { id: id(), email, name, passwordHash, createdAt: now(), lastLoginAt: null };
      let workspace = joinWorkspaceId ? db.workspaces.find((w) => w.id === joinWorkspaceId) : null;
      if (joinWorkspaceId && !workspace) throw new NotFoundError('Espacio de trabajo no encontrado.');
      db.users.push(user);
      if (!workspace) {
        workspace = { id: id(), name: workspaceName || 'Mi espacio de trabajo', createdAt: now() };
        db.workspaces.push(workspace);
        seedWorkspace(workspace.id);
      }
      const role = db.memberships.some((m) => m.workspaceId === workspace.id) ? 'editor' : 'owner';
      db.memberships.push({ userId: user.id, workspaceId: workspace.id, role });
      return { user: publicUser(user), workspace: { id: workspace.id, name: workspace.name, role } };
    },
    async findUserByEmail(email) { const u = db.users.find((x) => x.email === email); return u ? clone(u) : null; },
    async setPassword(userId, passwordHash) {
      const u = db.users.find((x) => x.id === userId);
      if (!u) throw new NotFoundError('Usuario no encontrado.');
      u.passwordHash = passwordHash;
      for (const [k, s] of db.sessions) if (s.userId === userId) db.sessions.delete(k);
    },
    async touchLogin(userId) { const u = db.users.find((x) => x.id === userId); if (u) u.lastLoginAt = now(); },
    async listWorkspaces() {
      return db.workspaces.map((w) => ({ id: w.id, name: w.name, members: db.memberships.filter((m) => m.workspaceId === w.id).length }));
    },
    async defaultWorkspaceFor(userId) {
      const m = db.memberships.find((x) => x.userId === userId);
      if (!m) return null;
      const w = db.workspaces.find((x) => x.id === m.workspaceId);
      return { id: w.id, name: w.name, role: m.role };
    },

    async createSession(s) { db.sessions.set(s.tokenHash, { ...s, expiresAt: new Date(s.expiresAt).toISOString() }); },
    async getSession(tokenHash) {
      const s = db.sessions.get(tokenHash);
      if (!s || new Date(s.expiresAt) <= new Date()) return null;
      const u = db.users.find((x) => x.id === s.userId);
      const m = db.memberships.find((x) => x.userId === s.userId && x.workspaceId === s.workspaceId);
      const w = db.workspaces.find((x) => x.id === s.workspaceId);
      if (!u || !m || !w) return null;
      return { user: publicUser(u), workspace: { id: w.id, name: w.name, role: m.role }, expiresAt: s.expiresAt };
    },
    async deleteSession(tokenHash) { db.sessions.delete(tokenHash); },
    async purgeExpiredSessions() { for (const [k, s] of db.sessions) if (new Date(s.expiresAt) <= new Date()) db.sessions.delete(k); },

    async listChannels(ws) { return db.channels.filter((c) => c.workspaceId === ws).map(({ workspaceId, ...c }) => clone(c)); },
    async getChannel(ws, chId) { const c = db.channels.find((x) => x.workspaceId === ws && x.id === chId); if (!c) return null; const { workspaceId, ...rest } = c; return clone(rest); },

    async listCampaigns(ws) { return db.campaigns.filter((c) => c.workspaceId === ws).map(campaignOut); },
    async getCampaign(ws, cId) { const c = db.campaigns.find((x) => x.workspaceId === ws && x.id === cId); return c ? campaignOut(c) : null; },
    async createCampaign(ws, data) {
      const row = { id: id(), workspaceId: ws, metrics: {}, createdAt: now(), updatedAt: now(), ...clone(data) };
      db.campaigns.push(row);
      return campaignOut(row);
    },
    async updateCampaign(ws, cId, patch) {
      const c = db.campaigns.find((x) => x.workspaceId === ws && x.id === cId);
      if (!c) return null;
      Object.assign(c, clone(patch), { updatedAt: now() });
      return campaignOut(c);
    },

    async getWorkflow(ws, cId) {
      if (!db.campaigns.some((x) => x.workspaceId === ws && x.id === cId)) return null;
      const versions = db.workflows.filter((w) => w.campaignId === cId).sort((a, b) => b.version - a.version);
      if (!versions.length) return { version: 0, nodes: null, savedAt: null, savedBy: null };
      const v = versions[0];
      return { version: v.version, nodes: clone(v.nodes), savedAt: v.createdAt, savedBy: db.users.find((u) => u.id === v.createdBy)?.name || null };
    },
    async saveWorkflow(ws, cId, { nodes, userId, baseVersion }) {
      const current = await this.getWorkflow(ws, cId);
      if (!current) throw new NotFoundError('Campaña no encontrada.');
      if (baseVersion !== undefined && baseVersion !== current.version) {
        throw new ConflictError('Alguien guardó una versión más reciente de este flujo. Recarga para ver los cambios.', { currentVersion: current.version });
      }
      if (current.nodes && JSON.stringify(current.nodes) === JSON.stringify(nodes)) return { ...current, unchanged: true };
      const row = { campaignId: cId, version: current.version + 1, nodes: clone(nodes), createdBy: userId, createdAt: now() };
      db.workflows.push(row);
      return this.getWorkflow(ws, cId);
    }
  };
}
