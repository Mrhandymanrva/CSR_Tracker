// Read-only: does /calls miss outbound calls that export/calls has? Aggregates only.
import { createClient } from '../src/stClient.js';
const st = createClient();
const T = '/{tenantId}';
const to = Date.now(), from = to - 7 * 864e5;
const tally = (a, f) => a.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const last10 = (s) => String(s ?? '').replace(/\D/g, '').slice(-10);

const viaCalls = (await st.getAll(`/telecom/v2/tenant${T}/calls`, { createdOnOrAfter: new Date(from).toISOString() }, { pageSize: 200, maxPages: 40 })).map((r) => r.leadCall ?? r);

// export endpoint: continuation token paging
let rows = [], cont = null, pages = 0;
do {
  const b = await st.get(`/telecom/v2/tenant${T}/export/calls`, cont ? { from: cont } : { from: new Date(from).toISOString() });
  rows.push(...(b.data ?? [])); cont = b.hasMore ? b.continueFrom : null; pages++;
} while (cont && pages < 30);
const inWin = rows.filter((r) => Date.parse(r.createdOn) >= from);
console.log('/calls rows:', viaCalls.length, JSON.stringify(tally(viaCalls, (c) => `${c.direction}/${c.callType}`)));
console.log('export rows:', rows.length, 'in window:', inWin.length, 'pages', pages, JSON.stringify(tally(inWin, (c) => `${c.direction}/${c.type}`)));
console.log('export outbound with agent:', inWin.filter((c) => c.direction === 'Outbound' && c.agent?.id).length, '| with customer:', inWin.filter((c) => c.direction === 'Outbound' && c.customer?.id).length, '| duration>0:', inWin.filter((c) => c.direction === 'Outbound' && Number(c.duration) > 0).length);

const ab = inWin.filter((c) => c.direction === 'Inbound' && c.type === 'Abandoned');
const outs = inWin.filter((c) => c.direction === 'Outbound');
const byTo = new Set(outs.map((o) => last10(o.to)));
const byCust = new Set(outs.map((o) => o.customer?.id).filter(Boolean));
const hit = (c) => byTo.has(last10(c.from)) || (c.customer?.id && byCust.has(c.customer.id));
console.log('abandoned in export:', ab.length, '| ever called back (phone or customer, any time in window):', ab.filter(hit).length);
const sample = outs.slice(0, 2).map((o) => ({ to: String(o.to).replace(/\d/g, '#'), from: String(o.from).replace(/\d/g, '#') }));
const sampleAb = ab.slice(0, 2).map((o) => ({ from: String(o.from).replace(/\d/g, '#') }));
console.log('number formats outbound:', JSON.stringify(sample), '| abandoned:', JSON.stringify(sampleAb));
