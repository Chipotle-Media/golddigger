import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.js';

test('serves the app and assets, identifies demo mode, and protects non-public files', async (t) => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Golddigger Studio/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  for (const asset of ['state.js', 'app.js', 'flow-editor.js', 'styles.css']) {
    assert.equal((await fetch(`${base}/assets/${asset}`)).status, 200);
  }
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.mode, 'demo');
  assert.equal(health.integrationsConnected, false);
  for (const resource of ['/.env', '/server/index.js', '/package.json', '/assets/%2e%2e%2f%2e%2e%2f.env']) {
    assert.ok([400, 403, 404].includes((await fetch(base + resource)).status));
  }
  assert.equal((await fetch(`${base}/api/campaigns`)).status, 501);
  assert.equal((await fetch(`${base}/api/publish`, { method: 'POST' })).status, 405);
});

test('optional password protects the panel but keeps health public', async (t) => {
  const server = createServer({ auth: { user: 'admin', pass: 's3cret' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const denied = await fetch(base);
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('www-authenticate'), /Basic/);
  const wrong = await fetch(base, { headers: { Authorization: 'Basic ' + Buffer.from('admin:nope').toString('base64') } });
  assert.equal(wrong.status, 401);
  const ok = await fetch(base, { headers: { Authorization: 'Basic ' + Buffer.from('admin:s3cret').toString('base64') } });
  assert.equal(ok.status, 200);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test('assets revalidate with ETag', async (t) => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/assets/app.js`;
  const first = await fetch(url);
  const etag = first.headers.get('etag');
  assert.ok(etag);
  assert.equal((await fetch(url, { headers: { 'If-None-Match': etag } })).status, 304);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/assets/favicon.svg`)).status, 200);
});
