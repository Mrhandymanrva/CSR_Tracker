// Manual-entry state + persistence. Storage is injectable so the host app can swap in its own backend later
// (API/DB) without touching calc.js or the UI. Everything here is a manual input per spec §2.5, plus the
// daily/weekly rows that live feeds (ServiceTitan, RingCentral, etc.) will eventually populate.

const KEY = 'pod-dashboard-v1';

export function defaultState() {
  const roster = [
    ['REP 1', 'REP', 'Y'], ['REP 2', 'REP', 'N'], ['REP 3', 'REP', 'N'], ['REP 4', 'REP', 'N'], ['REP 5', 'REP', 'N'],
    ['Coordinator A', 'Client Coordinator', 'N'], ['Coordinator B', 'Client Coordinator', 'N'], ['Coordinator C', 'Client Coordinator', 'N'],
  ].map(([name, role, lead]) => ({ name, role, teamLead: lead === 'Y', hours: 160, attendancePct: 1 }));
  return {
    roster,
    days: [], // { date: 'YYYY-MM-DD', points: [b,c,a,h] } — points may be null until entered
    weeks: [], // { weekEnding: 'YYYY-MM-DD', values: { measureKey: number|null } }
    pool: { month: '', poolTotal: 0, bookingsActual: null, bookingsGoal: null, revenueActual: null, revenueGoal: null },
    scorecard: {
      quarter: '',
      scores: { response: null, followup: null, booking: null, coaching: null, stability: null },
      gate: { ownProduction: '', noCherryPicking: '', noUnaddressedRed: '' },
      targetPremium: 0,
    },
  };
}

export function load(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return defaultState();
    const saved = JSON.parse(raw);
    const d = defaultState();
    return { ...d, ...saved, pool: { ...d.pool, ...saved.pool }, scorecard: { ...d.scorecard, ...saved.scorecard } };
  } catch {
    return defaultState();
  }
}

export function save(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// Weekdays only, matching the workbook's WORKDAY() date column (no holiday calendar).
export function nextWorkday(iso) {
  const d = new Date(iso + 'T12:00:00');
  do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6);
  return d.toISOString().slice(0, 10);
}
