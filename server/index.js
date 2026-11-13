import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const assetsDir = path.join(publicDir, 'assets');
const indexFile = path.join(publicDir, 'index.html');
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
 * options.auth: { user, pass } — si se define, todo el panel pide usuario y contraseña
 * (excepto /api/health, que usan el despliegue y el monitoreo).
 */
export function createServer(options = {}) {
  const auth = options.auth?.user && options.auth?.pass ? options.auth : null;
  const startedAt = new Date().toISOString();
  const version = options.version || 'dev';

  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    function json(status, data) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
    }

    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { return json(400, { error: 'invalid_path' }); }

    if (pathname === '/api/health' && ['GET', 'HEAD'].includes(req.method)) {
      return json(200, { status: 'ok', app: 'golddigger', mode: 'demo', integrationsConnected: false, version, startedAt });
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

    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      return json(405, { error: 'method_not_allowed', message: 'Esta base no ofrece operaciones de producción.' });
    }
    if (pathname.startsWith('/api/')) return json(501, { error: 'not_implemented', message: 'Implementar este servicio en el backend. No hay proveedores conectados.' });
    if (pathname === '/favicon.ico') { res.writeHead(301, { Location: '/assets/favicon.svg' }); return res.end(); }
    if (pathname.includes('\0') || pathname.includes('\\')) return json(400, { error: 'invalid_path' });

    const file = path.resolve(publicDir, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(publicDir + path.sep)) return json(403, { error: 'forbidden' });
    // Solo se entregan index.html y public/assets. Nunca archivos del servidor ni secretos.
    if (file !== indexFile && !file.startsWith(assetsDir + path.sep)) return json(404, { error: 'not_found' });

    try {
      const bytes = await readFile(file);
      const etag = '"' + createHash('sha1').update(bytes).digest('base64url') + '"';
      // no-cache = el navegador revalida siempre: cada despliegue se ve al instante, y si nada cambió responde 304 sin reenviar el archivo.
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'no-cache');
      if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': bytes.length });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      json(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500, { error: 'file_unavailable' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Carga .env automáticamente si existe (local: ./.env; en el VPS systemd ya entrega las variables).
  try { process.loadEnvFile(); } catch { /* sin .env */ }
  const port = Number(process.env.PORT || 3010);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un puerto válido.');
  const auth = { user: process.env.GD_AUTH_USER, pass: process.env.GD_AUTH_PASS };
  let version = process.env.GD_VERSION;
  try { version ||= readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim(); } catch { version ||= 'dev'; }
  const server = createServer({ auth, version });
  server.listen(port, host, () => {
    console.log(`Golddigger disponible en http://${host}:${port}${auth.user && auth.pass ? ' (con contraseña)' : ''}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
