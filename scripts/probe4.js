// Read-only probe #4: where does ServiceTitan chat show up? Aggregates and field names only.
import { createClient } from '../src/stClient.js';
const st = createClient();
const T = '/{tenantId}';
const days = (n) => new Date(Date.now() - n * 864e5).toISOString();
const tally = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});

const leads = await st.getAll(`/crm/v2/tenant${T}/leads`, { createdOnOrAfter: days(30) }, { pageSize: 200, maxPages: 10 });
console.log('leads 30d:', leads.length, '| captureSource', JSON.stringify(tally(leads, (l) => l.captureSource ?? 'null')), '| status', JSON.stringify(tally(leads, (l) => l.status)));

for (const [label, path, params] of [
  ['bookings', `/crm/v2/tenant${T}/bookings`, { createdOnOrAfter: days(30) }],
  ['booking-provider-tags', `/crm/v2/tenant${T}/booking-provider-tags`, {}],
  ['campaigns', `/marketing/v2/tenant${T}/campaigns`, { active: 'Any' }],
  ['v3 calls', `/telecom/v3/tenant${T}/calls`, { createdAfter: days(30) }],
]) {
  try {
    const rows = await st.getAll(path, params, { pageSize: 200, maxPages: 5 });
    const r0 = rows[0] ?? {};
    console.log(`\n${label}: ${rows.length} rows | keys: ${Object.keys(r0).join(',')}`);
    if (label === 'bookings') console.log('  source', JSON.stringify(tally(rows, (b) => b.source ?? 'null')), '| status', JSON.stringify(tally(rows, (b) => b.status ?? 'null')), '| contactMethod', JSON.stringify(tally(rows, (b) => b.contactMethod ?? 'null')));
    if (label === 'campaigns') console.log('  names matching chat/web/text:', JSON.stringify(rows.filter((c) => /chat|web|text|sms|messag/i.test(c.name)).map((c) => `${c.id}:${c.name}`)));
    if (label === 'v3 calls') console.log('  callType', JSON.stringify(tally(rows, (c) => c.leadCall?.callType ?? 'null')), '| direction', JSON.stringify(tally(rows, (c) => c.leadCall?.direction ?? 'null')));
  } catch (e) { console.log(`\n${label}: FAIL ${e.message}`); }
}
