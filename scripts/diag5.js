// Read-only: how are handoffs ("Sent to CS") represented? Counts only.
import { createClient } from '../src/stClient.js';
const st = createClient();
const T = '/{tenantId}';
const now = Date.now();
const tally = (a, f) => a.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const tags = await st.getAll(`/settings/v2/tenant${T}/tag-types`, {}, { pageSize: 200, maxPages: 10 });
const match = tags.filter((t) => /sent.?to.?cs|handoff|hand.?off|cs\b|coordinator|client coord/i.test(t.name));
console.log('tag types total', tags.length, '| handoff-like:', JSON.stringify(match.map((t) => `${t.id}:${t.name}:active=${t.active}`)));
const leads = await st.getAll(`/crm/v2/tenant${T}/leads`, { createdOnOrAfter: new Date(now - 60 * 864e5).toISOString() }, { pageSize: 200, maxPages: 15 });
for (const t of match) {
  const withTag = leads.filter((l) => l.tagTypeIds?.includes(t.id));
  const open = withTag.filter((l) => l.status === 'Open');
  const overdue = open.filter((l) => l.followUpDate && Date.parse(l.followUpDate) < now);
  console.log(`tag "${t.name}": leads 60d ${withTag.length} | status ${JSON.stringify(tally(withTag, (l) => l.status))} | open overdue ${overdue.length}`);
}
const allOpenOverdue = leads.filter((l) => l.status === 'Open' && l.followUpDate && Date.parse(l.followUpDate) < now).length;
console.log('all open overdue leads:', allOpenOverdue, '| open leads carrying any handoff-like tag:', leads.filter((l) => l.status === 'Open' && match.some((t) => l.tagTypeIds?.includes(t.id))).length);
const emp = await st.get(`/taskmanagement/v2/tenant${T}/data`);
console.log('task statuses:', JSON.stringify((emp.taskStatuses ?? []).map((s) => s.name ?? s)));
