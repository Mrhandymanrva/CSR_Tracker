// Shared server-side state for the dashboard (roster, daily clean-queue points, weekly log, pool inputs,
// scorecard). One JSON file, written atomically; every save is appended to an audit log (pay data).
// Server-side only. Concurrency: optimistic. A save must name the revision it was based on; a stale
// revision is rejected so nobody silently overwrites someone else's edit.
import { readFile, writeFile, rename, mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultState } from './store.js';

const LIMITS = { roster: 200, days: 1500, weeks: 600 };
export const MAX_BODY_BYTES = 1_000_000;

export class StateError extends Error {
  constructor(message, status, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Accept only the known shape; drop anything else. Returns a clean copy or throws StateError(400).
export function sanitize(input) {
  if (!isObj(input)) throw new StateError('State must be an object', 400);
  const base = defaultState();
  const out = {};
  for (const key of ['roster', 'days', 'weeks']) {
    const v = input[key] ?? base[key];
    if (!Array.isArray(v)) throw new StateError(`"${key}" must be a list`, 400);
    if (v.length > LIMITS[key]) throw new StateError(`"${key}" has too many entries`, 400);
    if (!v.every(isObj)) throw new StateError(`"${key}" entries must be objects`, 400);
    out[key] = v;
  }
  for (const key of ['pool', 'scorecard']) {
    const v = input[key] ?? base[key];
    if (!isObj(v)) throw new StateError(`"${key}" must be an object`, 400);
    out[key] = v;
  }
  return JSON.parse(JSON.stringify(out)); // detach and drop undefined/functions
}

export function createStateStore(dir) {
  const file = join(dir, 'state.json');
  const auditFile = join(dir, 'audit.jsonl');
  let current = null; // { rev, state, updatedAt, updatedBy }
  let queue = Promise.resolve(); // serialises saves so rev checks and writes can't interleave

  async function load() {
    if (current) return current;
    try {
      const saved = JSON.parse(await readFile(file, 'utf8'));
      current = { rev: saved.rev ?? 0, state: sanitize(saved.state), updatedAt: saved.updatedAt ?? null, updatedBy: saved.updatedBy ?? null };
    } catch (e) {
      if (e.code !== 'ENOENT') throw new StateError(`Saved state could not be read (${e.message}). Refusing to overwrite it.`, 500);
      current = { rev: 0, state: defaultState(), updatedAt: null, updatedBy: null };
    }
    return current;
  }

  const summary = (a, b) => ['roster', 'days', 'weeks', 'pool', 'scorecard'].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

  async function save({ baseRev, state, editor }) {
    const run = async () => {
      const cur = await load();
      if (baseRev !== cur.rev) throw new StateError('Someone else saved changes first.', 409, { current: cur });
      const next = sanitize(state);
      const changed = summary(cur.state, next);
      if (changed.length === 0) return cur;
      const updated = { rev: cur.rev + 1, state: next, updatedAt: new Date().toISOString(), updatedBy: String(editor || 'unknown').slice(0, 60) };
      await mkdir(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(updated));
      await rename(tmp, file);
      await appendFile(auditFile, JSON.stringify({ at: updated.updatedAt, by: updated.updatedBy, rev: updated.rev, changed }) + '\n');
      current = updated;
      return updated;
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  return { load, save };
}
