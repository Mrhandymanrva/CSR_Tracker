// Pure calculation logic for the Pod KPI / Bonus dashboard.
// Mirrors Customer_Operations_Pod_Dashboard.xlsx formula-for-formula. No I/O, no dependencies.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const POOL_SHARES = Object.freeze({ cleanQueue: 0.5, netBookings: 0.3, revenue: 0.2 });

// ---- Daily clean-queue score ------------------------------------------------
// day = { date, points: [booking, chats, automation, handoffs] } with 1/0, or null/undefined if not yet entered.
// A day counts only when all 4 points are recorded; partial days are excluded, never scored as 0.
export function dailyScore(day) {
  const pts = day?.points ?? [];
  if (![0, 1, 2, 3].every((i) => isNum(pts[i]))) return null;
  const score = pts[0] + pts[1] + pts[2] + pts[3];
  return { score, pct: score / 4 };
}

export function cleanQueueMtd(days) {
  const done = (days ?? []).map(dailyScore).filter(Boolean);
  if (done.length === 0) return { pct: null, daysLogged: 0 }; // "no data yet"
  return { pct: done.reduce((a, d) => a + d.pct, 0) / done.length, daysLogged: done.length };
}

// ---- Monthly bonus pool (50/30/20) -----------------------------------------
// Bookings and revenue legs: no pay below PAY_FLOOR of goal, rising in a straight line to full pay at 100%
// (rule chosen by Mason, Oct 8 2026; replaces the workbook's linear-from-zero assumption).
// Clean queues keeps its own proportional rule because it already tops out at 100%.
export const PAY_FLOOR = 0.8;

// Share of goal reached (uncapped ratio); a zero/invalid goal gives 0, as the workbook's IFERROR did.
export function goalRatio(actual, goal) {
  if (!isNum(actual) || !isNum(goal) || goal === 0) return 0;
  return actual / goal;
}

// Pay factor 0..1 for a goal-based leg.
export function attainment(actual, goal) {
  const r = goalRatio(actual, goal);
  if (r < PAY_FLOOR) return 0;
  return Math.min((r - PAY_FLOOR) / (1 - PAY_FLOOR), 1);
}

export function monthlyPool({ poolTotal, cleanQueuePct, bookingsActual, bookingsGoal, revenueActual, revenueGoal, roster }) {
  const total = isNum(poolTotal) ? poolTotal : 0;
  const cq = isNum(cleanQueuePct) ? cleanQueuePct : 0;
  const parts = {
    cleanQueue: { share: POOL_SHARES.cleanQueue, ratio: cq, attainment: cq },
    netBookings: { share: POOL_SHARES.netBookings, ratio: goalRatio(bookingsActual, bookingsGoal), attainment: attainment(bookingsActual, bookingsGoal) },
    revenue: { share: POOL_SHARES.revenue, ratio: goalRatio(revenueActual, revenueGoal), attainment: attainment(revenueActual, revenueGoal) },
  };
  for (const p of Object.values(parts)) p.earned = p.share * p.attainment * total;
  const totalEarned = parts.cleanQueue.earned + parts.netBookings.earned + parts.revenue.earned;

  const rows = (roster ?? []).map((r) => ({
    name: r.name,
    role: r.role,
    eligibleHours: (isNum(r.hours) ? r.hours : 0) * (isNum(r.attendancePct) ? r.attendancePct : 0),
  }));
  const sumHours = rows.reduce((a, r) => a + r.eligibleHours, 0);
  for (const r of rows) {
    r.share = sumHours > 0 ? r.eligibleHours / sumHours : 0;
    r.payout = r.share * totalEarned;
  }
  return { parts, totalEarned, payouts: rows };
}

// ---- Quarterly leadership scorecard ----------------------------------------
export const SCORECARD_CATEGORIES = Object.freeze([
  { key: 'response', label: 'Response and disposition', max: 25 },
  { key: 'followup', label: 'Follow-up and closeout', max: 25 },
  { key: 'booking', label: 'Booking and estimate performance', max: 25 },
  { key: 'coaching', label: 'Coaching and bench strength', max: 15 },
  { key: 'stability', label: 'Pod stability and professionalism', max: 10 },
]);

export const GATE_KEYS = Object.freeze([
  { key: 'ownProduction', label: 'Own REP production measures at standard for the quarter?' },
  { key: 'noCherryPicking', label: 'No cherry-picking finding against them for the quarter?' },
  { key: 'noUnaddressedRed', label: 'No unaddressed Red-escalation pattern traced to their coaching?' },
]);

