import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.js';
import { createMemoryStore } from '../server/store/memory.js';

async function listen(t, options) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('entrega la app y sus archivos, y protege archivos privados', async (t) => {
  const base = await listen(t, { store: createMemoryStore() });
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Golddigger Studio/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  for (const asset of ['state.js', 'api.js', 'app.js', 'flow-editor.js', 'styles.css', 'catalog.json', 'favicon.svg']) {
    assert.equal((await fetch(`${base}/assets/${asset}`)).status, 200, asset);
  }
  for (const resource of ['/.env', '/server/index.js', '/package.json', '/assets/%2e%2e%2f%2e%2e%2f.env', '/server/migrations/001_inicial.sql', '/server/migrations/002_datos_ejemplo.sql']) {
    assert.ok([400, 403, 404].includes((await fetch(base + resource)).status), resource);
  }
  const first = await fetch(`${base}/assets/app.js`);
  assert.equal((await fetch(`${base}/assets/app.js`, { headers: { 'If-None-Match': first.headers.get('etag') } })).status, 304);
});

test('sin base de datos configurada: health lo indica y la API responde 503', async (t) => {
  const base = await listen(t, { store: null });
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.database, 'sin_configurar');
  assert.equal((await fetch(`${base}/api/auth/me`)).status, 503);
});

