import { randomBytes } from 'node:crypto';
import { catalog } from './catalog.js';
import { testProvider, apiKeyProviders } from './providers.js';
import { hint } from './vault.js';
import * as yt from './youtube.js';

const GOOGLE = 'google_oauth';
const STATE_TTL = 10 * 60 * 1000;

/**
 * Rutas de Conexiones: llaves de proveedores, cliente OAuth de Google y canales de YouTube.
 * Las credenciales se guardan cifradas y nunca salen del servidor.
 */
export function registerConnectionRoutes(route, { store, vault, fetchImpl, HttpError, readJson, publicUrl, currentSession }) {
  const pending = new Map(); // state → { userId, workspaceId, channelId, redirectUri, expires }
  const ownerOnly = (session) => {
    if (session.workspace.role !== 'owner') throw new HttpError(403, 'Solo un propietario puede administrar las conexiones.');
  };
  const needVault = () => { if (!vault) throw new HttpError(503, 'El servidor no tiene llave de cifrado configurada.'); };

  const redirectUriFor = (req) => {
    if (publicUrl) return publicUrl.replace(/\/$/, '') + '/api/youtube/callback';
    const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    return `${proto}://${req.headers.host}/api/youtube/callback`;
  };

  async function googleClient(ws) {
    const g = await store.getIntegration(ws, GOOGLE);
    if (!g?.secretEnc || !g.config?.clientId) return null;
    return { clientId: g.config.clientId, clientSecret: vault.decrypt(g.secretEnc) };
  }

  async function overview(req, session) {
    const saved = new Map((await store.listIntegrations(session.workspace.id)).map((i) => [i.provider, i]));
    const channels = await store.listChannels(session.workspace.id);
    const g = saved.get(GOOGLE);
    return {
      canManage: session.workspace.role === 'owner',
      providers: catalog.providers.map((p) => {
        if (p.id === 'youtube') {
          const connected = channels.filter((c) => c.connected);
          return { id: p.id, status: connected.length ? (connected.some((c) => c.lastError) ? 'error' : 'connected') : 'disconnected', channels: connected.length };
        }
        const i = saved.get(p.id);
        return i ? { id: p.id, status: i.status, secretHint: i.secretHint, accountLabel: i.accountLabel, lastError: i.lastError, lastCheckedAt: i.lastCheckedAt, updatedBy: i.updatedBy }
          : { id: p.id, status: p.kind === 'unavailable' ? 'unavailable' : 'disconnected' };
      }),
      google: {
        configured: Boolean(g?.secretHint && g?.config?.clientId),
        clientId: g?.config?.clientId || null,
        secretHint: g?.secretHint || null,
        status: g?.status || null,
        lastError: g?.lastError || null,
        redirectUri: redirectUriFor(req),
        origin: new URL(redirectUriFor(req)).origin
      },
      channels: channels.map(({ metrics, ...c }) => ({ ...c, metrics }))
    };
  }

  route('GET', '/api/integrations', async ({ req, session }) => overview(req, session));

  // ── Llaves de API ──
  route('PUT', '/api/integrations/:provider', async ({ req, params, session }) => {
    ownerOnly(session); needVault();
    const provider = params.provider;
    if (!apiKeyProviders().includes(provider)) throw new HttpError(404, 'Proveedor no soportado.');
    const body = await readJson(req);
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (key.length < 8 || key.length > 400 || /\s/.test(key)) throw new HttpError(400, 'Pega la llave completa, sin espacios.', { field: 'key' });
    const result = await testProvider(provider, key, fetchImpl);
    if (!result.ok && !body.force) throw new HttpError(400, result.error, { field: 'key', canForce: true });
    await store.saveIntegration(session.workspace.id, provider, {
      secretEnc: vault.encrypt(key), secretHint: hint(key), status: result.ok ? 'connected' : 'error',
      lastError: result.ok ? null : result.error, accountLabel: result.label || null, userId: session.user.id
    });
    return overview(req, session);
  });

  route('POST', '/api/integrations/:provider/test', async ({ req, params, session }) => {
    needVault();
    const i = await store.getIntegration(session.workspace.id, params.provider);
    if (!i?.secretEnc || !apiKeyProviders().includes(params.provider)) throw new HttpError(404, 'Esa conexión no está configurada.');
    let key;
    try { key = vault.decrypt(i.secretEnc); } catch { throw new HttpError(409, 'No se pudo descifrar la llave guardada. Vuelve a capturarla.'); }
    const result = await testProvider(params.provider, key, fetchImpl);
    await store.markIntegration(session.workspace.id, params.provider, { status: result.ok ? 'connected' : 'error', lastError: result.ok ? null : result.error, accountLabel: result.label });
    return overview(req, session);
  });

  route('DELETE', '/api/integrations/:provider', async ({ req, params, session }) => {
    ownerOnly(session);
    if (![...apiKeyProviders(), GOOGLE].includes(params.provider)) throw new HttpError(404, 'Proveedor no soportado.');
    if (params.provider === GOOGLE && (await store.listChannels(session.workspace.id)).some((c) => c.connected)) {
      throw new HttpError(409, 'Primero desconecta los canales de YouTube que usan este cliente de Google.');
    }
    await store.deleteIntegration(session.workspace.id, params.provider);
    return overview(req, session);
  });

  // ── Cliente OAuth de Google (lo usa YouTube) ──
  route('PUT', '/api/integrations/google_oauth/client', async ({ req, session }) => {
    ownerOnly(session); needVault();
    const body = await readJson(req);
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new HttpError(400, 'El ID de cliente debe terminar en .apps.googleusercontent.com', { field: 'clientId' });
    const current = await store.getIntegration(session.workspace.id, GOOGLE);
    const secret = clientSecret || (current?.secretEnc && current.config?.clientId === clientId ? vault.decrypt(current.secretEnc) : '');
    if (!secret || secret.length < 10 || /\s/.test(secret)) throw new HttpError(400, 'Pega el secreto del cliente.', { field: 'clientSecret' });
    const check = await yt.checkClient(fetchImpl, { clientId, clientSecret: secret, redirectUri: redirectUriFor(req) });
    if (!check.ok) throw new HttpError(400, check.error, { field: 'clientSecret' });
    await store.saveIntegration(session.workspace.id, GOOGLE, {
      config: { clientId }, secretEnc: vault.encrypt(secret), secretHint: hint(secret), status: 'connected', userId: session.user.id,
      accountLabel: 'Cliente OAuth listo'
    });
    return overview(req, session);
  });

  // ── Canales de YouTube ──
  route('POST', '/api/youtube/connect', async ({ req, session }) => {
    needVault();
    const body = await readJson(req);
    const client = await googleClient(session.workspace.id);
    if (!client) throw new HttpError(409, 'Primero configura el cliente de Google Cloud en Conexiones.');
    let channelId = null;
    if (body.channelId !== undefined && body.channelId !== null) {
      channelId = Number(body.channelId);
      if (!(await store.getChannel(session.workspace.id, channelId))) throw new HttpError(404, 'Canal no encontrado.');
    }
    const now = Date.now();
    for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
    const state = randomBytes(24).toString('base64url');
    const redirectUri = redirectUriFor(req);
    pending.set(state, { userId: session.user.id, workspaceId: session.workspace.id, channelId, redirectUri, expires: now + STATE_TTL });
    return { url: yt.authUrl({ clientId: client.clientId, redirectUri, state }) };
  });

  route('GET', '/api/youtube/callback', async ({ req }) => {
    const session = await currentSession(req);
    if (!session) return { redirect: '/?' + new URLSearchParams({ yt: 'error', msg: 'Tu sesión terminó. Inicia sesión y vuelve a conectar el canal.' }) };
    const url = new URL(req.url, 'http://x');
    const state = url.searchParams.get('state') || '';
    const p = pending.get(state);
    pending.delete(state);
    const back = (status, extra = {}) => ({ redirect: '/?' + new URLSearchParams({ yt: status, ...extra }) + '#conexiones' });
    if (url.searchParams.get('error')) return back('cancelado');
    if (!p || p.expires < Date.now() || p.userId !== session.user.id || p.workspaceId !== session.workspace.id) {
      return back('error', { msg: 'La autorización expiró o no corresponde a tu sesión. Inténtalo de nuevo.' });
    }
    try {
      const client = await googleClient(p.workspaceId);
      if (!client) return back('error', { msg: 'El cliente de Google ya no está configurado.' });
      const tokens = await yt.exchangeCode(fetchImpl, { ...client, redirectUri: p.redirectUri, code: url.searchParams.get('code') || '' });
      const info = await yt.myChannel(fetchImpl, tokens.accessToken);
      const ch = await store.connectChannel(p.workspaceId, {
        channelId: p.channelId, ...info, userId: p.userId,
        oauthEnc: vault.encrypt(JSON.stringify(tokens))
      });
      return back('ok', { canal: ch.name });
    } catch (err) {
      return back('error', { msg: err.message || 'No se pudo conectar el canal.' });
    }
  }, { auth: false });

  async function syncChannel(ws, channelId) {
    const oauth = await store.getChannelOAuth(ws, channelId);
    if (!oauth?.oauthEnc) throw new HttpError(409, 'Este canal no está conectado a YouTube.');
    const client = await googleClient(ws);
    if (!client) throw new HttpError(409, 'Falta el cliente de Google Cloud.');
    let tokens = JSON.parse(vault.decrypt(oauth.oauthEnc));
    let rotated = null;
    try {
      if (!tokens.accessToken || tokens.expiresAt < Date.now()) {
        tokens = { ...tokens, ...(await yt.refreshAccess(fetchImpl, { ...client, refreshToken: tokens.refreshToken })) };
        rotated = vault.encrypt(JSON.stringify(tokens));
      }
      const info = await yt.myChannel(fetchImpl, tokens.accessToken);
      return store.updateChannelSync(ws, channelId, { name: info.name, handle: info.handle, thumbnailUrl: info.thumbnailUrl, metrics: info.metrics, oauthEnc: rotated });
    } catch (err) {
      const msg = err.code === 'invalid_grant'
        ? 'La autorización venció o fue revocada. Vuelve a conectar el canal.'
        : err.message || 'No se pudo actualizar desde YouTube.';
      return store.updateChannelSync(ws, channelId, { lastError: msg, oauthEnc: rotated });
    }
  }

  route('POST', '/api/channels/:id/sync', async ({ params, session }) => {
    needVault();
    const ch = await syncChannel(session.workspace.id, Number(params.id));
    if (!ch) throw new HttpError(404, 'Canal no encontrado.');
    return { channel: ch };
  });

  route('POST', '/api/channels/:id/disconnect', async ({ params, session }) => {
    ownerOnly(session);
    const id = Number(params.id);
    const oauth = await store.getChannelOAuth(session.workspace.id, id);
    if (!oauth) throw new HttpError(404, 'Canal no encontrado.');
    if (oauth.oauthEnc && vault) {
      try { await yt.revoke(fetchImpl, JSON.parse(vault.decrypt(oauth.oauthEnc)).refreshToken); } catch { /* se borra igual */ }
    }
    return { channel: await store.disconnectChannel(session.workspace.id, id) };
  });

  return { syncChannel };
}
