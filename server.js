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

const root = fileURLToPath(new URL('.', import.meta.url));
const dataDir = join(root, '.data', 'snapshots');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const port = Number(process.argv[2]) || 5174;
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
  const snap = { date, takenAt: new Date().toISOString(), weekly: body.weekly, missedCalls: body.missedCalls, followUps: body.followUps, handoffs: body.handoffs, bookingQueue: body.bookingQueue, estimates: body.estimates, month: body.month, definitions: body.definitions };
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

const json = (res, code, body) => res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/live' && req.method === 'GET') return json(res, 200, await live(url.searchParams.get('refresh') === '1'));
    if (url.pathname === '/api/snapshots' && req.method === 'GET') {
      const files = await readdir(dataDir).catch(() => []);
      return json(res, 200, files.filter((f) => f.endsWith('.json')).sort());
    }
    if (url.pathname === '/api/snapshot' && req.method === 'POST') return json(res, 200, await takeSnapshot());
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
  } catch (e) {
    return json(res, e.status && e.status >= 400 && e.status < 600 ? e.status : 502, { error: e.message });
  }
  if (req.method !== 'GET') return res.writeHead(405).end('Method not allowed');
  const path = decodeURIComponent(url.pathname);
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root) || !['index.html', 'src'].some((p) => file.startsWith(join(root, p)))) return res.writeHead(404).end('Not found');
  // Browser modules must not expose server-only code that reads credentials.
  if (/stClient\.js$|collect\.js$|live\.js$/.test(file)) return res.writeHead(404).end('Not found');
  try {
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Pod dashboard on http://127.0.0.1:${port}${st.configured ? '' : '  (ServiceTitan NOT configured: add .env)'}`));