test('la contraseña HTTP opcional protege el panel pero deja health público', async (t) => {
  const base = await listen(t, { store: createMemoryStore(), auth: { user: 'admin', pass: 's3cret' } });
  assert.equal((await fetch(base)).status, 401);
  const ok = await fetch(base, { headers: { Authorization: 'Basic ' + Buffer.from('admin:s3cret').toString('base64') } });
  assert.equal(ok.status, 200);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

// ── Suite de datos: corre con memoria siempre y con PostgreSQL si hay TEST_DATABASE_URL ─────────────
const stores = [['memoria', async () => createMemoryStore()]];
if (process.env.TEST_DATABASE_URL) {
  stores.push(['postgres', async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!/test/i.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL debe apuntar a una base cuyo nombre contenga "test".');
    const { default: pg } = await import('pg');
    const c = new pg.Client(url);
    await c.connect();
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await c.end();
    const { createPostgresStore } = await import('../server/store/postgres.js');
    const store = await createPostgresStore(url);
    await store.migrate();
    await store.migrate(); // idempotente
    return store;
  }]);
}

for (const [label, makeStore] of stores) {
  test(`datos (${label}): sesión, campañas y flujos versionados`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const { hashPassword } = await import('../server/auth.js');
    await store.createUser({ email: 'ana@example.com', name: 'Ana', passwordHash: await hashPassword('contrasena-segura'), workspaceName: 'Uno' });
    await store.createUser({ email: 'otro@example.com', name: 'Otro', passwordHash: await hashPassword('contrasena-segura'), workspaceName: 'Dos' });
    const base = await listen(t, { store });

    let cookie = '';
    const call = async (method, path, body, extra = {}) => {
      const headers = { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra };
      const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: res.status, data: await res.json().catch(() => null), setCookie };
    };

    // Sin sesión
    assert.equal((await call('GET', '/api/auth/me')).status, 401);
    assert.equal((await call('GET', '/api/campaigns')).status, 401);

    // Login incorrecto y correcto
    assert.equal((await call('POST', '/api/auth/login', { email: 'ana@example.com', password: 'mala' })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { email: 'nadie@example.com', password: 'mala' })).status, 401);
    const login = await call('POST', '/api/auth/login', { email: 'ANA@example.com', password: 'contrasena-segura' });
    assert.equal(login.status, 200);
    assert.match(login.setCookie, /HttpOnly/);
    assert.match(login.setCookie, /SameSite=Lax/);
    assert.equal(login.data.workspace.name, 'Uno');
    assert.equal(login.data.workspace.role, 'owner');
    assert.equal((await call('GET', '/api/auth/me')).data.user.email, 'ana@example.com');

    // Protección CSRF: sin JSON o desde otro origen no se aceptan escrituras
    const form = await fetch(base + '/api/campaigns', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=x' });
    assert.equal(form.status, 415);
    assert.equal((await call('POST', '/api/campaigns', { name: 'X', channelId: 1 }, { Origin: 'https://malicioso.example' })).status, 403);

    // Datos iniciales del espacio de trabajo
    const channels = (await call('GET', '/api/channels')).data.channels;
    assert.equal(channels.length, 3);
    const campaigns = (await call('GET', '/api/campaigns')).data.campaigns;
    assert.equal(campaigns.length, 3);
    assert.equal(campaigns[0].metrics.revenue, 2480);

    // Crear campaña: validación y alta
    const bad = await call('POST', '/api/campaigns', { name: '', channelId: channels[0].id });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.field, 'name');
    assert.equal((await call('POST', '/api/campaigns', { name: 'Hola', channelId: channels[0].id, format: 'Otro' })).status, 400);
    const created = await call('POST', '/api/campaigns', { name: 'Leyendas urbanas', channelId: channels[1].id, budgetMonthly: '150', time: '20:30', autoPublish: false });
    assert.equal(created.status, 201);
    assert.equal(created.data.campaign.budgetMonthly, 150);
    assert.equal(created.data.campaign.status, 'active');
    const cid = created.data.campaign.id;

    // Pausar y editar
    const paused = await call('PATCH', `/api/campaigns/${cid}`, { status: 'paused' });
    assert.equal(paused.data.campaign.status, 'paused');
    assert.equal(paused.data.campaign.name, 'Leyendas urbanas');
    assert.equal((await call('PATCH', `/api/campaigns/${cid}`, { status: 'borrada' })).status, 400);

    // Flujo: por defecto, guardar, sin cambios, conflicto, validación
    const wf0 = (await call('GET', `/api/campaigns/${cid}/workflow`)).data.workflow;
    assert.equal(wf0.version, 0);
    assert.equal(wf0.isDefault, true);
    assert.equal(wf0.nodes.length, 12);
    const nodes = wf0.nodes;
    nodes[1].prompt = 'Guion de 8 minutos con fuentes.';
    const s1 = await call('PUT', `/api/campaigns/${cid}/workflow`, { nodes, baseVersion: 0 });
    assert.equal(s1.status, 200);
    assert.equal(s1.data.workflow.version, 1);
    assert.equal(s1.data.workflow.savedBy, 'Ana');
    const same = await call('PUT', `/api/campaigns/${cid}/workflow`, { nodes, baseVersion: 1 });
    assert.equal(same.data.workflow.unchanged, true);
    assert.equal(same.data.workflow.version, 1);
    const stale = await call('PUT', `/api/campaigns/${cid}/workflow`, { nodes: nodes.slice(0, 3), baseVersion: 0 });
    assert.equal(stale.status, 409);
    assert.equal(stale.data.currentVersion, 1);
    const cyc = structuredClone(nodes); cyc[0].deps = ['measure'];
    assert.match((await call('PUT', `/api/campaigns/${cid}/workflow`, { nodes: cyc, baseVersion: 1 })).data.message, /ciclo/);
    const badTool = structuredClone(nodes); badTool[0].tool = 'Herramienta inventada';
    assert.equal((await call('PUT', `/api/campaigns/${cid}/workflow`, { nodes: badTool, baseVersion: 1 })).status, 400);
    const badDep = structuredClone(nodes); badDep[2].deps = ['no-existe'];
    assert.equal((await call('PUT', `/api/campaigns/${cid}/workflow`, { nodes: badDep, baseVersion: 1 })).status, 400);
    const s2 = await call('PUT', `/api/campaigns/${cid}/workflow`, { nodes: nodes.slice(0, 3), baseVersion: 1 });
    assert.equal(s2.data.workflow.version, 2);
    assert.equal((await call('GET', `/api/campaigns/${cid}/workflow`)).data.workflow.nodes.length, 3);
    assert.equal((await call('GET', '/api/campaigns')).data.campaigns.find((c) => c.id === cid).workflowVersion, 2);

    // Aislamiento entre espacios de trabajo
    const anaCookie = cookie;
    cookie = '';
    await call('POST', '/api/auth/login', { email: 'otro@example.com', password: 'contrasena-segura' });
    assert.equal((await call('GET', `/api/campaigns/${cid}`)).status, 404);
    assert.equal((await call('PATCH', `/api/campaigns/${cid}`, { status: 'active' })).status, 404);
    assert.equal((await call('GET', `/api/campaigns/${cid}/workflow`)).status, 404);
    assert.equal((await call('POST', '/api/campaigns', { name: 'Intruso', channelId: channels[0].id })).status, 400);
    assert.ok((await call('GET', '/api/campaigns')).data.campaigns.every((c) => c.id !== cid));

    // Cambio de contraseña: cierra las demás sesiones
    cookie = anaCookie;
    assert.equal((await call('POST', '/api/auth/password', { current: 'mala', password: 'nueva-contrasena-1' })).status, 400);
    assert.equal((await call('POST', '/api/auth/password', { current: 'contrasena-segura', password: 'corta' })).status, 400);
    assert.equal((await call('POST', '/api/auth/password', { current: 'contrasena-segura', password: 'nueva-contrasena-1' })).status, 200);
    assert.equal((await call('GET', '/api/auth/me')).status, 200);
    const oldSession = await fetch(base + '/api/auth/me', { headers: { Cookie: anaCookie } });
    assert.equal(oldSession.status, 401);

    // Cerrar sesión
    assert.equal((await call('POST', '/api/auth/logout', {})).status, 200);
    assert.equal((await call('GET', '/api/auth/me')).status, 401);
  });
}

