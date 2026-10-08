// Builds the single JSON payload the dashboard shows: weekly measures, missed-call breakdown, follow-ups,
// estimates, month-to-date pool inputs, booking queue. Server-side only (uses the ServiceTitan client).
import { weeklyValues, missedCallDetail, overdueFollowUps, estimateMeasures, jobMeasures, monthlyInputs, bookingQueue, leadTouchMinutes, callMeasures, knownPhoneSet, DEFINITIONS, DEFAULT_CONFIG } from './metrics.js';

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

export async function buildLive(st, collect, now = Date.now(), cfg = DEFAULT_CONFIG) {
  const weekFrom = now - 7 * 864e5;
  const d = new Date(now);
  const monthFrom = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  // Calls reach back far enough to check estimate follow-up stages (max estimate age + 1 day).
  const from = Math.min(weekFrom, monthFrom, now - (cfg.estimateFollowUpMaxDays + 1) * 864e5);
  const data = await collect(st, { from, to: now });

  const week = { from: weekFrom, to: now };
  const month = { from: monthFrom, to: now };
  const weekLeads = data.leads.filter((l) => Date.parse(l.createdOn) >= weekFrom);
  const callsInWeek = data.calls.filter((c) => Date.parse((c.leadCall ?? c).receivedOn ?? (c.leadCall ?? c).createdOn) >= weekFrom);
  const weekData = { ...data, calls: callsInWeek, leads: weekLeads, followUpCalls: data.calls };

  const calls = callMeasures(callsInWeek, now, cfg, knownPhoneSet([...weekLeads, ...data.openLeads]));
  const leadTouches = leadTouchMinutes(weekLeads, data.calls, cfg);
  const allTouches = [...calls.touches, ...leadTouches];

  return {
    pulledAt: new Date(now).toISOString(),
    window: { weekFrom: new Date(weekFrom).toISOString(), monthFrom: new Date(monthFrom).toISOString(), to: new Date(now).toISOString() },
    weekly: weeklyValues(weekData, week, now, cfg),
    firstTouch: { averageMinutes: round1(allTouches.length ? allTouches.reduce((a, b) => a + b, 0) / allTouches.length : null), medianMinutes: round1(median(allTouches)), touched: allTouches.length, leadsInWeek: weekLeads.length },
    missedCalls: missedCallDetail(weekData, now, cfg),
    followUps: overdueFollowUps(data.openLeads, data.estimates, now, cfg, data.calls),
    estimates: estimateMeasures(data.estimates, data.jobs, week, cfg),
    jobs: jobMeasures(data.jobs, week, cfg),
    bookingQueue: bookingQueue(data.bookings, now),
    month: { ...monthlyInputs(data, month, cfg), jobs: jobMeasures(data.jobs, month, cfg), estimates: estimateMeasures(data.estimates, data.jobs, month, cfg) },
    config: { estimateFollowUpStagesDays: cfg.estimateFollowUpStagesDays, estimateFollowUpMaxDays: cfg.estimateFollowUpMaxDays, missedCallGraceMinutes: cfg.missedCallGraceMinutes, businessHours: cfg.businessHours },
    definitions: DEFINITIONS,
  };
}
