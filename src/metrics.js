// Turns raw ServiceTitan rows into the dashboard's measures. Pure functions, no I/O, so they are testable
// with fixtures. Field names are the ones confirmed by the live probe (docs/servicetitan-mapping.md).
// Every definition that is an INTERPRETATION is listed in DEFINITIONS and shown on the report.

export const ESTIMATE_JOB_TYPE_ID = 239517159; // job type "Estimate" (confirmed by probe)

export const DEFAULT_CONFIG = Object.freeze({
  timeZone: 'America/New_York',
  // Business hours used for "business minutes". ASSUMPTION: Mon-Fri 8:00-17:00. Edit to match the pod's hours.
  businessHours: { days: [1, 2, 3, 4, 5], open: '08:00', close: '17:00' },
  missedCallGraceMinutes: 60, // a missed call counts as overdue only after this long without a callback
  estimateJobTypeIds: [ESTIMATE_JOB_TYPE_ID],
  followUpTaskTypeNames: null, // null = every open overdue task counts (not used by the dashboard measure; see overdueFollowUps)
  // ServiceTitan estimates carry no follow-up due date. Cadence set by Mason: a touch due at day 1, 3 and 7.
  // A stage is met when the customer got an outbound call after the previous stage boundary; open estimates
  // older than the max age are treated as closed out, not overdue. (Max age is an ASSUMPTION.)
  estimateFollowUpStagesDays: [1, 3, 7],
  estimateFollowUpMaxDays: 30,
});

export const DEFINITIONS = Object.freeze({
  firstTouch: 'Average business minutes from a new lead or missed inbound call to the first outbound call to that customer. Web-chat touches are not visible in ServiceTitan, so only calls count.',
  missedCalls: 'Distinct callers whose inbound call ServiceTitan marked Abandoned and who are still waiting after the grace period (no outbound call to them, no later connected call from them). Counted: callers ServiceTitan can identify (customer record or known lead number) plus unknown numbers that missed us 2+ times in a day. Unknown single-attempt numbers are shown separately and not counted, because they include spam and wrong numbers.',
  overdueFollowups: 'Open leads whose follow-up date has passed, plus open estimates that missed a follow-up stage. Estimate cadence is day 1, day 3 and day 7 after creation: a stage is missed when it has come due and the customer has had no outbound call since the previous stage boundary. Open estimates older than 30 days are treated as closed out. ServiceTitan tasks are not used: the overdue task list is stale compliance and prospecting items.',
  estimateConversion: 'Sold / (Sold + Dismissed) for decisions made in the period (sold date; last-modified date for dismissed). Open estimates are undecided and excluded.',
  acceptedAwaitingBooking: 'Sold estimates with no non-estimate, non-canceled job for that customer created on or after the sale date. ServiceTitan does not link estimates to their work jobs.',
  vanRolls: 'Completed jobs created in the period that carry a $0 total, estimate jobs included. Scheduled jobs are excluded because ServiceTitan job totals stay $0 until invoiced.',
  netBookings: 'Sold-estimate dollars (sold in the period) plus job totals for non-canceled, non-estimate jobs created in the period. A sold estimate whose work job is later invoiced inside the same period can be counted twice; job totals also fill in only as jobs are invoiced.',
  revenue: 'Sum of invoice totals with an invoice date in the period.',
});

// ---- time helpers ----------------------------------------------------------
const MS_MIN = 60_000;

// Wall-clock parts of an instant in a time zone.
function zoned(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

// UTC ms for a wall-clock time in tz (converges in two steps, handles DST).
function fromZoned(y, m, d, h, min, tz) {
  let guess = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) {
    const z = zoned(guess, tz);
    guess += Date.UTC(y, m - 1, d, h, min) - Date.UTC(z.y, z.m - 1, z.d, z.h, z.min);
  }
  return guess;
}

const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

// Minutes between two instants that fall inside business hours.
export function businessMinutes(startMs, endMs, cfg = DEFAULT_CONFIG) {
  if (!(endMs > startMs)) return 0;
  const { days, open, close } = cfg.businessHours;
  const tz = cfg.timeZone;
  let total = 0;
  const s = zoned(startMs, tz);
  let day = Date.UTC(s.y, s.m - 1, s.d);
  const last = (() => { const e = zoned(endMs, tz); return Date.UTC(e.y, e.m - 1, e.d); })();
  for (; day <= last; day += 864e5) {
    const dt = new Date(day);
    if (!days.includes(dt.getUTCDay())) continue;
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    const from = Math.max(startMs, fromZoned(y, m, d, 0, hm(open), tz));
    const to = Math.min(endMs, fromZoned(y, m, d, 0, hm(close), tz));
    if (to > from) total += (to - from) / MS_MIN;
  }
  return total;
}