for (const [label, makeStore] of stores) {
  test(`usuarios (${label}): lista, alta, roles y bajas en el mismo panel`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const { hashPassword } = await import('../server/auth.js');
    await store.createUser({ email: 'duena@example.com', name: 'Dueña', passwordHash: await hashPassword('contrasena-segura'), workspaceName: 'Panel' });
    const base = await listen(t, { store });
    const session = () => {
      let cookie = '';
      return async (method, path, body) => {
        const res = await fetch(base + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
        const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
        return { status: res.status, data: await res.json().catch(() => null) };
      };
    };
    const owner = session();
    await owner('POST', '/api/auth/login', { email: 'duena@example.com', password: 'contrasena-segura' });
    let list = (await owner('GET', '/api/users')).data;
    assert.equal(list.canManage, true);
    assert.equal(list.users.length, 1);
    assert.equal(list.users[0].isMe, true);
    assert.equal(list.users[0].role, 'owner');
    assert.ok(list.users[0].lastLoginAt);
    assert.equal(list.users[0].passwordHash, undefined);

    // Alta
    assert.equal((await owner('POST', '/api/users', { email: 'malo', name: 'X', password: 'contrasena-segura' })).status, 400);
    assert.equal((await owner('POST', '/api/users', { email: 'ed@example.com', name: 'Ed', password: 'corta' })).status, 400);
    const add = await owner('POST', '/api/users', { email: 'Ed@Example.com', name: 'Ed', password: 'contrasena-del-editor' });
    assert.equal(add.status, 201);
    assert.equal(add.data.user.role, 'editor');
    assert.equal(add.data.user.email, 'ed@example.com');
    assert.equal((await owner('POST', '/api/users', { email: 'ed@example.com', name: 'Ed 2', password: 'contrasena-del-editor' })).status, 409);
    const edId = add.data.user.id;

    // El editor entra al mismo panel, ve a todos, pero no administra
    const editor = session();
    const login = await editor('POST', '/api/auth/login', { email: 'ed@example.com', password: 'contrasena-del-editor' });
    assert.equal(login.data.workspace.name, 'Panel');
    assert.equal(login.data.workspace.role, 'editor');
    const edList = (await editor('GET', '/api/users')).data;
    assert.equal(edList.canManage, false);
    assert.equal(edList.users.length, 2);
    assert.equal((await editor('GET', '/api/campaigns')).data.campaigns.length, 3);
    assert.equal((await editor('POST', '/api/users', { email: 'z@example.com', name: 'Z', password: 'contrasena-segura' })).status, 403);
    assert.equal((await editor('PATCH', `/api/users/${edId}`, { role: 'owner' })).status, 403);
    assert.equal((await editor('DELETE', `/api/users/${list.users[0].id}`)).status, 403);

    // Roles: el último propietario no puede dejar de serlo
    const ownerId = list.users[0].id;
    assert.equal((await owner('PATCH', `/api/users/${ownerId}`, { role: 'editor' })).status, 409);
    assert.equal((await owner('PATCH', `/api/users/${edId}`, { role: 'jefe' })).status, 400);
    assert.equal((await owner('PATCH', `/api/users/${edId}`, { role: 'owner' })).data.user.role, 'owner');
    assert.equal((await editor('GET', '/api/users')).data.canManage, true); // el cambio aplica a su sesión al momento
    assert.equal((await owner('PATCH', `/api/users/${edId}`, { role: 'editor' })).data.user.role, 'editor');

    // Bajas
    assert.equal((await owner('DELETE', `/api/users/${ownerId}`)).status, 400);
    assert.equal((await owner('DELETE', '/api/users/99999')).status, 404);
    assert.equal((await owner('DELETE', `/api/users/${edId}`)).status, 200);
    assert.equal((await editor('GET', '/api/auth/me')).status, 401);
    assert.equal((await editor('POST', '/api/auth/login', { email: 'ed@example.com', password: 'contrasena-del-editor' })).status, 401);
    list = (await owner('GET', '/api/users')).data;
    assert.equal(list.users.length, 1);
    // Se puede volver a dar de alta el mismo correo
    assert.equal((await owner('POST', '/api/users', { email: 'ed@example.com', name: 'Ed', password: 'contrasena-del-editor' })).status, 201);
  });
}

