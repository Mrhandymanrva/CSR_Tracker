// Read-only aggregate probe #2: node scripts/probe2.js
// Prints counts / distributions / config names only. No customer or employee identifying values.
import { createClient } from '../src/stClient.js';

const st = createClient();
if (!st.configured) { console.error('Missing .env values:', st.missing.join(', ')); process.exit(1); }
const T = '/{tenantId}';
const days = (n) => new Date(Date.now() - n * 864e5).toISOString();
const tally = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const keysOf = (o) => (o && typeof o === 'object' ? Object.keys(o).join(',') : typeof o);
const section = (t) => console.log(`\n=== ${t}`);

// 1. Job types: find the Estimate type(s)
section('job types (all pages)');
const jt = await st.getAll(`/jpm/v2/tenant${T}/job-types`, { active: 'Any' }, { pageSize: 200 });
console.log('count', jt.length, '| classes', JSON.stringify(tally(jt, (j) => j.class ?? 'none')));
for (const j of jt.filter((j) => /estimate|quote|consult|walk/i.test(j.name))) console.log('  candidate:', j.id, JSON.stringify(j.name), 'class=' + j.class, 'active=' + j.active);

// 2. Jobs, last 30 days: status mix and what `total` looks like
section('jobs created last 30d');
const jobs = await st.getAll(`/jpm/v2/tenant${T}/jobs`, { createdOnOrAfter: days(30) }, { pageSize: 200, maxPages: 15 });
console.log('count', jobs.length, '| status', JSON.stringify(tally(jobs, (j) => j.jobStatus)));
console.log('total>0:', jobs.filter((j) => j.total > 0).length, '| total==0:', jobs.filter((j) => j.total === 0).length, '| total null:', jobs.filter((j) => j.total == null).length, '| noCharge:', jobs.filter((j) => j.noCharge).length);
console.log('with createdById:', jobs.filter((j) => j.createdById).length, '| with soldById:', jobs.filter((j) => j.soldById).length, '| appointmentCount==0:', jobs.filter((j) => j.appointmentCount === 0).length);
const estTypeIds = new Set(jt.filter((j) => /estimate/i.test(j.name)).map((j) => j.id));
const est = jobs.filter((j) => estTypeIds.has(j.jobTypeId));
console.log('estimate-type jobs:', est.length, '| their total>0:', est.filter((j) => j.total > 0).length, '| status', JSON.stringify(tally(est, (j) => j.jobStatus)));

// 3. Call export: linkage fields and mix
section('calls export (last 14d)');
const calls = await st.getAll(`/telecom/v2/tenant${T}/export/calls`, { createdOnOrAfter: days(14) }, { pageSize: 5000, maxPages: 3 });
console.log('count', calls.length);
const c0 = calls.find((c) => c.customer && c.agent) ?? calls[0] ?? {};
console.log('nested keys -> customer:', keysOf(c0.customer), '| agent:', keysOf(c0.agent), '| lead:', keysOf(c0.lead), '| job:', keysOf(c0.job), '| createdBy:', keysOf(c0.createdBy), '| from/to types:', typeof c0.from, typeof c0.to);
console.log('direction', JSON.stringify(tally(calls, (c) => c.direction)), '| type', JSON.stringify(tally(calls, (c) => c.type)));
console.log('inbound Abandoned:', calls.filter((c) => c.direction === 'Inbound' && c.type === 'Abandoned').length,
  '| with voiceMailPath:', calls.filter((c) => c.voiceMailPath).length,
  '| with customer id:', calls.filter((c) => c.customer?.id).length,
  '| with agent id:', calls.filter((c) => c.agent?.id).length,
  '| outbound with agent:', calls.filter((c) => c.direction === 'Outbound' && c.agent?.id).length);
const dates = calls.map((c) => c.createdOn).sort();
console.log('createdOn range', dates[0], '->', dates.at(-1));

// 4. Task types and sources (configuration names)
section('task management lookup');
try {
  const d = await st.get(`/taskmanagement/v2/tenant${T}/data`);
  for (const k of ['taskTypes', 'taskSources', 'taskResolutions', 'taskPriorities']) if (d[k]) console.log(k, JSON.stringify((d[k] ?? []).map((x) => x.name ?? x)).slice(0, 600));
  console.log('top-level keys:', Object.keys(d).join(','));
} catch (e) { console.log('lookup failed', e.message); }
const tasks = await st.getAll(`/taskmanagement/v2/tenant${T}/tasks`, { isClosed: 'false' }, { pageSize: 200, maxPages: 5 });
console.log('open tasks sampled:', tasks.length, '| with completeBy:', tasks.filter((t) => t.completeBy).length, '| overdue now:', tasks.filter((t) => t.completeBy && new Date(t.completeBy) < new Date()).length, '| with assignedToId:', tasks.filter((t) => t.assignedToId).length);

// 5. Employee roles (role names are configuration)
section('employee roles');
const emps = await st.getAll(`/settings/v2/tenant${T}/employees`, { active: 'True' }, { pageSize: 200, maxPages: 5 });
console.log('active employees:', emps.length, '| role', JSON.stringify(tally(emps, (e) => (typeof e.role === 'string' ? e.role : e.role?.name ?? 'none'))), '| with agentId:', emps.filter((e) => e.agentId).length);