const ms = (iso) => (iso ? Date.parse(iso) : NaN);
// ServiceTitan returns some money fields (invoice total) as strings.
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const digits = (s) => String(s ?? '').replace(/\D/g, '').slice(-10);
const inRange = (iso, from, to) => { const t = ms(iso); return t >= from && t < to; };

// ---- calls -----------------------------------------------------------------
// Accepts rows from /telecom/v2|v3/.../calls (fields nested in `leadCall`) or from export/calls (flat).
export function normalizeCall(row) {
  const c = row?.leadCall ?? row ?? {};
  return {
    id: c.id ?? row?.id,
    at: ms(c.receivedOn ?? c.createdOn),
    direction: c.direction,
    type: c.callType ?? c.type ?? null,
    from: digits(c.from),
    to: digits(c.to),
    customerId: c.customer?.id ?? null,
    agentId: c.agent?.id ?? null,
    hasVoicemail: Boolean(c.voiceMailUrl || c.voiceMailPath),
  };
}

// First outbound call after `at` that reaches the same customer or phone number.
function firstCallback(at, who, outbound) {
  let best = null;
  for (const o of outbound) {
    if (!(o.at > at)) continue;
    const same = (who.customerId && o.customerId === who.customerId) || (who.phone && o.to === who.phone);
    if (same && (best === null || o.at < best.at)) best = o;
  }
  return best;
}

// Inbound missed calls, counted per distinct CALLER (a caller who hung up three times is one person waiting).
// Each waiting caller lands in exactly one group:
//   identified   - ServiceTitan knows them (customer record on the call) or their number matches a known lead/booking
//   repeat       - unidentified, but missed us on 2+ calls on the same local day (looks like a real person)
//   unidentified - unknown number, single attempt (may be spam, robocall or wrong number); shown, not counted
// `counted` (identified + repeat) is the number the pod is held to. A caller stops waiting once we call them
// back or they later connect on an inbound call.
export function callMeasures(rawCalls, now = Date.now(), cfg = DEFAULT_CONFIG, knownPhones = new Set()) {
  const calls = rawCalls.map(normalizeCall).filter((c) => Number.isFinite(c.at));
  const outbound = calls.filter((c) => c.direction === 'Outbound');
  const connected = calls.filter((c) => c.direction === 'Inbound' && c.type && c.type !== 'Abandoned');
  const missed = calls.filter((c) => c.direction === 'Inbound' && c.type === 'Abandoned');

  const callers = new Map();
  for (const c of missed) {
    const key = c.customerId ? `c${c.customerId}` : `p${c.from}`;
    if (!callers.has(key)) callers.set(key, []);
    callers.get(key).push(c);
  }

  const sameDay = (a, b) => { const x = zoned(a, cfg.timeZone), y = zoned(b, cfg.timeZone); return x.y === y.y && x.m === y.m && x.d === y.d; };
  const out = { identified: 0, repeat: 0, unidentified: 0 };
  const touches = [];
  for (const list of callers.values()) {
    list.sort((a, b) => a.at - b.at);
    const first = list[0];
    const who = { customerId: first.customerId, phone: first.from };
    const cb = firstCallback(first.at, who, outbound);
    const reached = connected.some((o) => o.at > first.at && ((who.customerId && o.customerId === who.customerId) || (who.phone && o.from === who.phone)));
    if (cb) { touches.push(businessMinutes(first.at, cb.at, cfg)); continue; }
    if (reached || businessMinutes(first.at, now, cfg) <= cfg.missedCallGraceMinutes) continue;
    const identified = list.some((c) => c.customerId) || knownPhones.has(first.from);
    const repeat = list.some((a, i) => list.some((b, j) => i !== j && sameDay(a.at, b.at)));
    out[identified ? 'identified' : repeat ? 'repeat' : 'unidentified']++;
  }
  return {
    missedCalls: missed.length, // raw abandoned calls
    callers: callers.size, // distinct callers behind them
    waiting: { ...out, counted: out.identified + out.repeat },
    unreturnedOverdue: out.identified + out.repeat, // the measure
    touches,
  };
}