for (const [label, makeStore] of stores) {
  test(`datos de ejemplo (${label}): crear canal y limpiar sin tocar lo del equipo`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const { hashPassword } = await import('../server/auth.js');
    await store.createUser({ email: 'duena@example.com', name: 'Dueña', passwordHash: await hashPassword('contrasena-segura') });
    const base = await listen(t, { store });
    let cookie = '';
    const call = async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
      const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      return { status: res.status, data: await res.json().catch(() => null) };
    };
    await call('POST', '/api/auth/login', { email: 'duena@example.com', password: 'contrasena-segura' });
    const demoChannels = (await call('GET', '/api/channels')).data.channels;
    assert.ok(demoChannels.every((c) => c.isDemo));
    assert.ok((await call('GET', '/api/campaigns')).data.campaigns.every((c) => c.isDemo));

    // Canal propio
    assert.equal((await call('POST', '/api/channels', { name: '  ' })).status, 400);
    const own = await call('POST', '/api/channels', { name: 'Mi Canal Nuevo', niche: 'Viajes' });
    assert.equal(own.status, 201);
    assert.equal(own.data.channel.mark, 'MC');
    assert.equal(own.data.channel.isDemo, false);

    // Campaña del equipo en un canal propio y otra en un canal de ejemplo
    const c1 = (await call('POST', '/api/campaigns', { name: 'Propia', channelId: own.data.channel.id })).data.campaign;
    const c2 = (await call('POST', '/api/campaigns', { name: 'En canal de ejemplo', channelId: demoChannels[0].id })).data.campaign;
    assert.equal(c1.isDemo, false);
    await call('PUT', `/api/campaigns/${c2.id}/workflow`, { nodes: (await call('GET', `/api/campaigns/${c2.id}/workflow`)).data.workflow.nodes, baseVersion: 0 });

    // Un editor no puede limpiar
    await store.createUser({ email: 'ed@example.com', name: 'Ed', passwordHash: await hashPassword('contrasena-segura'), joinWorkspaceId: (await store.listWorkspaces())[0].id });
    const ownerCookie = cookie; cookie = '';
    await call('POST', '/api/auth/login', { email: 'ed@example.com', password: 'contrasena-segura' });
    assert.equal((await call('POST', '/api/demo/clear', {})).status, 403);
    cookie = ownerCookie;

    const cleared = (await call('POST', '/api/demo/clear', {})).data.cleared;
    assert.deepEqual(cleared, { campaigns: 3, channels: 2, keptChannels: 1 });
    const campaigns = (await call('GET', '/api/campaigns')).data.campaigns;
    assert.deepEqual(campaigns.map((c) => c.name).sort(), ['En canal de ejemplo', 'Propia']);
    assert.equal(campaigns.find((c) => c.id === c2.id).workflowVersion, 1);
    const channels = (await call('GET', '/api/channels')).data.channels;
    assert.equal(channels.length, 2);
    assert.ok(channels.every((c) => !c.isDemo));
    assert.deepEqual(channels.find((c) => c.id === demoChannels[0].id).metrics, {});
    // Repetir no hace nada
    assert.deepEqual((await call('POST', '/api/demo/clear', {})).data.cleared, { campaigns: 0, channels: 0, keptChannels: 0 });
  });
}

test('límite de intentos de inicio de sesión', async (t) => {
  const store = createMemoryStore();
  const { hashPassword } = await import('../server/auth.js');
  await store.createUser({ email: 'ana@example.com', name: 'Ana', passwordHash: await hashPassword('contrasena-segura') });
  const base = await listen(t, { store });
  const attempt = (password) => fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ana@example.com', password }) });
  for (let i = 0; i < 10; i++) assert.equal((await attempt('mala')).status, 401);
  assert.equal((await attempt('contrasena-segura')).status, 429);
});
