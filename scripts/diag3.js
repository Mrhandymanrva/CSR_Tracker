// Read-only: open-task mix by type/source/age. Config names and counts only.
import { createClient } from '../src/stClient.js';
const st = createClient();
const T = '/{tenantId}';
const tally = (a, f) => a.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const lookup = await st.get(`/taskmanagement/v2/tenant${T}/data`);
const types = Object.fromEntries(lookup.taskTypes.map((x) => [x.id, x.name]));
const sources = Object.fromEntries(lookup.taskSources.map((x) => [x.id, x.name]));
const tasks = await st.getAll(`/taskmanagement/v2/tenant${T}/tasks`, { isClosed: 'false' }, { pageSize: 200, maxPages: 10 });
const now = Date.now();
const overdue = tasks.filter((t) => t.completeBy && Date.parse(t.completeBy) < now);
const ageBucket = (t) => { const d = (now - Date.parse(t.completeBy)) / 864e5; return d < 1 ? '<1d' : d < 7 ? '1-7d' : d < 30 ? '7-30d' : '30d+'; };
console.log('open', tasks.length, '| overdue', overdue.length);
console.log('open by type:', JSON.stringify(tally(tasks, (t) => types[t.employeeTaskTypeId] ?? 'none')));
console.log('overdue by type:', JSON.stringify(tally(overdue, (t) => types[t.employeeTaskTypeId] ?? 'none')));
console.log('overdue by type x age:', JSON.stringify(tally(overdue, (t) => `${types[t.employeeTaskTypeId] ?? 'none'} ${ageBucket(t)}`)));
console.log('overdue by source:', JSON.stringify(tally(overdue, (t) => sources[t.employeeTaskSourceId] ?? 'none')));
console.log('task names (overdue, top):', JSON.stringify(Object.entries(tally(overdue, (t) => String(t.name).replace(/\d+/g, '#').slice(0, 40))).sort((a, b) => b[1] - a[1]).slice(0, 8)));
console.log('with lead-like link: jobId', overdue.filter((t) => t.jobId).length, '| customerId', overdue.filter((t) => t.customerId).length);
