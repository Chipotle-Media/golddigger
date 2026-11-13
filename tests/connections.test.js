import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from '../server/index.js';
import { createMemoryStore } from '../server/store/memory.js';
import { createVault } from '../server/vault.js';
import { hashPassword } from '../server/auth.js';

/** Proveedores simulados: responden como las APIs reales para las llaves "buenas". */
function fakeProviders() {
  const calls = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const state = { revoked: new Set() };
  async function f(url, opts = {}) {
    const u = new URL(url);
    const h = Object.fromEntries(Object.entries(opts.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push(u.host + u.pathname);
    if (u.host === 'api.anthropic.com') return h['x-api-key'] === 'sk-ant-buena-123' ? json(200, { data: [{ id: 'a' }, { id: 'b' }] }) : json(401, { error: { type: 'authentication_error' } });
    if (u.host === 'api.openai.com') return h.authorization === 'Bearer sk-openai-buena' ? json(200, { data: [{}, {}, {}] }) : json(401, {});
    if (u.host === 'generativelanguage.googleapis.com') return h['x-goog-api-key'] === 'AIza-buena-llave' ? json(200, { models: [{ name: 'models/gemini-2.5-pro' }, { name: 'models/veo-3.1-generate-preview' }] }) : json(400, { error: { status: 'INVALID_ARGUMENT' } });
    if (u.host === 'api.elevenlabs.io') return h['xi-api-key'] === 'sk_eleven_restringida' ? json(401, { detail: { status: 'missing_permissions' } }) : json(401, { detail: { status: 'invalid_api_key' } });
    if (u.host === 'api.pexels.com') return h.authorization === 'pexels-buena-llave' ? json(200, { photos: [] }) : json(401, {});
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') {
      const p = new URLSearchParams(opts.body);
      if (p.get('client_secret') !== 'GOCSPX-secreto-bueno') return json(401, { error: 'invalid_client' });
      if (p.get('grant_type') === 'refresh_token') return state.revoked.has(p.get('refresh_token')) ? json(400, { error: 'invalid_grant' }) : json(200, { access_token: 'at-renovado', expires_in: 3600 });
      if (p.get('code') === 'codigo-real') return json(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 });
      if (p.get('code') === 'codigo-real-2') return json(200, { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 });
      return json(400, { error: 'invalid_grant' });
    }
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/revoke') { state.revoked.add(new URLSearchParams(opts.body).get('token')); return json(200, {}); }
    if (u.host === 'www.googleapis.com' && u.pathname === '/youtube/v3/channels') {
      if (!['Bearer at-1', 'Bearer at-2', 'Bearer at-renovado'].includes(h.authorization)) return json(401, { error: { message: 'Invalid Credentials' } });
      const second = h.authorization === 'Bearer at-2';
      return json(200, { items: [{ id: second ? 'UC-otro' : 'UC-123', snippet: { title: second ? 'Otro Canal' : 'Mi Canal YT', customUrl: '@micanal', thumbnails: { default: { url: 'https://yt3.ggpht.com/x.jpg' } } }, statistics: { subscriberCount: '1500', viewCount: '99000', videoCount: '42' } }] });
    }
    throw new Error('URL no simulada: ' + url);
  }
  return { f, calls, state };
}

const stores = [['memoria', async () => createMemoryStore()]];
if (process.env.TEST_DATABASE_URL) {
  stores.push(['postgres', async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!/test/i.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL debe apuntar a una base de pruebas.');
    const { default: pg } = await import('pg');
    const c = new pg.Client(url); await c.connect();
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await c.end();
    const { createPostgresStore } = await import('../server/store/postgres.js');
    const s = await createPostgresStore(url); await s.migrate(); return s;
  }]);
}

