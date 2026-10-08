// node scripts/dryrun.js [days=7]  -- computes the measures for the last N days from live data. Prints numbers only.
import { createClient } from '../src/stClient.js';
import { collect } from '../src/collect.js';
import { weeklyValues, estimateMeasures, jobMeasures, revenue, bookingQueue, callMeasures, overdueFollowUps, monthlyInputs, missedCallDetail } from '../src/metrics.js';

const st = createClient();
if (!st.configured) { console.error('Missing .env values:', st.missing.join(', ')); process.exit(1); }
const days = Number(process.argv[2]) || 7;
const to = Date.now();
const from = to - days * 864e5;
const data = await collect(st, { from, to }, { onProgress: (n, c) => console.log(`  fetched ${n}: ${c}`) });
console.log(`\nWindow: last ${days} days`);
console.log('weekly values:', JSON.stringify(weeklyValues(data, { from, to }, to)));
console.log('missed calls:', JSON.stringify(missedCallDetail(data, to)));
console.log('estimates:', JSON.stringify(estimateMeasures(data.estimates, data.jobs, { from, to })));
console.log('jobs:', JSON.stringify(jobMeasures(data.jobs, { from, to })));
console.log('follow-ups:', JSON.stringify(overdueFollowUps(data.openLeads, data.estimates, to)));
console.log('month-style inputs for this window:', JSON.stringify(monthlyInputs(data, { from, to })));
console.log('revenue:', Math.round(revenue(data.invoices, { from, to })));
console.log('booking queue now:', JSON.stringify(bookingQueue(data.bookings, to)));
