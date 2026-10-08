import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyScore, cleanQueueMtd, monthlyPool, scorecard, kpiTiles, measureStatus, attainment } from '../src/calc.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);
const full = [1, 1, 1, 1];

test('partial day is excluded, never scored as 0', () => {
  assert.equal(dailyScore({ points: [1, 1, null, undefined] }), null);
  const r = cleanQueueMtd([{ points: full }, { points: [1, 0, null, null] }]);
  assert.equal(r.daysLogged, 1);
  assert.equal(r.pct, 1);
  assert.equal(cleanQueueMtd([]).pct, null);
});

test('explicit 0 points do count', () => {
  near(dailyScore({ points: [1, 1, 0, 1] }).pct, 0.75);
});

test('workbook reference: October 2026 snapshot', () => {
  const days = [full, full, [1, 1, 0, 1], full, full, full].map((points) => ({ points }));
  const mtd = cleanQueueMtd(days);
  near(mtd.pct, 0.9583333333333334);
  const roster = Array.from({ length: 8 }, (_, i) => ({ name: `P${i}`, role: 'REP', hours: 160, attendancePct: 1 }));
  const p = monthlyPool({ poolTotal: 8000, cleanQueuePct: mtd.pct, bookingsActual: 42000, bookingsGoal: 48000, revenueActual: 210000, revenueGoal: 230000, roster });
  near(p.parts.cleanQueue.earned, 3833.3333333333);
  near(p.parts.netBookings.earned, 2100);
  near(p.parts.revenue.earned, 1460.8695652174);
  near(p.totalEarned, 7394.2028985507);
  near(p.payouts[0].payout, 924.2753623188);
  near(p.payouts.reduce((a, r) => a + r.payout, 0), p.totalEarned);
});

test('attainment caps at 100% and survives bad goals', () => {
  assert.equal(attainment(60000, 48000), 1);
  assert.equal(attainment(1, 0), 0);
  assert.equal(attainment(null, 5), 0);
});

test('attendance adjustment shifts shares; empty roster is safe', () => {
  const p = monthlyPool({ poolTotal: 1000, cleanQueuePct: 1, bookingsActual: 1, bookingsGoal: 1, revenueActual: 1, revenueGoal: 1,
    roster: [{ name: 'A', hours: 100, attendancePct: 1 }, { name: 'B', hours: 100, attendancePct: 0.5 }] });
  near(p.payouts[0].payout, 1000 * (100 / 150));
  assert.equal(monthlyPool({ poolTotal: 1000, cleanQueuePct: 1, roster: [] }).payouts.length, 0);
});

test('scorecard bands and gate', () => {
  const gate = { ownProduction: 'Y', noCherryPicking: 'Y', noUnaddressedRed: 'Y' };
  const ok = { response: 22, followup: 20, booking: 18, coaching: 13, stability: 9 };
  assert.equal(scorecard({ scores: ok, gate, targetPremium: 1500 }).premium, 750);
  assert.equal(scorecard({ scores: { response: 25, followup: 25, booking: 25, coaching: 15, stability: 10 }, gate, targetPremium: 1500 }).premium, 1500);
  assert.equal(scorecard({ scores: { response: 25, followup: 25, booking: 25, coaching: 15, stability: 0 }, gate, targetPremium: 1500 }).premium, 1500); // 90 exactly
  assert.equal(scorecard({ scores: { response: 25, followup: 25, booking: 25, coaching: 0, stability: 0 }, gate, targetPremium: 1500 }).premium, 750); // 75 exactly
  assert.equal(scorecard({ scores: { response: 25, followup: 25, booking: 24 }, gate, targetPremium: 1500 }).premium, 0); // 74
  assert.equal(scorecard({ scores: ok, gate: { ...gate, noCherryPicking: 'N' }, targetPremium: 1500 }).premium, 0);
  assert.equal(scorecard({ scores: ok, gate: { ownProduction: 'Y' }, targetPremium: 1500 }).gateMet, false);
  assert.equal(scorecard({ scores: { response: 99 }, gate, targetPremium: 1 }).score, 25); // clamped to max
});

test('measure status directions', () => {
  assert.equal(measureStatus(3.8, 5, '≤'), 'On standard');
  assert.equal(measureStatus(5.1, 5, '≤'), 'Below standard');
  assert.equal(measureStatus(0, 0, '='), 'On standard');
  assert.equal(measureStatus(1, 0, '='), 'Below standard');
  assert.equal(measureStatus(0.96, 1, '≥'), 'Below standard');
  assert.equal(measureStatus(0.38, null, '≥'), 'baseline pending');
  assert.equal(measureStatus(null, 5, '≤'), 'no data yet');
});

test('tiles use latest week and match workbook', () => {
  const weeks = [
    { weekEnding: '2026-10-09', values: { firstTouch: 3.8, estimateConversion: 0.38, overdueFollowups: 0, routingAccuracy: 0.96 } },
    { weekEnding: '2026-10-02', values: { firstTouch: 4.2, estimateConversion: 0.34, overdueFollowups: 1, routingAccuracy: 0.92 } },
  ];
  const t = kpiTiles({ weeks, cleanQueuePct: 0.9583 });
  assert.deepEqual(t.map((x) => x.status), ['On standard', 'baseline pending', 'On standard', 'Below standard', 'Below standard']);
  assert.equal(kpiTiles({ weeks: [], cleanQueuePct: null }).every((x) => x.status === 'no data yet'), true);
});
