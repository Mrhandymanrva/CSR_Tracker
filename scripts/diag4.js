// Read-only: do leads/estimates carry follow-up due dates? Counts and age buckets only.
import { createClient } from '../src/stClient.js';
const st = createClient();
const T = '/{tenantId}';
const now = Date.now();
const tally = (a, f) => a.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const days = (iso) => (now - Date.parse(iso)) / 864e5;
const bucket = (d) => (d < 0 ? 'future' : d < 1 ? '<1d' : d < 3 ? '1-3d' : d < 7 ? '3-7d' : d < 14 ? '7-14d' : d < 30 ? '14-30d' : '30d+');

const leads = await st.getAll(`/crm/v2/tenant${T}/leads`, { createdOnOrAfter: new Date(now - 60 * 864e5).toISOString() }, { pageSize: 200, maxPages: 15 });
const open = leads.filter((l) => l.status === 'Open');
console.log('leads 60d:', leads.length, JSON.stringify(tally(leads, (l) => l.status)));
console.log('OPEN leads:', open.length, '| with followUpDate:', open.filter((l) => l.followUpDate).length);
console.log('  followUpDate vs now:', JSON.stringify(tally(open.filter((l) => l.followUpDate), (l) => bucket(days(l.followUpDate)))));
console.log('  open lead age since created:', JSON.stringify(tally(open, (l) => bucket(days(l.createdOn)))));
console.log('  open leads with a customer:', open.filter((l) => l.customerId).length, '| with callId:', open.filter((l) => l.callId).length, '| with bookingId:', open.filter((l) => l.bookingId).length);

const ests = await st.getAll(`/sales/v2/tenant${T}/estimates`, { createdOnOrAfter: new Date(now - 60 * 864e5).toISOString() }, { pageSize: 200, maxPages: 15 });
const oe = ests.filter((e) => (e.status?.name ?? e.status) === 'Open');
console.log('\nOPEN estimates (60d created):', oe.length, '| age since created:', JSON.stringify(tally(oe, (e) => bucket(days(e.createdOn)))));
console.log('  estimate keys that could hold a follow-up date:', Object.keys(ests[0] ?? {}).filter((k) => /follow|due|remind|expire|date/i.test(k)).join(',') || 'none');
console.log('  externalLinks present:', oe.filter((e) => e.externalLinks?.length).length);
