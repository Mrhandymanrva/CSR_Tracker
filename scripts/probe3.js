// Read-only probe #3: call endpoint date filtering, job total vs status, agent id vs employee id. Aggregates only.
import { createClient } from '../src/stClient.js';
const st = createClient();
const T = '/{tenantId}';
const days = (n) => new Date(Date.now() - n * 864e5).toISOString();
const tally = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const range = (rows, f) => { const d = rows.map(f).filter(Boolean).sort(); return d.length ? `${d[0].slice(0, 10)} -> ${d.at(-1).slice(0, 10)}` : 'none'; };

for (const [label, path, params] of [
  ['v2 calls createdOnOrAfter', `/telecom/v2/tenant${T}/calls`, { createdOnOrAfter: days(7) }],
  ['v2 calls modifiedOnOrAfter', `/telecom/v2/tenant${T}/calls`, { modifiedOnOrAfter: days(7) }],
  ['v3 calls createdAfter', `/telecom/v3/tenant${T}/calls`, { createdAfter: days(7) }],
  ['export calls from=date', `/telecom/v2/tenant${T}/export/calls`, { from: days(7) }],
]) {
  try {
    const b = await st.get(path, { ...params, pageSize: 200, page: 1 });
    const rows = b.data ?? [];
    const created = (r) => r.createdOn ?? r.leadCall?.createdOn ?? r.leadCall?.receivedOn;
    console.log(`${label}: ${rows.length} rows, hasMore=${b.hasMore}, continueFrom=${b.continueFrom ? 'yes' : 'no'}, createdOn ${range(rows, created)}`);
    if (rows[0]) console.log('   top keys:', Object.keys(rows[0]).join(','), '| leadCall keys:', Object.keys(rows[0].leadCall ?? {}).join(','));
  } catch (e) { console.log(`${label}: FAIL ${e.message}`); }
}

const jobs = await st.getAll(`/jpm/v2/tenant${T}/jobs`, { createdOnOrAfter: days(30) }, { pageSize: 200, maxPages: 15 });
console.log('\njobs by status x total>0:', JSON.stringify(tally(jobs, (j) => `${j.jobStatus}:${j.total > 0 ? 'paid>0' : 'zero'}`)));
const sum = (a) => Math.round(a.reduce((s, j) => s + (j.total || 0), 0));
console.log('sum total non-canceled non-estimate:', sum(jobs.filter((j) => j.jobStatus !== 'Canceled' && j.jobTypeId !== 239517159)));
console.log('jobs with estimateIds:', jobs.filter((j) => j.estimateIds?.length).length, '| createdFromEstimateId:', jobs.filter((j) => j.createdFromEstimateId).length);

const ests = await st.getAll(`/sales/v2/tenant${T}/estimates`, { createdOnOrAfter: days(30) }, { pageSize: 200, maxPages: 10 });
console.log('\nestimates 30d:', ests.length, JSON.stringify(tally(ests, (e) => e.status?.name)), '| sold subtotal sum:', Math.round(ests.filter((e) => e.status?.name === 'Sold').reduce((s, e) => s + (e.subtotal || 0), 0)), '| soldOn set:', ests.filter((e) => e.soldOn).length, '| createdById set:', ests.filter((e) => e.createdById).length);

const emps = await st.getAll(`/settings/v2/tenant${T}/employees`, { active: 'True' }, { pageSize: 200, maxPages: 5 });
const ids = new Set(emps.map((e) => e.id));
const calls = (await st.get(`/telecom/v2/tenant${T}/export/calls`, { pageSize: 500, page: 1 })).data ?? [];
const agents = calls.map((c) => c.agent?.id).filter(Boolean);
console.log('\nagent ids matching employee ids:', agents.filter((a) => ids.has(a)).length, '/', agents.length);
const dispatch = emps.filter((e) => e.role === 'Dispatch');
console.log('Dispatch-role employees:', dispatch.length, '| are job createdById in employee set:', jobs.filter((j) => ids.has(j.createdById)).length, '/', jobs.length);
