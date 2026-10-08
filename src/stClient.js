// Minimal READ-ONLY ServiceTitan client. GET only by construction: there is no write method.
// Pattern copied from CSR-Tool's serviceTitanClient.ts: client_credentials token cached until 60s before expiry,
// Bearer + ST-App-Key headers, {tenantId} path templates, {page,pageSize,hasMore,data[]} paging.
// Adds what CSR-Tool lacks: 429/5xx retry with backoff.

import { readFileSync, existsSync } from 'node:fs';

export function loadEnv(file = new URL('../.env', import.meta.url)) {
  const env = { ...process.env };
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) env[m[1]] ??= m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
}

export function createClient(env = loadEnv(), fetchImpl = globalThis.fetch) {
  const cfg = {
    tenant: env.SERVICETITAN_TENANT_ID,
    id: env.SERVICETITAN_CLIENT_ID,
    secret: env.SERVICETITAN_CLIENT_SECRET,
    appKey: env.SERVICETITAN_APP_KEY,
    authUrl: env.SERVICETITAN_AUTH_URL || 'https://auth.servicetitan.io/connect/token',
    base: env.SERVICETITAN_BASE_URL || 'https://api.servicetitan.io',
  };
  const missing = ['tenant', 'id', 'secret', 'appKey'].filter((k) => !cfg[k]);
  let token = null;
  let expiresAt = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function getToken() {
    if (token && Date.now() < expiresAt - 60_000) return token;
    const res = await fetchImpl(cfg.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.id, client_secret: cfg.secret, app_key: cfg.appKey }),
    });
    if (!res.ok) throw Object.assign(new Error(`ServiceTitan auth failed (${res.status})`), { status: res.status });
    const body = await res.json();
    token = body.access_token;
    expiresAt = Date.now() + (body.expires_in ?? 900) * 1000;
    return token;
  }

  function url(path, params = {}) {
    const u = new URL(path.replace(/\{tenant(Id)?\}/gi, cfg.tenant), cfg.base);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
    return u;
  }

  async function get(path, params = {}, attempt = 0) {
    const res = await fetchImpl(url(path, params), { method: 'GET', headers: { Authorization: `Bearer ${await getToken()}`, 'ST-App-Key': cfg.appKey } });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 500 * 2 ** attempt;
      await sleep(wait);
      return get(path, params, attempt + 1);
    }
    if (!res.ok) throw Object.assign(new Error(`GET ${path} -> ${res.status}`), { status: res.status });
    return res.json();
  }

  // Pages through a list endpoint; stops on hasMore=false, short page, or maxPages.
  async function getAll(path, params = {}, { pageSize = 100, maxPages = 25 } = {}) {
    const rows = [];
    for (let page = 1; page <= maxPages; page++) {
      const body = await get(path, { ...params, page, pageSize });
      const data = Array.isArray(body) ? body : body.data ?? body.results ?? body.items ?? [];
      rows.push(...data);
      if (body.hasMore === false || data.length < pageSize) break;
    }
    return rows;
  }

  return { get, getAll, missing, configured: missing.length === 0 };
}
