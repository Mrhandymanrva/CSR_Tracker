# Pod KPI / Bonus Dashboard

Customer Operations pod dashboard: six KPI areas, daily clean-queue score, monthly 50/30/20 bonus pool, Team Lead quarterly scorecard, printable report. Numbers come live from ServiceTitan (read-only); judgment inputs stay manual.

## Run

```
copy .env.example .env      # fill in the four SERVICETITAN_* values (git-ignored)
npm start                   # http://127.0.0.1:5174
npm test
```

- `npm run probe` — read-only structure probe of the ServiceTitan endpoints (counts and field names only).
- `node scripts/dryrun.js 7` — compute the measures for the last N days and print them.
- A snapshot of the day's state is saved to `.data/snapshots/` automatically on weekdays at 4:05 pm ET while the server runs, or on demand (`POST /api/snapshot`). ServiceTitan only returns current state, so snapshots are how history is kept.

## Where things are

- `src/calc.js` — clean-queue score, pool, scorecard (mirrors the workbook; tests reproduce its numbers).
- `src/metrics.js` — ServiceTitan rows to measures. `DEFINITIONS` lists every interpretation; they print on the report.
- `src/stClient.js`, `src/collect.js`, `src/live.js` — read-only ServiceTitan access (server-side only).
- `docs/servicetitan-mapping.md` — probe-verified data mapping.

## Manual inputs (by design)

Pool total and goals, roster and attendance, quarterly scorecard scores and gate, the Outlook inbox, automation dashboard and handoff clean-queue points (the booking-tab point is suggested from ServiceTitan).

## Open decisions

Decided: estimate follow-up cadence day 1/3/7; first touch judged on the average; pool pay rule for bookings and revenue (nothing below 80% of goal, straight line to full pay at 100%; confirm with the Operations Manager and Owner before payouts rely on it).

Ignored by decision: the "Sent to CS" handoff measure (not measured; the Handoffs clean-queue point is manual).

Still open: whether SMS campaigns should count as estimate follow-up (not visible in ServiceTitan calls), the 30-day cutoff for open estimates (assumed), the net-bookings double-count caveat, the estimate-turnaround standard, and routing accuracy.

## Hosting (Railway)

Set these variables on the service (never commit them):

| Variable | Purpose |
|---|---|
| `DASHBOARD_PASSWORD` | Required when hosted. The server refuses to start without it. Sign in with any user name and this password. |
| `SERVICETITAN_TENANT_ID`, `SERVICETITAN_CLIENT_ID`, `SERVICETITAN_CLIENT_SECRET`, `SERVICETITAN_APP_KEY` | Read-only ServiceTitan access. |
| `DATA_DIR` | Optional. Point at a mounted Railway volume (for example `/data`) so daily snapshots survive redeploys. |

Railway supplies `PORT`; the server then listens on `0.0.0.0`. `/health` is open for the health check; everything else needs the password.
Dashboard data (roster, daily clean-queue points, weekly log, pool inputs, scorecard) is shared: it is stored on the server in `DATA_DIR/state.json`, so everyone sees the same data. Saves are versioned (a stale save is rejected, never silently overwritten), browsers refresh every 30 seconds, and every save is recorded in `DATA_DIR/audit.jsonl` with the person's name (the "Your name" box) and the sections changed (`GET /api/audit`). Without a Railway volume on `DATA_DIR`, all of this is lost on each deploy; the app warns when that is the case.
