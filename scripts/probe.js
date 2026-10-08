// Read-only probe: node scripts/probe.js
// For each endpoint the dashboard may need, pulls a small recent sample and reports ONLY structure:
// HTTP result, row count, field names + types, and distinct values of a few categorical fields.
// No customer names, phones, addresses or free text are printed or saved. Output: probe-output/report.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '../src/stClient.js';

const st = createClient();
if (!st.configured) {
  console.error(`Missing in .env: ${st.missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  process.exit(1);
}

const iso = (d) => d.toISOString();
const since = new Date(Date.now() - 14 * 864e5);
const T = '/{tenantId}';

// categorical fields safe to enumerate (status/type/direction style values, never names or contact info)
const CATEGORICAL = /^(status|jobStatus|direction|callType|callStatus|reason|type|priority|isClosed|noCharge|jobTypeId|businessUnitId|campaignId|source)$/i;

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

function shape(rows) {
  const fields = {};
  const distinct = {};
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    for (const [k, v] of Object.entries(r)) {
      (fields[k] ??= new Set()).add(typeOf(v));
      if (CATEGORICAL.test(k) && ['string', 'number', 'boolean'].includes(typeof v)) (distinct[k] ??= new Set()).add(v);
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.name === 'string' && /status|type|source|reason/i.test(k)) (distinct[`${k}.name`] ??= new Set()).add(v.name);
    }
  }
  return {
    fields: Object.fromEntries(Object.entries(fields).map(([k, s]) => [k, [...s].join('|')])),
    distinct: Object.fromEntries(Object.entries(distinct).map(([k, s]) => [k, [...s].slice(0, 15)])),
  };
}

const probes = [
  ['estimates', `/sales/v2/tenant${T}/estimates`, { createdOnOrAfter: iso(since) }],
  ['jobs', `/jpm/v2/tenant${T}/jobs`, { createdOnOrAfter: iso(since) }],
  ['job-types (names only)', `/jpm/v2/tenant${T}/job-types`, { active: 'Any' }],
  ['appointments', `/jpm/v2/tenant${T}/appointments`, { startsOnOrAfter: iso(since) }],
  ['leads', `/crm/v2/tenant${T}/leads`, { modifiedOnOrAfter: iso(since) }],
  ['tag-types', `/settings/v2/tenant${T}/tag-types`, {}],
  ['tasks (list)', `/taskmanagement/v2/tenant${T}/tasks`, {}],
  ['calls v3', `/telecom/v3/tenant${T}/calls`, { createdOnOrAfter: iso(since) }],
  ['calls export v2', `/telecom/v2/tenant${T}/export/calls`, {}],
  ['invoices', `/accounting/v2/tenant${T}/invoices`, { invoicedOnOrAfter: iso(since) }],
  ['employees', `/settings/v2/tenant${T}/employees`, { active: 'True' }],
];

const report = { generatedAt: new Date().toISOString(), windowDays: 14, results: {} };

for (const [label, path, params] of probes) {
  try {
    const body = await st.get(path, { ...params, page: 1, pageSize: 25 });
    const rows = Array.isArray(body) ? body : body.data ?? [];
    const out = { ok: true, rowsInSample: rows.length, hasMore: body.hasMore ?? null, totalCount: body.totalCount ?? null, ...shape(rows) };
    // job-type names are configuration, not customer data: list them so "estimate" job types can be identified
    if (label.startsWith('job-types')) out.jobTypeNames = rows.map((r) => r.name).filter(Boolean);
    report.results[label] = out;
    console.log(`OK    ${label}: ${rows.length} rows, ${Object.keys(out.fields).length} fields`);
  } catch (e) {
    report.results[label] = { ok: false, status: e.status ?? null, error: e.message };
    console.log(`FAIL  ${label}: ${e.message}`);
  }
}

mkdirSync(new URL('../probe-output/', import.meta.url), { recursive: true });
writeFileSync(new URL('../probe-output/report.json', import.meta.url), JSON.stringify(report, null, 2));
console.log('\nWrote probe-output/report.json (structure only).');