export function scorecard({ scores, gate, targetPremium }) {
  const clamp = (key, max) => {
    const v = scores?.[key];
    return isNum(v) ? Math.min(Math.max(v, 0), max) : 0;
  };
  const score = SCORECARD_CATEGORIES.reduce((a, c) => a + clamp(c.key, c.max), 0);
  const gateMet = GATE_KEYS.every((g) => gate?.[g.key] === 'Y');
  const target = isNum(targetPremium) ? targetPremium : 0;
  let band, premium;
  if (!gateMet) [band, premium] = ['Gate not met — no premium', 0];
  else if (score >= 90) [band, premium] = ['Full premium', target];
  else if (score >= 75) [band, premium] = ['Partial premium — half', target * 0.5];
  else [band, premium] = ['Below 75 — no premium this quarter', 0];
  return { score, max: 100, gateMet, band, premium };
}

// ---- Weekly measures + KPI tiles -------------------------------------------
export const MEASURES = Object.freeze([
  { key: 'firstTouch', label: 'Digital first human touch (min)', target: 5, dir: '≤' },
  { key: 'missedCalls', label: 'Missed calls/VM overdue (#)', target: 0, dir: '=' },
  { key: 'handoffMisses', label: 'Handoff acceptance misses (#)', target: 0, dir: '=' },
  { key: 'overdueFollowups', label: 'Overdue follow-ups (#)', target: 0, dir: '=' },
  { key: 'infoAwaiting', label: 'Info awaiting REP review (#)', target: 0, dir: '=' },
  { key: 'estimateTurnaround', label: 'Estimate turnaround on-standard (%)', target: 1, dir: '≥' },
  { key: 'estimateConversion', label: 'Estimate conversion (%)', target: null, dir: '≥' }, // baseline pending
  { key: 'acceptedAwaitingBooking', label: 'Accepted awaiting booking (#)', target: 0, dir: '=' },
  { key: 'routingAccuracy', label: 'Routing accuracy / data completeness (%)', target: 1, dir: '≥' },
  { key: 'vanRolls', label: 'Van-rolls without commitment (#)', target: 0, dir: '=' },
]);

export function measureStatus(value, target, dir) {
  if (!isNum(value)) return 'no data yet';
  if (!isNum(target)) return 'baseline pending';
  const eps = 1e-9;
  const ok = dir === '≤' ? value <= target + eps : dir === '≥' ? value >= target - eps : Math.abs(value - target) <= eps;
  return ok ? 'On standard' : 'Below standard';
}

// weeks: [{ weekEnding: 'YYYY-MM-DD', values: { [measureKey]: number|null } }]. Most recent = latest weekEnding.
export function latestWeek(weeks) {
  const w = (weeks ?? []).filter((x) => x?.weekEnding).sort((a, b) => a.weekEnding.localeCompare(b.weekEnding));
  return w.length ? w[w.length - 1] : null;
}

export const TILES = Object.freeze([
  { area: 'Response time', measure: 'firstTouch', standard: '≤ 5 business minutes' },
  { area: 'Booking rate / estimate closure', measure: 'estimateConversion', standard: 'baseline, then improvement' },
  { area: 'Follow-up (overdue items)', measure: 'overdueFollowups', standard: '0 without a documented exception' },
  { area: 'Lead disposition (routing / data)', measure: 'routingAccuracy', standard: '→ 100% of fields' },
]);

export function kpiTiles({ weeks, cleanQueuePct }) {
  const wk = latestWeek(weeks);
  const tiles = TILES.map((t) => {
    const m = MEASURES.find((x) => x.key === t.measure);
    const raw = wk?.values?.[t.measure];
    const value = isNum(raw) ? raw : null;
    return { area: t.area, value, standard: t.standard, status: wk ? measureStatus(value, m.target, m.dir) : 'no data yet' };
  });
  tiles.push({
    area: 'Closeout (clean queues)',
    value: isNum(cleanQueuePct) ? cleanQueuePct : null,
    standard: '100% of the four daily points',
    status: !isNum(cleanQueuePct) ? 'no data yet' : cleanQueuePct >= 1 - 1e-9 ? 'On standard' : 'Below standard',
  });
  return tiles;
}