for (const [label, makeStore] of stores) test(`conexiones (${label}): llaves cifradas, cliente de Google y canales de YouTube`, async (t) => {
  const store = await makeStore();
  t.after(() => store.close());
  const vault = createVault({ key: randomBytes(32) });
  const fake = fakeProviders();
  await store.createUser({ email: 'duena@example.com', name: 'Dueña', passwordHash: await hashPassword('contrasena-segura'), workspaceName: 'Panel' });
  const ws = (await store.listWorkspaces())[0].id;
  await store.createUser({ email: 'ed@example.com', name: 'Ed', passwordHash: await hashPassword('contrasena-segura'), joinWorkspaceId: ws });
  const server = createServer({ store, vault, fetchImpl: fake.f });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const session = async (email) => {
    let cookie = '';
    const call = async (method, path, body, opts = {}) => {
      const res = await fetch(base + path, { method, redirect: 'manual', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, ...opts });
      const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      const text = await res.text();
      let data = null; try { data = JSON.parse(text); } catch { /* redirección */ }
      return { status: res.status, data, text, location: res.headers.get('location') };
    };
    await call('POST', '/api/auth/login', { email, password: 'contrasena-segura' });
    return call;
  };
  const owner = await session('duena@example.com');
  const editor = await session('ed@example.com');

  // Estado inicial
  let ov = (await owner('GET', '/api/integrations')).data;
  assert.equal(ov.canManage, true);
  assert.equal(ov.google.configured, false);
  assert.match(ov.google.redirectUri, /\/api\/youtube\/callback$/);
  assert.equal(ov.providers.find((p) => p.id === 'anthropic').status, 'disconnected');
  assert.equal(ov.providers.find((p) => p.id === 'suno').status, 'unavailable');
  assert.equal((await editor('GET', '/api/integrations')).data.canManage, false);

  // Llaves de API
  assert.equal((await editor('PUT', '/api/integrations/anthropic', { key: 'sk-ant-buena-123' })).status, 403);
  assert.equal((await owner('PUT', '/api/integrations/inventado', { key: 'xxxxxxxxxx' })).status, 404);
  assert.equal((await owner('PUT', '/api/integrations/anthropic', { key: 'corta' })).status, 400);
  const bad = await owner('PUT', '/api/integrations/anthropic', { key: 'sk-ant-mala-0000' });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.canForce, true);
  assert.match(bad.data.message, /Anthropic rechazó la llave/);
  const good = await owner('PUT', '/api/integrations/anthropic', { key: 'sk-ant-buena-123' });
  assert.equal(good.status, 200);
  const a = good.data.providers.find((p) => p.id === 'anthropic');
  assert.equal(a.status, 'connected');
  assert.equal(a.secretHint, '••••-123');
  assert.equal(a.accountLabel, '2 modelos disponibles');
  assert.equal(a.updatedBy, 'Dueña');
  assert.ok(!good.text.includes('sk-ant-buena-123'), 'la llave nunca vuelve al navegador');
  const stored = await store.getIntegration(ws, 'anthropic');
  assert.ok(!stored.secretEnc.includes('sk-ant'), 'se guarda cifrada');
  assert.equal(vault.decrypt(stored.secretEnc), 'sk-ant-buena-123');
  assert.equal((await editor('POST', '/api/integrations/anthropic/test')).data.providers.find((p) => p.id === 'anthropic').status, 'connected');

  const g = (await owner('PUT', '/api/integrations/google_ai', { key: 'AIza-buena-llave' })).data.providers.find((p) => p.id === 'google_ai');
  assert.match(g.accountLabel, /Veo disponible/);
  assert.equal((await owner('PUT', '/api/integrations/elevenlabs', { key: 'sk_eleven_restringida' })).data.providers.find((p) => p.id === 'elevenlabs').accountLabel, 'Llave válida (permisos restringidos)');
  const forced = await owner('PUT', '/api/integrations/openai', { key: 'sk-openai-mala', force: true });
  assert.equal(forced.data.providers.find((p) => p.id === 'openai').status, 'error');
  assert.equal((await owner('PUT', '/api/integrations/openai', { key: 'sk-openai-buena' })).data.providers.find((p) => p.id === 'openai').status, 'connected');
  assert.equal((await owner('DELETE', '/api/integrations/pexels')).status, 200);
  assert.equal((await editor('DELETE', '/api/integrations/openai')).status, 403);

  // YouTube sin cliente de Google
  assert.equal((await owner('POST', '/api/youtube/connect', {})).status, 409);

  // Cliente OAuth de Google
  assert.equal((await owner('PUT', '/api/integrations/google_oauth/client', { clientId: 'mal', clientSecret: 'GOCSPX-secreto-bueno' })).status, 400);
  const badClient = await owner('PUT', '/api/integrations/google_oauth/client', { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-secreto-malo' });
  assert.match(badClient.data.message, /no reconoce/);
  ov = (await owner('PUT', '/api/integrations/google_oauth/client', { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-secreto-bueno' })).data;
  assert.equal(ov.google.configured, true);
  assert.equal(ov.google.clientId, '123-abc.apps.googleusercontent.com');
  // Cambiar solo el ID conserva el secreto si es el mismo cliente
  assert.equal((await owner('PUT', '/api/integrations/google_oauth/client', { clientId: '123-abc.apps.googleusercontent.com' })).status, 200);

  // Conectar un canal nuevo (un editor también puede)
  const start = await editor('POST', '/api/youtube/connect', {});
  const authUrl = new URL(start.data.url);
  assert.equal(authUrl.host, 'accounts.google.com');
  assert.equal(authUrl.searchParams.get('access_type'), 'offline');
  assert.match(authUrl.searchParams.get('scope'), /youtube\.upload/);
  const st = authUrl.searchParams.get('state');
  // El estado pertenece a quien lo pidió
  const stolen = await owner('GET', `/api/youtube/callback?state=${st}&code=codigo-real`);
  assert.match(decodeURIComponent(stolen.location.replace(/\+/g, ' ')), /no corresponde a tu sesión/);
  const start2 = await editor('POST', '/api/youtube/connect', {});
  const st2 = new URL(start2.data.url).searchParams.get('state');
  const cb = await editor('GET', `/api/youtube/callback?state=${st2}&code=codigo-real`);
  assert.equal(cb.status, 302);
  assert.match(cb.location, /yt=ok/);
  assert.match(decodeURIComponent(cb.location.replace(/\+/g, ' ')), /Mi Canal YT/);
  assert.match((await editor('GET', `/api/youtube/callback?state=${st2}&code=codigo-real`)).location, /yt=error/);
  assert.match((await editor('GET', '/api/youtube/callback?error=access_denied&state=x')).location, /yt=cancelado/);

  let channels = (await owner('GET', '/api/integrations')).data.channels;
  const yt = channels.find((c) => c.externalId === 'UC-123');
  assert.ok(yt.connected);
  assert.equal(yt.metrics.subscribers, 1500);
  assert.equal(yt.handle, '@micanal');
  const raw = (await owner('GET', '/api/channels')).text;
  assert.ok(!raw.includes('rt-1') && !raw.includes('oauthEnc'), 'los tokens no salen del servidor');
  assert.equal((await owner('GET', '/api/integrations')).data.providers.find((p) => p.id === 'youtube').channels, 1);

  // Reconectar el mismo canal no lo duplica
  const again = new URL((await owner('POST', '/api/youtube/connect', {})).data.url).searchParams.get('state');
  await owner('GET', `/api/youtube/callback?state=${again}&code=codigo-real`);
  assert.equal((await owner('GET', '/api/channels')).data.channels.filter((c) => c.externalId === 'UC-123').length, 1);

  // Vincular a un canal existente; si ese canal de YouTube ya está en otro, se rechaza
  const demo = channels.find((c) => c.isDemo);
  const linkSt = new URL((await owner('POST', '/api/youtube/connect', { channelId: demo.id })).data.url).searchParams.get('state');
  const dup = await owner('GET', `/api/youtube/callback?state=${linkSt}&code=codigo-real`);
  assert.match(decodeURIComponent(dup.location.replace(/\+/g, ' ')), /ya está conectado como «Mi Canal YT»/);
  const linkSt2 = new URL((await owner('POST', '/api/youtube/connect', { channelId: demo.id })).data.url).searchParams.get('state');
  await owner('GET', `/api/youtube/callback?state=${linkSt2}&code=codigo-real-2`);
  const linked = (await owner('GET', '/api/channels')).data.channels.find((c) => c.id === demo.id);
  assert.equal(linked.externalId, 'UC-otro');
  assert.equal(linked.name, 'Otro Canal');
  assert.equal(linked.isDemo, false);

  // Sincronizar: renueva el token vencido y actualiza estadísticas
  const oauth = await store.getChannelOAuth(ws, yt.id);
  const tokens = JSON.parse(vault.decrypt(oauth.oauthEnc));
  await store.updateChannelSync(ws, yt.id, { oauthEnc: vault.encrypt(JSON.stringify({ ...tokens, expiresAt: Date.now() - 1000 })) });
  const synced = (await editor('POST', `/api/channels/${yt.id}/sync`)).data.channel;
  assert.equal(synced.lastError, null);
  assert.equal(JSON.parse(vault.decrypt((await store.getChannelOAuth(ws, yt.id)).oauthEnc)).accessToken, 'at-renovado');
  // Autorización revocada: queda marcado el error
  fake.state.revoked.add('rt-1');
  await store.updateChannelSync(ws, yt.id, { oauthEnc: vault.encrypt(JSON.stringify({ ...tokens, expiresAt: Date.now() - 1000 })) });
  const broken = (await owner('POST', `/api/channels/${yt.id}/sync`)).data.channel;
  assert.match(broken.lastError, /venció o fue revocada/);
  assert.equal((await owner('GET', '/api/integrations')).data.providers.find((p) => p.id === 'youtube').status, 'error');

  // Quitar el cliente de Google con canales conectados no se permite
  assert.equal((await owner('DELETE', '/api/integrations/google_oauth')).status, 409);

  // Desconectar (solo propietarios) revoca el permiso en Google
  assert.equal((await editor('POST', `/api/channels/${linked.id}/disconnect`)).status, 403);
  const disc = (await owner('POST', `/api/channels/${linked.id}/disconnect`)).data.channel;
  assert.equal(disc.connected, false);
  assert.equal(disc.externalId, null);
  assert.ok(fake.state.revoked.has('rt-2'));
});

test('bóveda: cifra, detecta alteraciones y rechaza llaves inválidas', () => {
  const v = createVault({ key: randomBytes(32) });
  const enc = v.encrypt('secreto');
  assert.notEqual(enc, v.encrypt('secreto'), 'IV aleatorio');
  assert.equal(v.decrypt(enc), 'secreto');
  const parts = enc.split('.'); parts[3] = Buffer.from('otro').toString('base64url');
  assert.throws(() => v.decrypt(parts.join('.')));
  assert.throws(() => createVault({ key: randomBytes(16) }));
  assert.throws(() => createVault({ key: randomBytes(32) }).decrypt(enc));
});
