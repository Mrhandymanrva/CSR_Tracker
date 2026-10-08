# ServiceTitan data mapping (draft, from read-only review of CSR-Tool)

Status key: **used** = CSR-Tool already calls it; **feasible** = endpoint exists in ST but CSR-Tool doesn't use it for this (unverified until probed); **unknown** = needs a definition from Mason.
Everything marked "unverified" must be confirmed against the Richmond tenant with a read-only probe before the calc depends on it.

| Measure | Source | Status |
|---|---|---|
| Missed calls / VM overdue | `GET /telecom/v3/tenant/{t}/calls` (also export/calls). Fields for answered/abandoned are not used anywhere in CSR-Tool | feasible; probe real rows first |
| First human touch (min) | Lead `createdOn` (`/crm/v2/.../leads`) or call start vs first outbound call by an agent | feasible; definition needed |
| Estimate turnaround on-standard | Estimates list `createdOn` minus job/lead `createdOn`. "Sent" time is only known locally in CSR-Tool | feasible; definition needed |
| Estimate conversion, $ | `GET /sales/v2/tenant/{t}/estimates` (`status`, `soldOn`, `dismissedOn`, `total`) | **used** |
| Accepted awaiting booking | Sold estimate whose job has no appointment (`/jpm/v2/.../appointments?jobId=`) | feasible |
| Net job bookings $ excl. estimate jobs | `GET /jpm/v2/tenant/{t}/jobs` (`createdOn`, `jobTypeId`, `total`, `jobStatus`) + `/job-types`. No "estimate" flag exists; need a job-type name/ID list | feasible; list needed |
| Overdue follow-ups, handoff misses | ST task list read (`/taskmanagement/v2/.../tasks`) is not used by CSR-Tool (create only) | feasible; unverified |
| Lead disposition, routing accuracy | Leads are readable; no status read; no completeness metric exists | unknown |
| Van-rolls without commitment | No such concept in CSR-Tool | unknown; define "commitment" |
| Company revenue | No invoice/report call anywhere. Likely `/accounting/v2/.../invoices`; app-key scope unproven | feasible; unverified |
| CSR attribution | Employees endpoint **used**; estimate/job `createdById` not confirmed returned | probe |

## Client pattern to copy (not import)
- Token: POST form `client_credentials` with client_id, client_secret, app_key to the auth URL; cache and refresh 60 s early.
- Requests: `Authorization: Bearer`, `ST-App-Key`; base `https://api.servicetitan.io`; `{tenantId}` in path templates.
- Lists: `{page,pageSize,hasMore,data[]}`; loop on `hasMore` with a max-page bound.
- CSR-Tool has no 429/backoff handling; the new client should add it.
- Credentials via env: `SERVICETITAN_TENANT_ID`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_APP_KEY`.

## Cannot be rebuilt after the fact, so snapshot daily
Open-lead state, tag-applied times, task overdue state at a point in time, and "estimate status as of day X". ST returns current state only. The daily job must store these.

---
## Verified by live probe (Oct 8, 2026; 25-row samples, 14-day window, structure only)
All 11 endpoints readable with the current app credentials, including invoices, tasks and both call endpoints.

| Measure | What the live data shows | Verdict |
|---|---|---|
| Missed calls / VM | `export/calls` rows carry `direction` (Inbound/Outbound), `type` (**Booked, Abandoned, Unbooked, NotLead, Excused**), `agent`, `duration`, `voiceMailPath`, `reason`, `lead`. Abandoned inbound = missed | **Automatable** |
| First human touch | No single field. Derive: for each inbound Abandoned/voicemail call, time to the next Outbound call to the same customer/number. Needs a rule from Mason | Automatable once defined |
| Estimate conversion, turnaround, $ | Estimates have `status.name` (Open/Sold seen), `soldOn`, `soldBy`, `createdById`, `jobId`, `createdOn`, `subtotal`. Jobs have `estimateIds`, `createdFromEstimateId` | **Automatable** |
| Accepted awaiting booking | Sold estimate -> `jobId` -> job `appointmentCount` == 0 / `firstAppointmentId` null | **Automatable** |
| Net bookings $ excl. estimate jobs | Jobs have `createdOn`, `total`, `jobTypeId`, `jobStatus`, `noCharge`. First 25 job types are trade types (e.g. "PA: Painting"); no "Estimate" type seen yet. Job types also have a `class` field. Need the full job-type list | Automatable; classification rule needed |
| Overdue follow-ups / handoffs | Tasks have `isClosed`, `status`, `completeBy`, `assignedToId`, `employeeTaskTypeId`, `reportedOn`, `closedOn`. Overdue = open and `completeBy` < now | **Automatable** |
| Lead disposition / routing | Leads have `status` (Open/Dismissed), `dismissingReasonId`, `followUpDate`, `tagTypeIds`, `createdById`, `campaignId`, `jobTypeId` | Automatable; "accuracy" needs a rule |
| Company revenue | Invoices have `total`, `invoiceDate`, `balance`, `businessUnit`, `job` | **Automatable** |
| CSR attribution | `createdById` on estimates, jobs, leads, appointments, calls (`agent`). Employees have `role`, `agentId`, `active` | **Automatable** |
| Van-rolls without commitment | Appointments have `status` (Scheduled/Done/Canceled/Hold); "commitment" has no field | Needs definition |

Paging note: `export/calls` returned 5000 rows in one page with `hasMore`; page through with care.
