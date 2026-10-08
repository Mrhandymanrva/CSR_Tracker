import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/stClient.js';

const env = { SERVICETITAN_TENANT_ID: '123', SERVICETITAN_CLIENT_ID: 'c', SERVICETITAN_CLIENT_SECRET: 's', SERVICETITAN_APP_KEY: 'k' };
const json = (body, status = 200, headers = {}) => ({ ok: status < 400, status, headers: { get: (h) => headers[h.toLowerCase()] ?? null }, json: async () => body });

test('reports missing credentials instead of calling out', () => {
  const c = createClient({ SERVICETITAN_TENANT_ID: '1' }, async () => assert.fail('no network'));
  assert.equal(c.configured, false);
  assert.deepEqual(c.missing, ['id', 'secret', 'appKey']);
});

test('GET only, tenant templating, auth headers, token reuse', async () => {
  const calls = [];
  const f = async (u, init) => {
    calls.push({ u: String(u), init });
    return String(u).includes('connect/token') ? json({ access_token: 't', expires_in: 900 }) : json({ data: [{ id: 1 }], hasMore: false });
  };
  const c = createClient(env, f);
  await c.get('/jpm/v2/tenant/{tenantId}/jobs', { a: 1, b: '' });
  await c.get('/jpm/v2/tenant/{tenantId}/jobs');
  const api = calls.filter((x) => !x.u.includes('connect/token'));
  assert.equal(calls.filter((x) => x.u.includes('connect/token')).length, 1);
  assert.ok(api[0].u.includes('/tenant/123/jobs?a=1') && !api[0].u.includes('b='));
  assert.ok(api.every((x) => x.init.method === 'GET' && x.init.headers['ST-App-Key'] === 'k' && x.init.headers.Authorization === 'Bearer t'));
});

test('retries 429 then succeeds; fails fast on 403', async () => {
  let n = 0;
  const f = async (u) => (String(u).includes('connect/token') ? json({ access_token: 't' }) : ++n === 1 ? json({}, 429, { 'retry-after': '0' }) : json({ ok: 1 }));
  assert.deepEqual(await createClient(env, f).get('/x'), { ok: 1 });
  const denied = async (u) => (String(u).includes('connect/token') ? json({ access_token: 't' }) : json({}, 403));
  await assert.rejects(createClient(env, denied).get('/x'), (e) => e.status === 403);
});

test('getAll pages until hasMore is false', async () => {
  const f = async (u) => {
    if (String(u).includes('connect/token')) return json({ access_token: 't' });
    const page = Number(new URL(u).searchParams.get('page'));
    return json({ data: [{ id: page }], hasMore: page < 3 });
  };
  const rows = await createClient(env, f).getAll('/x', {}, { pageSize: 1 });
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3]);
});
