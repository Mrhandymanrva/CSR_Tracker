import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStateStore, sanitize, StateError } from '../src/stateStore.js';
import { defaultState } from '../src/store.js';

const tmp = () => mkdtemp(join(tmpdir(), 'pod-state-'));

test('starts from defaults at revision 0, saves bump the revision and persist across a restart', async () => {
  const dir = await tmp();
  const a = createStateStore(dir);
  const first = await a.load();
  assert.equal(first.rev, 0);
  const s = structuredClone(first.state);
  s.pool.poolTotal = 8000;
  const saved = await a.save({ baseRev: 0, state: s, editor: 'Mason' });
  assert.equal(saved.rev, 1);
  assert.equal(saved.updatedBy, 'Mason');
  const b = createStateStore(dir); // simulated restart
  const again = await b.load();
  assert.equal(again.rev, 1);
  assert.equal(again.state.pool.poolTotal, 8000);
});

test('a stale revision is rejected with 409 and the current state, never overwritten', async () => {
  const a = createStateStore(await tmp());
  const s0 = structuredClone((await a.load()).state);
  const mine = { ...s0, pool: { ...s0.pool, poolTotal: 1 } };
  const theirs = { ...s0, pool: { ...s0.pool, poolTotal: 2 } };
  await a.save({ baseRev: 0, state: theirs, editor: 'Amy' });
  await assert.rejects(a.save({ baseRev: 0, state: mine, editor: 'Mason' }), (e) => e instanceof StateError && e.status === 409 && e.current.state.pool.poolTotal === 2);
  assert.equal((await a.load()).state.pool.poolTotal, 2);
});

test('concurrent saves on the same revision: exactly one wins', async () => {
  const a = createStateStore(await tmp());
  const s0 = structuredClone((await a.load()).state);
  const mk = (n) => ({ ...s0, pool: { ...s0.pool, poolTotal: n } });
  const results = await Promise.allSettled([a.save({ baseRev: 0, state: mk(1), editor: 'x' }), a.save({ baseRev: 0, state: mk(2), editor: 'y' })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected' && r.reason.status === 409).length, 1);
});

test('a save with no real change does not bump the revision or write an audit line', async () => {
  const dir = await tmp();
  const a = createStateStore(dir);
  const s0 = (await a.load()).state;
  const r = await a.save({ baseRev: 0, state: s0, editor: 'x' });
  assert.equal(r.rev, 0);
  await assert.rejects(readFile(join(dir, 'audit.jsonl')), { code: 'ENOENT' });
});

test('audit log records who changed which sections', async () => {
  const dir = await tmp();
  const a = createStateStore(dir);
  const s = structuredClone((await a.load()).state);
  s.scorecard.targetPremium = 1500;
  s.roster[0].name = 'Renamed';
  await a.save({ baseRev: 0, state: s, editor: 'Amy' });
  const line = JSON.parse((await readFile(join(dir, 'audit.jsonl'), 'utf8')).trim());
  assert.equal(line.by, 'Amy');
  assert.equal(line.rev, 1);
  assert.deepEqual(line.changed.sort(), ['roster', 'scorecard']);
});

test('unreadable saved state is never overwritten with defaults', async () => {
  const dir = await tmp();
  await writeFile(join(dir, 'state.json'), '{not json');
  const a = createStateStore(dir);
  await assert.rejects(a.load(), (e) => e.status === 500);
  await assert.rejects(a.save({ baseRev: 0, state: defaultState(), editor: 'x' }), (e) => e.status === 500);
  assert.equal(await readFile(join(dir, 'state.json'), 'utf8'), '{not json');
});

test('sanitize drops unknown keys and rejects wrong shapes and oversize lists', () => {
  const clean = sanitize({ ...defaultState(), evil: 'x', __proto__: { y: 1 } });
  assert.equal('evil' in clean, false);
  assert.throws(() => sanitize(null), { status: 400 });
  assert.throws(() => sanitize({ roster: 'nope' }), { status: 400 });
  assert.throws(() => sanitize({ roster: [1] }), { status: 400 });
  assert.throws(() => sanitize({ roster: Array.from({ length: 201 }, () => ({})) }), { status: 400 });
  assert.throws(() => sanitize({ pool: [] }), { status: 400 });
});
