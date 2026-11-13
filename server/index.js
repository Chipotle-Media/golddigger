import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.js';

const publicDir = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const assetsDir = path.join(publicDir, 'assets');
const indexFile = path.join(publicDir, 'index.html');
// Páginas públicas (sin sesión): las exige Google para la pantalla de consentimiento OAuth.
const legalPages = { '/privacidad': 'privacidad.html', '/privacy': 'privacidad.html', '/terminos': 'terminos.html', '/terms': 'terminos.html',
  '/assets/legal.css': 'assets/legal.css', '/assets/favicon.svg': 'assets/favicon.svg' };
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

function safeEqual(a, b) {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}

/**
 * options.store: almacén de datos (memoria o PostgreSQL). null = base sin configurar (la API responde 503).
 * options.auth: { user, pass } — contraseña HTTP básica opcional. Solo para el modo sin base de datos;
 *               con PostgreSQL el acceso lo controla el inicio de sesión propio.
 * options.secureCookies: forzar cookies Secure (además se detecta X-Forwarded-Proto: https).
 */
export function createServer(options = {}) {
  const store = options.store === undefined ? null : options.store;
  const auth = options.auth?.user && options.auth?.pass ? options.auth : null;
  const startedAt = new Date().toISOString();
  const version = options.version || 'dev';
  const api = createApi({ store, secureCookies: options.secureCookies, vault: options.vault || null, fetchImpl: options.fetchImpl || fetch, publicUrl: options.publicUrl || null });

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://yt3.ggpht.com https://yt3.googleusercontent.com https://*.ytimg.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    function json(status, data) {
      if (res.headersSent) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
    }

    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { return json(400, { error: 'invalid_path' }); }

    if (pathname === '/api/health' && ['GET', 'HEAD'].includes(req.method)) {
      let database = store ? store.kind : 'sin_configurar';
      if (store) {
        try { await store.health(); } catch { database = 'error'; }
      }
      return json(database === 'error' ? 503 : 200, { status: database === 'error' ? 'degraded' : 'ok', app: 'golddigger', database, version, startedAt });
    }

    if (legalPages[pathname] && ['GET', 'HEAD'].includes(req.method)) {
      try {
        const bytes = await readFile(path.join(publicDir, legalPages[pathname]));
        res.writeHead(200, { 'Content-Type': types[path.extname(legalPages[pathname])], 'Content-Length': bytes.length, 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : bytes);
      } catch { return json(404, { error: 'not_found' }); }
    }

    if (auth) {
      const header = req.headers.authorization || '';
      const [scheme, encoded] = header.split(' ');
      let ok = false;
      if (scheme === 'Basic' && encoded) {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        const i = decoded.indexOf(':');
        const userOk = safeEqual(decoded.slice(0, i), auth.user);
        const passOk = safeEqual(decoded.slice(i + 1), auth.pass);
        ok = i > 0 && userOk && passOk;
      }
      if (!ok) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Golddigger", charset="UTF-8"');
        return json(401, { error: 'unauthorized' });
      }
    }

    if (pathname.startsWith('/api/')) return api(req, res, pathname, json);

    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      return json(405, { error: 'method_not_allowed' });
    }
    if (pathname === '/favicon.ico') { res.writeHead(301, { Location: '/assets/favicon.svg' }); return res.end(); }
    if (pathname.includes('\0') || pathname.includes('\\')) return json(400, { error: 'invalid_path' });

    const file = path.resolve(publicDir, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(publicDir + path.sep)) return json(403, { error: 'forbidden' });
    // Solo se entregan index.html y public/assets. Nunca archivos del servidor ni secretos.
    if (file !== indexFile && !file.startsWith(assetsDir + path.sep)) return json(404, { error: 'not_found' });

    try {
      const bytes = await readFile(file);
      const etag = '"' + createHash('sha1').update(bytes).digest('base64url') + '"';
      // no-cache = el navegador revalida siempre: cada despliegue se ve al instante, y si nada cambió responde 304.
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'no-cache');
      if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': bytes.length });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      json(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500, { error: 'file_unavailable' });
    }
  });
  server.connections = api.connections;
  return server;
}

async function main() {
  // Carga .env automáticamente si existe (local: ./.env; en el VPS systemd ya entrega las variables).
  try { process.loadEnvFile(); } catch { /* sin .env */ }
  const { createStoreFromEnv } = await import('./store/index.js');
  const port = Number(process.env.PORT || 3010);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un puerto válido.');

  let version = process.env.GD_VERSION;
  try { version ||= readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim(); } catch { version ||= 'dev'; }

  const store = await createStoreFromEnv();
  if (!store) console.warn('⚠ Falta DATABASE_URL: el panel mostrará que la base de datos no está configurada.');
  if (store?.kind === 'memory' && !(await store.countUsers())) {
    const { hashPassword } = await import('./auth.js');
    await store.createUser({ email: 'admin@golddigger.local', name: 'Administrador', passwordHash: await hashPassword('golddigger-dev'), workspaceName: 'Espacio de desarrollo' });
    console.log('Modo desarrollo (datos en memoria). Entra con admin@golddigger.local / golddigger-dev');
  }

  // Con base de datos real, el inicio de sesión propio sustituye la contraseña HTTP básica.
  const useBasic = !store || store.kind === 'memory';
  const auth = useBasic ? { user: process.env.GD_AUTH_USER, pass: process.env.GD_AUTH_PASS } : null;
  let vault = null;
  if (store) {
    const { vaultFromEnv } = await import('./vault.js');
    vault = vaultFromEnv();
  }
  const server = createServer({ store, auth, version, vault, publicUrl: process.env.GD_PUBLIC_URL || null, secureCookies: process.env.NODE_ENV === 'production' });

  // Actualiza estadísticas de los canales de YouTube conectados cada 6 horas.
  if (store && server.connections) {
    const syncAll = async () => {
      for (const w of await store.listWorkspaces().catch(() => [])) {
        for (const ch of (await store.listChannels(w.id)).filter((c) => c.connected)) {
          const fresh = await server.connections.syncChannel(w.id, ch.id).catch((e) => { console.error('Sincronización de YouTube:', e.message); return null; });
          // Política de YouTube: no conservar datos de la API más de 30 días sin renovarlos.
          const last = (fresh || ch).lastSyncedAt;
          if (!last || Date.now() - new Date(last) > 30 * 864e5) await store.updateChannelSync(w.id, ch.id, { metrics: {}, lastError: (fresh || ch).lastError || 'Sin actualizar por más de 30 días; se borraron sus estadísticas.' });
        }
      }
    };
    setTimeout(syncAll, 60 * 1000).unref();
    setInterval(syncAll, 6 * 3600 * 1000).unref();
  }
  server.listen(port, host, () => {
    console.log(`Golddigger ${version} en http://${host}:${port} · datos: ${store ? store.kind : 'sin configurar'}${auth?.user && auth?.pass ? ' · con contraseña HTTP' : ''}`);
  });
  const stop = () => server.close(async () => { await store?.close(); process.exit(0); });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error('No se pudo iniciar Golddigger:', err.message); process.exit(1); });
}