// Phone numbers of known leads/bookings, last 10 digits, for caller identification.
export function knownPhoneSet(leads = []) {
  return new Set(leads.map((l) => digits(l.leadPhone)).filter(Boolean));
}

// New leads: business minutes to first outbound call to the lead's customer.
export function leadTouchMinutes(leads, rawCalls, cfg = DEFAULT_CONFIG) {
  const outbound = rawCalls.map(normalizeCall).filter((c) => c.direction === 'Outbound' && Number.isFinite(c.at));
  const out = [];
  for (const l of leads) {
    const at = ms(l.createdOn);
    if (!Number.isFinite(at) || !l.customerId) continue;
    const cb = firstCallback(at, { customerId: l.customerId }, outbound);
    if (cb) out.push(businessMinutes(at, cb.at, cfg));
  }
  return out;
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function firstTouchAverage(callTouches, leadTouches) {
  return avg([...callTouches, ...leadTouches]);
}

// ---- estimates / jobs ------------------------------------------------------
export function estimateMeasures(estimates, jobs, { from, to }, cfg = DEFAULT_CONFIG) {
  const status = (e) => e.status?.name ?? e.status;
  // Decisions made in the period (a just-created estimate is almost always still open).
  const soldNow = estimates.filter((e) => status(e) === 'Sold' && inRange(e.soldOn, from, to));
  const dismissedNow = estimates.filter((e) => status(e) === 'Dismissed' && inRange(e.modifiedOn, from, to));
  const decided = soldNow.length + dismissedNow.length;
  // Sold estimates with no non-estimate, non-canceled job for that customer created on/after the sale.
  const est = new Set(cfg.estimateJobTypeIds);
  const workByCustomer = new Map();
  for (const j of jobs) {
    if (est.has(j.jobTypeId) || j.jobStatus === 'Canceled') continue;
    if (!workByCustomer.has(j.customerId)) workByCustomer.set(j.customerId, []);
    workByCustomer.get(j.customerId).push(ms(j.createdOn));
  }
  const awaiting = estimates.filter((e) => status(e) === 'Sold' && Number.isFinite(ms(e.soldOn))
    && !(workByCustomer.get(e.customerId) ?? []).some((t) => t >= ms(e.soldOn) - 864e5)).length;
  return {
    created: estimates.filter((e) => inRange(e.createdOn, from, to)).length,
    sold: soldNow.length,
    dismissed: dismissedNow.length,
    conversion: decided ? soldNow.length / decided : null,
    soldDollars: soldNow.reduce((t, e) => t + num(e.subtotal), 0),
    acceptedAwaitingBooking: awaiting,
  };
}

export function jobMeasures(jobs, { from, to }, cfg = DEFAULT_CONFIG) {
  const est = new Set(cfg.estimateJobTypeIds);
  const made = jobs.filter((j) => inRange(j.createdOn, from, to) && j.jobStatus !== 'Canceled');
  const netBookings = made.filter((j) => !est.has(j.jobTypeId)).reduce((s, j) => s + num(j.total), 0);
  const vanRolls = made.filter((j) => num(j.total) === 0 && j.jobStatus === 'Completed').length;
  return { jobsCreated: made.length, netBookings, vanRollsWithoutCommitment: vanRolls };
}

// ---- tasks, invoices -------------------------------------------------------
export function overdueTasks(tasks, now = Date.now(), cfg = DEFAULT_CONFIG, typeNamesById = {}) {
  return tasks.filter((t) => !t.isClosed && t.active !== false && t.completeBy && ms(t.completeBy) < now)
    .filter((t) => !cfg.followUpTaskTypeNames || cfg.followUpTaskTypeNames.includes(typeNamesById[t.employeeTaskTypeId])).length;
}

// Follow-up: open leads past their follow-up date; open estimates older than the window (no due date exists).
export function overdueFollowUps(leads, estimates, now = Date.now(), cfg = DEFAULT_CONFIG, rawCalls = []) {
  const overdueLeads = leads.filter((l) => l.status === 'Open' && l.followUpDate && ms(l.followUpDate) < now).length;
  const outboundByCustomer = new Map();
  for (const c of rawCalls.map(normalizeCall)) {
    if (c.direction !== 'Outbound' || !c.customerId || !Number.isFinite(c.at)) continue;
    if (!outboundByCustomer.has(c.customerId)) outboundByCustomer.set(c.customerId, []);
    outboundByCustomer.get(c.customerId).push(c.at);
  }
  const stages = cfg.estimateFollowUpStagesDays;
  const maxAge = cfg.estimateFollowUpMaxDays * 864e5;
  let overdueEstimates = 0;
  const byStage = stages.map(() => 0);
  for (const e of estimates) {
    if ((e.status?.name ?? e.status) !== 'Open') continue;
    const created = ms(e.createdOn);
    const age = now - created;
    if (!Number.isFinite(created) || age > maxAge) continue;
    const calls = outboundByCustomer.get(e.customerId) ?? [];
    // First stage that has come due and has no outbound call since the previous boundary.
    const missed = stages.findIndex((days, i) => age >= days * 864e5 && !calls.some((t) => t >= created + (i === 0 ? 0 : stages[i - 1] * 864e5)));
    if (missed >= 0) { overdueEstimates++; byStage[missed]++; }
  }
  return { leads: overdueLeads, estimates: overdueEstimates, estimatesByStage: byStage, total: overdueLeads + overdueEstimates };
}


// Inputs for the monthly pool: net bookings (sold estimates + non-estimate job totals) and revenue.
export function monthlyInputs(data, window, cfg = DEFAULT_CONFIG) {
  const est = estimateMeasures(data.estimates ?? [], data.jobs ?? [], window, cfg);
  const jobs = jobMeasures(data.jobs ?? [], window, cfg);
  return { bookingsActual: est.soldDollars + jobs.netBookings, soldEstimateDollars: est.soldDollars, jobDollars: jobs.netBookings, revenueActual: revenue(data.invoices ?? [], window) };
}

export function revenue(invoices, { from, to }) {
  return invoices.filter((i) => i.active !== false && inRange(i.invoiceDate ?? i.createdOn, from, to)).reduce((s, i) => s + num(i.total), 0);
}

// ---- booking tab / chat ----------------------------------------------------
// Snapshot-time check: how many bookings are still "New" (unworked), and how many of them are Web Chat.
export function bookingQueue(bookings, now = Date.now(), maxAgeMin = 0) {
  const open = bookings.filter((b) => b.status === 'New' && now - ms(b.createdOn) > maxAgeMin * MS_MIN);
  return { newBookings: open.length, newWebChats: open.filter((b) => b.source === 'Web Chat').length };
}

// Breakdown shown beside the weekly numbers so nothing is hidden: unidentified missed calls stay visible.
export function missedCallDetail(data, now = Date.now(), cfg = DEFAULT_CONFIG) {
  const r = callMeasures(data.calls ?? [], now, cfg, knownPhoneSet([...(data.leads ?? []), ...(data.openLeads ?? [])]));
  return { abandonedCalls: r.missedCalls, distinctCallers: r.callers, waitingIdentified: r.waiting.identified, waitingRepeatUnidentified: r.waiting.repeat, waitingUnidentified: r.waiting.unidentified, counted: r.waiting.counted };
}

// ---- weekly row ------------------------------------------------------------
// Produces values keyed like src/calc.js MEASURES. Measures with no automatic source stay null.
export function weeklyValues(data, { from, to }, now = Date.now(), cfg = DEFAULT_CONFIG) {
  const calls = callMeasures(data.calls ?? [], now, cfg, knownPhoneSet([...(data.leads ?? []), ...(data.openLeads ?? [])]));
  const touch = firstTouchAverage(calls.touches, leadTouchMinutes((data.leads ?? []).filter((l) => inRange(l.createdOn, from, to)), data.calls ?? [], cfg));
  const est = estimateMeasures(data.estimates ?? [], data.jobs ?? [], { from, to });
  const jobs = jobMeasures(data.jobs ?? [], { from, to }, cfg);
  return {
    firstTouch: touch === null ? null : Math.round(touch * 10) / 10,
    missedCalls: calls.unreturnedOverdue,
    handoffMisses: null, // not measured from ServiceTitan
    overdueFollowups: overdueFollowUps(data.openLeads ?? data.leads ?? [], data.estimates ?? [], now, cfg, data.followUpCalls ?? data.calls ?? []).total,
    infoAwaiting: null, // not in ServiceTitan
    estimateTurnaround: null, // "on-standard" duration not yet defined
    estimateConversion: est.conversion,
    acceptedAwaitingBooking: est.acceptedAwaitingBooking,
    routingAccuracy: null, // needs a rule
    vanRolls: jobs.vanRollsWithoutCommitment,
  };
}
