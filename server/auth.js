import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const N = 32768, R = 8, P = 1, KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

export const SESSION_COOKIE = 'gd_session';
export const SESSION_DAYS = 30;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

// Hash fijo para comparar cuando el usuario no existe: misma duración, sin revelar qué correos están registrados.
const DUMMY = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + Buffer.alloc(KEYLEN).toString('base64url');

export async function verifyPassword(password, stored) {
  const [alg, n, r, p, salt, hash] = String(stored || DUMMY).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scryptAsync(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length,
    { N: +n, r: +r, p: +p, maxmem: 128 * +n * +r * 2 });
  return stored ? timingSafeEqual(key, expected) : false;
}

export function newSessionToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

/** En la base solo se guarda el hash del token: una copia filtrada de la tabla no sirve para entrar. */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { secure, maxAgeDays = SESSION_DAYS }) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.round(maxAgeDays * 86400)}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearedCookie({ secure }) {
  return sessionCookie('', { secure, maxAgeDays: 0 });
}

/** Límite de intentos de inicio de sesión por IP y por correo (en memoria; suficiente para un solo proceso). */
export class LoginLimiter {
  constructor({ max = 10, windowMs = 15 * 60 * 1000 } = {}) { this.max = max; this.windowMs = windowMs; this.hits = new Map(); }
  #keys(ip, email) { return [`ip:${ip}`, `em:${email}`]; }
  blocked(ip, email) {
    const now = Date.now();
    return this.#keys(ip, email).some((k) => {
      const h = this.hits.get(k);
      if (!h || now - h.start > this.windowMs) return false;
      return h.count >= this.max;
    });
  }
  fail(ip, email) {
    const now = Date.now();
    for (const k of this.#keys(ip, email)) {
      const h = this.hits.get(k);
      if (!h || now - h.start > this.windowMs) this.hits.set(k, { start: now, count: 1 });
      else h.count++;
    }
    if (this.hits.size > 10000) for (const [k, h] of this.hits) if (now - h.start > this.windowMs) this.hits.delete(k);
  }
  reset(ip, email) { for (const k of this.#keys(ip, email)) this.hits.delete(k); }
}
