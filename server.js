// Local server: static UI + read-only live ServiceTitan API + daily snapshot.
//   node server.js [port]        (default 5174, bound to 127.0.0.1 only)
// Endpoints:
//   GET  /api/live[?refresh=1]   current measures from ServiceTitan (cached 10 min)
//   GET  /api/snapshots          list saved daily snapshots
//   POST /api/snapshot           take today's snapshot now
// A snapshot is also taken automatically on weekdays at/after 16:05 America/New_York.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './src/stClient.js';
import { collect } from './src/collect.js';
import { buildLive } from './src/live.js';
import { authorized, isLoopback } from './src/auth.js';
import { createStateStore, StateError, MAX_BODY_BYTES } from './src/stateStore.js';

// Hosting (e.g. Railway): PORT is provided, so listen on all interfaces. Locally: 127.0.0.1 only.
// A hosted server shows payout and live business data, so it REFUSES to start without DASHBOARD_PASSWORD.
//   DASHBOARD_PASSWORD  shared password (any user name) for HTTP Basic auth
//   DATA_DIR            where snapshots are saved (point at a Railway volume to keep them across deploys)
const root = fileURLToPath(new URL('.', import.meta.url));
const baseDir = process.env.DATA_DIR || join(root, '.data');
const dataDir = join(baseDir, 'snapshots');
const stateStore = createStateStore(baseDir);
// On Railway without a volume the disk is wiped on every deploy; the UI warns when that is the case.
const ephemeral = Boolean(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID) && !process.env.DATA_DIR;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const port = Number(process.env.PORT) || Number(process.argv[2]) || 5174;
const host = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const password = process.env.DASHBOARD_PASSWORD || '';
// Without a password a hosted server stays up but serves NOTHING private: every page says what to set. (Exiting instead
// shows only a generic "application failed to respond" on the host, which hides the cause.)
const setupRequired = !isLoopback(host) && !password;
if (setupRequired) console.error('SETUP REQUIRED: DASHBOARD_PASSWORD is not set. Serving a setup notice only; no data is exposed. Set DASHBOARD_PASSWORD in the host environment variables.');
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
process.on('uncaughtException', (e) => console.error('Uncaught exception:', e));
const st = createClient();

let cache = null; // { at, body }
let inflight = null;

async function live(force = false) {
  if (!st.configured) throw Object.assign(new Error(`ServiceTitan is not configured (missing ${st.missing.join(', ')})`), { status: 503 });
  if (!force && cache && Date.now() - cache.at < 10 * 60_000) return cache.body;
  inflight ??= (async () => {
    try {
      const now = Date.now();
      const body = await buildLive(st, collect, now);
      cache = { at: now, body };
      return body;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const etDate = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(ms);

async function takeSnapshot() {
  const body = await live(true);
  const date = etDate();
  await mkdir(dataDir, { recursive: true });
  const snap = { date, takenAt: new Date().toISOString(), weekly: body.weekly, missedCalls: body.missedCalls, followUps: body.followUps, bookingQueue: body.bookingQueue, estimates: body.estimates, month: body.month, definitions: body.definitions };
  await writeFile(join(dataDir, `${date}.json`), JSON.stringify(snap, null, 2));
  return snap;
}

async function snapshotExists(date) {
  try { await readFile(join(dataDir, `${date}.json`)); return true; } catch { return false; }
}

// Weekdays, 16:05 ET or later, once per day. Checked every minute while the server runs.
setInterval(async () => {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', weekday: 'short' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    const weekday = !['Sat', 'Sun'].includes(p.weekday);
    if (weekday && (+p.hour > 16 || (+p.hour === 16 && +p.minute >= 5)) && !(await snapshotExists(etDate()))) {
      await takeSnapshot();
      console.log(`Snapshot saved for ${etDate()}`);
    }
  } catch (e) { console.error('Scheduled snapshot failed:', e.message); }
}, 60_000).unref();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new StateError('Request too large', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const json = (res, code, body) => res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return json(res, 200, { ok: !setupRequired, setupRequired, passwordSet: Boolean(password), serviceTitanConfigured: st.configured, persistent: !ephemeral });
  if (setupRequired) {
    return res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      .end('Setup required.\n\nThe server is running, but DASHBOARD_PASSWORD is not set, so it will not serve any data.\nIn Railway: service > Variables > add DASHBOARD_PASSWORD (any password you choose). It redeploys automatically.\nAlso set SERVICETITAN_TENANT_ID, SERVICETITAN_CLIENT_ID, SERVICETITAN_CLIENT_SECRET, SERVICETITAN_APP_KEY, and DATA_DIR=/data with a volume mounted at /data.\n');
  }
  if (!authorized(req.headers.authorization, password)) {
    return res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Pod dashboard", charset="UTF-8"', 'Cache-Control': 'no-store' }).end('Password required');
  }
  try {
    // Shared dashboard data. Writes need a JSON body and a custom header, which a cross-site page cannot send.
    if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, { ...(await stateStore.load()), persistent: !ephemeral });
    if (url.pathname === '/api/state' && req.method === 'PUT') {
      if (req.headers['x-requested-with'] !== 'pod-dashboard' || !String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new StateError('Bad request', 400);
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { throw e instanceof StateError ? e : new StateError('Body must be valid JSON', 400); }
      try {
        return json(res, 200, await stateStore.save({ baseRev: body.baseRev, state: body.state, editor: body.editor }));
      } catch (e) {
        if (e instanceof StateError && e.status === 409) return json(res, 409, { error: e.message, current: e.current });
        throw e;
      }
    }
    if (url.pathname === '/api/audit' && req.method === 'GET') {
      const text = await readFile(join(baseDir, 'audit.jsonl'), 'utf8').catch(() => '');
      return json(res, 200, text.trim().split('\n').filter(Boolean).slice(-100).map((l) => JSON.parse(l)).reverse());
    }
    if (url.pathname === '/api/live' && req.method === 'GET') return json(res, 200, await live(url.searchParams.get('refresh') === '1'));
    if (url.pathname === '/api/snapshots' && req.method === 'GET') {
      const files = await readdir(dataDir).catch(() => []);
      return json(res, 200, files.filter((f) => f.endsWith('.json')).sort());
    }
    if (url.pathname === '/api/snapshot' && req.method === 'POST') {
      if (req.headers['x-requested-with'] !== 'pod-dashboard') throw new StateError('Bad request', 400);
      return json(res, 200, await takeSnapshot());
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
  } catch (e) {
    return json(res, e.status && e.status >= 400 && e.status < 600 ? e.status : 502, { error: e.message });
  }
  if (req.method !== 'GET') return res.writeHead(405).end('Method not allowed');
  const path = decodeURIComponent(url.pathname);
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root) || !['index.html', 'src'].some((p) => file.startsWith(join(root, p)))) return res.writeHead(404).end('Not found');
  // Browser modules must not expose server-only code that reads credentials.
  if (/stClient\.js$|collect\.js$|live\.js$|stateStore\.js$|auth\.js$/.test(file)) return res.writeHead(404).end('Not found');
  try {
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, host, () => {
  console.log(`Pod dashboard listening on ${host}:${port}`);
  console.log(`Config: password ${password ? 'set' : 'MISSING'} | ServiceTitan ${st.configured ? 'configured' : `MISSING ${st.missing.join(', ')}`} | data dir ${baseDir}${ephemeral ? ' (NOT a volume: data is lost on deploy)' : ''}`);
});
