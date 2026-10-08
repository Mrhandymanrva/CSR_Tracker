// Fetches the raw ServiceTitan rows the metrics need for a date window. Read-only.
// Date-filter parameter names below were verified against the live tenant (probe 3/4).
const T = '/{tenantId}';

export async function collect(st, { from, to }, { onProgress = () => {} } = {}) {
  const f = new Date(from).toISOString();
  const t = new Date(to).toISOString();
  const step = async (name, fn) => { const rows = await fn(); onProgress(name, rows.length); return rows; };
  const opts = { pageSize: 200, maxPages: 40 };
  // Wide lookback for jobs: sold estimates may point at jobs created before the window.
  const jobsFrom = new Date(from - 90 * 864e5).toISOString();
  // Open leads can be older than the window; their follow-up date is what matters.
  const leadsFrom = new Date(from - 90 * 864e5).toISOString();
  const [calls, leads, estimates, jobs, tasks, invoices, bookings, taskLookup, openLeadsAll] = await Promise.all([
    step('calls', () => st.getAll(`/telecom/v2/tenant${T}/calls`, { createdOnOrAfter: f, createdBefore: t }, opts)),
    step('leads', () => st.getAll(`/crm/v2/tenant${T}/leads`, { createdOnOrAfter: f, createdBefore: t }, opts)),
    step('estimates', () => st.getAll(`/sales/v2/tenant${T}/estimates`, { createdOnOrAfter: jobsFrom, createdBefore: t }, opts)),
    step('jobs', () => st.getAll(`/jpm/v2/tenant${T}/jobs`, { createdOnOrAfter: jobsFrom, createdBefore: t }, opts)),
    step('tasks', () => st.getAll(`/taskmanagement/v2/tenant${T}/tasks`, { isClosed: 'false' }, opts)),
    step('invoices', () => st.getAll(`/accounting/v2/tenant${T}/invoices`, { invoicedOnOrAfter: f, invoicedOnBefore: t }, opts)),
    step('bookings', () => st.getAll(`/crm/v2/tenant${T}/bookings`, { createdOnOrAfter: f, createdBefore: t }, opts)),
    st.get(`/taskmanagement/v2/tenant${T}/data`),
    step('leads (90d, for follow-up)', () => st.getAll(`/crm/v2/tenant${T}/leads`, { createdOnOrAfter: leadsFrom, createdBefore: t }, opts)),
  ]);
  const openLeads = openLeadsAll.filter((l) => l.status === 'Open');
  const taskTypeNames = Object.fromEntries((taskLookup.taskTypes ?? []).map((x) => [x.id, x.name]));
  return { calls, leads, openLeads, estimates, jobs, tasks, invoices, bookings, taskTypeNames };
}
