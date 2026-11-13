import { hashPassword, verifyPassword, newSessionToken, hashToken, parseCookies, sessionCookie, clearedCookie,
  SESSION_COOKIE, SESSION_DAYS, LoginLimiter } from './auth.js';
import { validateCampaign, validateWorkflow, validateCredentials, validateNewPassword, ValidationError } from './validate.js';
import { defaultFlow } from './catalog.js';

const MAX_BODY = 256 * 1024;

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

async function readJson(req) {
  const type = req.headers['content-type'] || '';
  // Exigir JSON bloquea envíos de formularios desde otros sitios (CSRF): el navegador no puede mandar este tipo sin permiso CORS.
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Se esperaba JSON.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'La solicitud es demasiado grande.');
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'JSON inválido.'); }
}

function clientIp(req) {
  // El servidor solo escucha en 127.0.0.1 detrás de Nginx, que fija X-Real-IP.
  return String(req.headers['x-real-ip'] || req.socket.remoteAddress || '').slice(0, 64);
}

function isSecure(req, forceSecure) {
  return forceSecure || req.headers['x-forwarded-proto'] === 'https';
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const intId = (s) => {
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(404, 'No encontrado.');
  return n;
};

/**
 * Crea el manejador de /api/*. Devuelve una función (req, res, pathname, json) que resuelve la ruta.
 * store === null significa que falta configurar la base de datos en producción.
 */
export function createApi({ store, secureCookies = false, limiter = new LoginLimiter() }) {
  const routes = [];
  const route = (method, pattern, handler, { auth = true } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, auth });
  };

  async function currentSession(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token || token.length > 100) return null;
    return store.getSession(hashToken(token));
  }

  // ── Autenticación ─────────────────────────────────────────────────────────
  route('POST', '/api/auth/login', async ({ req, res }) => {
    const { email, password } = validateCredentials(await readJson(req));
    const ip = clientIp(req);
    if (limiter.blocked(ip, email)) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
    const user = await store.findUserByEmail(email);
    const ok = await verifyPassword(password, user?.passwordHash);
    if (!user || !ok) {
      limiter.fail(ip, email);
      throw new HttpError(401, 'Correo o contraseña incorrectos.');
    }
    limiter.reset(ip, email);
    const workspace = await store.defaultWorkspaceFor(user.id);
    if (!workspace) throw new HttpError(403, 'Tu usuario no pertenece a ningún espacio de trabajo.');
    const { token, tokenHash } = newSessionToken();
    await store.createSession({
      tokenHash, userId: user.id, workspaceId: workspace.id,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400 * 1000), userAgent: req.headers['user-agent'], ip
    });
    await store.touchLogin(user.id);
    store.purgeExpiredSessions().catch(() => {});
    res.setHeader('Set-Cookie', sessionCookie(token, { secure: isSecure(req, secureCookies) }));
    return { user: { id: user.id, email: user.email, name: user.name }, workspace };
  }, { auth: false });

  route('POST', '/api/auth/logout', async ({ req, res }) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await store.deleteSession(hashToken(token));
    res.setHeader('Set-Cookie', clearedCookie({ secure: isSecure(req, secureCookies) }));
    return { ok: true };
  }, { auth: false });

  route('GET', '/api/auth/me', async ({ session }) => ({ user: session.user, workspace: session.workspace }));

  route('POST', '/api/auth/password', async ({ req, res, session }) => {
    const body = await readJson(req);
    const user = await store.findUserByEmail(session.user.email);
    if (!(await verifyPassword(String(body.current || ''), user?.passwordHash))) throw new HttpError(400, 'La contraseña actual no es correcta.', { field: 'current' });
    await store.setPassword(session.user.id, await hashPassword(validateNewPassword(body.password)));
    // Cambiar la contraseña cierra todas las sesiones; se abre una nueva para este navegador.
    const { token, tokenHash } = newSessionToken();
    await store.createSession({ tokenHash, userId: session.user.id, workspaceId: session.workspace.id,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400 * 1000), userAgent: req.headers['user-agent'], ip: clientIp(req) });
    res.setHeader('Set-Cookie', sessionCookie(token, { secure: isSecure(req, secureCookies) }));
    return { ok: true };
  });

  // ── Canales y campañas ────────────────────────────────────────────────────
  route('GET', '/api/channels', async ({ session }) => ({ channels: await store.listChannels(session.workspace.id) }));

  route('GET', '/api/campaigns', async ({ session }) => ({ campaigns: await store.listCampaigns(session.workspace.id) }));

  route('POST', '/api/campaigns', async ({ req, res, session }) => {
    const data = validateCampaign(await readJson(req));
    if (!(await store.getChannel(session.workspace.id, data.channelId))) throw new HttpError(400, 'El canal no existe.', { field: 'channelId' });
    res.statusCode = 201;
    return { campaign: await store.createCampaign(session.workspace.id, data) };
  });

  route('GET', '/api/campaigns/:id', async ({ params, session }) => {
    const c = await store.getCampaign(session.workspace.id, intId(params.id));
    if (!c) throw new HttpError(404, 'Campaña no encontrada.');
    return { campaign: c };
  });

  route('PATCH', '/api/campaigns/:id', async ({ req, params, session }) => {
    const patch = validateCampaign(await readJson(req), { partial: true });
    if (patch.channelId && !(await store.getChannel(session.workspace.id, patch.channelId))) throw new HttpError(400, 'El canal no existe.', { field: 'channelId' });
    const c = await store.updateCampaign(session.workspace.id, intId(params.id), patch);
    if (!c) throw new HttpError(404, 'Campaña no encontrada.');
    return { campaign: c };
  });

  // ── Flujos (versionados) ──────────────────────────────────────────────────
  route('GET', '/api/campaigns/:id/workflow', async ({ params, session }) => {
    const wf = await store.getWorkflow(session.workspace.id, intId(params.id));
    if (!wf) throw new HttpError(404, 'Campaña no encontrada.');
    return { workflow: wf.nodes ? wf : { ...wf, nodes: defaultFlow(), isDefault: true } };
  });

  route('PUT', '/api/campaigns/:id/workflow', async ({ req, params, session }) => {
    const body = await readJson(req);
    const nodes = validateWorkflow(body.nodes);
    const baseVersion = body.baseVersion === undefined ? undefined : Number(body.baseVersion);
    const wf = await store.saveWorkflow(session.workspace.id, intId(params.id), { nodes, userId: session.user.id, baseVersion });
    return { workflow: wf };
  });

  return async function handle(req, res, pathname, json) {
    try {
      if (!store) return json(503, { error: 'database_not_configured', message: 'Falta configurar la base de datos en el servidor.' });
      const candidates = routes.filter((r) => r.re.test(pathname));
      if (!candidates.length) return json(404, { error: 'not_found', message: 'Ruta no encontrada.' });
      const r = candidates.find((x) => x.method === req.method);
      if (!r) { res.setHeader('Allow', candidates.map((x) => x.method).join(', ')); return json(405, { error: 'method_not_allowed' }); }
      if (req.method !== 'GET' && !sameOrigin(req)) return json(403, { error: 'forbidden', message: 'Origen no permitido.' });
      const m = pathname.match(r.re);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      let session = null;
      if (r.auth) {
        session = await currentSession(req);
        if (!session) return json(401, { error: 'unauthorized', message: 'Inicia sesión para continuar.' });
      }
      const out = await r.handler({ req, res, params, session });
      return json(res.statusCode && res.statusCode !== 200 ? res.statusCode : 200, out);
    } catch (err) {
      if (err instanceof ValidationError || err instanceof HttpError || err.status) {
        const { status = 400, message, field, currentVersion } = err;
        return json(status, { error: status === 409 ? 'conflict' : status === 400 ? 'invalid' : 'error', message, field, currentVersion });
      }
      console.error('Error en la API:', err);
      return json(500, { error: 'server_error', message: 'Ocurrió un error en el servidor. Inténtalo de nuevo.' });
    }
  };
}
