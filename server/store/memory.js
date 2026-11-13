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
  const db = { users: [], workspaces: [], memberships: [], sessions: new Map(), channels: [], campaigns: [], workflows: [], integrations: [] };
  const clone = (x) => structuredClone(x);
  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });
  const channelOut = (c) => {
    const { workspaceId, oauthEnc, ...rest } = c;
    return clone({ externalId: null, handle: null, thumbnailUrl: null, connectedAt: null, lastSyncedAt: null, lastError: null, ...rest, connected: Boolean(oauthEnc) });
  };
  const integrationOut = (i) => {
    const { workspaceId, secretEnc, updatedById, ...rest } = i;
    return clone({ ...rest, updatedBy: db.users.find((u) => u.id === updatedById)?.name || null });
  };
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
      db.campaigns.push({ id: id(), workspaceId, channelId: chIds[channel], isDemo: true, createdAt: now(), updatedAt: now(), ...clone(c) });
    }
  }

  return {
    kind: 'memory',
    async migrate() {},
    async close() {},
    async health() { return true; },
    async countUsers() { return db.users.length; },

    async createUser({ email, name, passwordHash, workspaceName, joinWorkspaceId, role: wantedRole }) {
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
      const hasMembers = db.memberships.some((m) => m.workspaceId === workspace.id);
      const role = !hasMembers ? 'owner' : wantedRole || 'editor';
      db.memberships.push({ userId: user.id, workspaceId: workspace.id, role, createdAt: now() });
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

    async listMembers(ws) {
      return db.memberships.filter((m) => m.workspaceId === ws).map((m) => {
        const u = db.users.find((x) => x.id === m.userId);
        return { id: u.id, name: u.name, email: u.email, role: m.role, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt };
      }).sort((a, b) => a.id - b.id);
    },
    async setMemberRole(ws, userId, role) {
      const m = db.memberships.find((x) => x.workspaceId === ws && x.userId === userId);
      if (!m) return null;
      if (m.role === 'owner' && role !== 'owner' && db.memberships.filter((x) => x.workspaceId === ws && x.role === 'owner').length === 1) {
        throw new ConflictError('El espacio debe conservar al menos un propietario.');
      }
      m.role = role;
      return (await this.listMembers(ws)).find((x) => x.id === userId);
    },
    async removeMember(ws, userId) {
      const m = db.memberships.find((x) => x.workspaceId === ws && x.userId === userId);
      if (!m) return false;
      if (m.role === 'owner' && db.memberships.filter((x) => x.workspaceId === ws && x.role === 'owner').length === 1) {
        throw new ConflictError('El espacio debe conservar al menos un propietario.');
      }
      db.memberships.splice(db.memberships.indexOf(m), 1);
      for (const [k, sess] of db.sessions) if (sess.userId === userId && sess.workspaceId === ws) db.sessions.delete(k);
      if (!db.memberships.some((x) => x.userId === userId)) db.users = db.users.filter((u) => u.id !== userId);
      return true;
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

    async listChannels(ws) { return db.channels.filter((c) => c.workspaceId === ws).map(channelOut); },
    async getChannel(ws, chId) { const c = db.channels.find((x) => x.workspaceId === ws && x.id === chId); return c ? channelOut(c) : null; },

    async createChannel(ws, { name, niche, mark, theme }) {
      const row = { id: id(), workspaceId: ws, name, niche, mark, theme, provider: 'youtube', isDemo: false, metrics: {}, createdAt: now() };
      db.channels.push(row);
      return channelOut(row);
    },
    async clearDemoData(ws) {
      const demoCamps = db.campaigns.filter((c) => c.workspaceId === ws && c.isDemo).map((c) => c.id);
      db.campaigns = db.campaigns.filter((c) => !demoCamps.includes(c.id));
      db.workflows = db.workflows.filter((w) => !demoCamps.includes(w.campaignId));
      const before = db.channels.length;
      db.channels = db.channels.filter((ch) => !(ch.workspaceId === ws && ch.isDemo && !db.campaigns.some((c) => c.channelId === ch.id)));
      let keptChannels = 0;
      for (const ch of db.channels) if (ch.workspaceId === ws && ch.isDemo) { ch.isDemo = false; ch.metrics = {}; keptChannels++; }
      return { campaigns: demoCamps.length, channels: before - db.channels.length, keptChannels };
    },

    async listIntegrations(ws) { return db.integrations.filter((i) => i.workspaceId === ws).map(integrationOut).sort((a, b) => a.provider.localeCompare(b.provider)); },
    async getIntegration(ws, provider) { const i = db.integrations.find((x) => x.workspaceId === ws && x.provider === provider); return i ? { ...integrationOut(i), secretEnc: i.secretEnc } : null; },
    async saveIntegration(ws, provider, { config = {}, secretEnc, secretHint, status = 'connected', lastError = null, accountLabel = null, userId }) {
      let i = db.integrations.find((x) => x.workspaceId === ws && x.provider === provider);
      if (!i) { i = { workspaceId: ws, provider }; db.integrations.push(i); }
      Object.assign(i, { config: clone(config), status, lastError, accountLabel, updatedById: userId || null, lastCheckedAt: now(), updatedAt: now() });
      if (secretEnc) { i.secretEnc = secretEnc; i.secretHint = secretHint; }
      return integrationOut(i);
    },
    async markIntegration(ws, provider, { status, lastError = null, accountLabel }) {
      const i = db.integrations.find((x) => x.workspaceId === ws && x.provider === provider);
      if (!i) return null;
      Object.assign(i, { status, lastError, lastCheckedAt: now() });
      if (accountLabel) i.accountLabel = accountLabel;
      return integrationOut(i);
    },
    async deleteIntegration(ws, provider) {
      const n = db.integrations.length;
      db.integrations = db.integrations.filter((x) => !(x.workspaceId === ws && x.provider === provider));
      return db.integrations.length < n;
    },
    async connectChannel(ws, { channelId, externalId, name, handle, thumbnailUrl, metrics, oauthEnc, userId }) {
      const byExternal = db.channels.find((c) => c.workspaceId === ws && c.provider === 'youtube' && c.externalId === externalId);
      let ch;
      if (channelId) {
        ch = db.channels.find((c) => c.workspaceId === ws && c.id === channelId);
        if (!ch) throw new NotFoundError('Canal no encontrado.');
        if (byExternal && byExternal.id !== channelId) throw new ConflictError(`Ese canal de YouTube ya está conectado como «${byExternal.name}».`);
      } else ch = byExternal;
      if (!ch) {
        ch = { id: id(), workspaceId: ws, niche: '', theme: '', provider: 'youtube', isDemo: false, createdAt: now(), name,
          mark: name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'YT' };
        db.channels.push(ch);
      } else if (ch.isDemo || ch.externalId) ch.name = name;
      Object.assign(ch, { externalId, handle, thumbnailUrl, metrics: clone(metrics), oauthEnc, connectedAt: now(), connectedBy: userId, lastSyncedAt: now(), lastError: null, isDemo: false });
      return channelOut(ch);
    },
    async getChannelOAuth(ws, chId) { const c = db.channels.find((x) => x.workspaceId === ws && x.id === chId); return c ? { oauthEnc: c.oauthEnc || null, externalId: c.externalId || null } : null; },
    async updateChannelSync(ws, chId, { name, handle, thumbnailUrl, metrics, lastError = null, oauthEnc }) {
      const c = db.channels.find((x) => x.workspaceId === ws && x.id === chId);
      if (!c) return null;
      if (name) c.name = name; if (handle) c.handle = handle; if (thumbnailUrl) c.thumbnailUrl = thumbnailUrl;
      if (metrics) c.metrics = clone(metrics); if (oauthEnc) c.oauthEnc = oauthEnc;
      c.lastError = lastError;
      if (!lastError) c.lastSyncedAt = now();
      return channelOut(c);
    },
    async disconnectChannel(ws, chId) {
      const c = db.channels.find((x) => x.workspaceId === ws && x.id === chId);
      if (!c) return null;
      Object.assign(c, { oauthEnc: null, externalId: null, connectedAt: null, connectedBy: null, lastError: null, metrics: {} });
      return channelOut(c);
    },

    async listCampaigns(ws) { return db.campaigns.filter((c) => c.workspaceId === ws).map(campaignOut); },
    async getCampaign(ws, cId) { const c = db.campaigns.find((x) => x.workspaceId === ws && x.id === cId); return c ? campaignOut(c) : null; },
    async createCampaign(ws, data) {
      const row = { id: id(), workspaceId: ws, metrics: {}, isDemo: false, createdAt: now(), updatedAt: now(), ...clone(data) };
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
