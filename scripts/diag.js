// Read-only diagnostics on definitions. Prints aggregates only.
import { createClient } from '../src/stClient.js';
import { collect } from '../src/collect.js';
import { normalizeCall } from '../src/metrics.js';
const st = createClient();
const to = Date.now(), from = to - 7 * 864e5;
const d = await collect(st, { from, to });
const tally = (a, f) => a.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});

console.log('INVOICES sample types:', JSON.stringify(d.invoices.slice(0, 3).map((i) => ({ total: [typeof i.total, i.total], invoiceDate: i.invoiceDate, createdOn: i.createdOn, active: i.active, type: i.invoiceType }))));

const raw = d.calls.map((r) => r.leadCall ?? r);
const ab = raw.filter((c) => c.direction === 'Inbound' && c.callType === 'Abandoned');
console.log('\nABANDONED inbound:', ab.length, '| has customer:', ab.filter((c) => c.customer?.id).length, '| has agent:', ab.filter((c) => c.agent?.id).length,
  '| duration buckets', JSON.stringify(tally(ab, (c) => { const s = Number(c.duration) || 0; return s === 0 ? '0' : s < 15 ? '<15s' : s < 60 ? '<60s' : '60s+'; })),
  '| reason set:', ab.filter((c) => c.reason).length);
console.log('  reason names:', JSON.stringify(tally(ab, (c) => c.reason?.name ?? 'none')).slice(0, 300));
const phones = tally(ab, (c) => String(c.from).replace(/\D/g, '').slice(-10));
console.log('  distinct callers:', Object.keys(phones).length, '| callers with 2+ missed:', Object.values(phones).filter((n) => n > 1).length);
console.log('  call types overall:', JSON.stringify(tally(raw, (c) => `${c.direction}/${c.callType}`)).slice(0, 400));
const out = d.calls.map(normalizeCall).filter((c) => c.direction === 'Outbound');
const returned24 = ab.filter((c) => { const at = Date.parse(c.receivedOn ?? c.createdOn); const ph = String(c.from).replace(/\D/g, '').slice(-10); return out.some((o) => o.at > at && o.at - at < 864e5 && (o.to === ph || (c.customer?.id && o.customerId === c.customer.id))); }).length;
console.log('  returned within 24h by phone/customer:', returned24, 'of', ab.length);

const est = d.estimates, jobs = d.jobs;
const sold = est.filter((e) => (e.status?.name ?? e.status) === 'Sold');
const jobById = new Map(jobs.map((j) => [j.id, j]));
const byProject = new Map();
for (const j of jobs) (byProject.get(j.projectId) ?? byProject.set(j.projectId, []).get(j.projectId)).push(j);
const hasWorkJob = (e) => (byProject.get(e.projectId) ?? []).some((j) => j.jobTypeId !== 239517159 && j.jobStatus !== 'Canceled') || jobs.some((j) => j.createdFromEstimateId === e.id);
console.log('\nSOLD estimates in lookback:', sold.length, '| soldOn in last 7d:', sold.filter((e) => Date.parse(e.soldOn) >= from).length);
console.log('  with projectId:', sold.filter((e) => e.projectId).length, '| est job is estimate-type:', sold.filter((e) => jobById.get(e.jobId)?.jobTypeId === 239517159).length);
console.log('  has separate non-estimate work job (project or createdFromEstimateId):', sold.filter(hasWorkJob).length, '| awaiting (no work job):', sold.filter((e) => !hasWorkJob(e)).length);
console.log('  of those awaiting, sold in last 30d:', sold.filter((e) => !hasWorkJob(e) && Date.parse(e.soldOn) >= to - 30 * 864e5).length);
console.log('  dismissed estimates sample keys has dismissedOn:', est.some((e) => 'dismissedOn' in e), '| statuses', JSON.stringify(tally(est, (e) => e.status?.name)));
