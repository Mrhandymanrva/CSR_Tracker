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

Pool total and goals, roster and attendance, quarterly scorecard scores and gate, the Outlook inbox and automation dashboard clean-queue points (booking-tab and handoff points are suggested from ServiceTitan).

## Open decisions

Decided: estimate follow-up cadence day 1/3/7; first touch judged on the average; pool pay rule for bookings and revenue (nothing below 80% of goal, straight line to full pay at 100%; confirm with the Operations Manager and Owner before payouts rely on it).

Still open: whether the "Sent to CS" handoff rule is right (proposed), whether SMS campaigns should count as estimate follow-up (not visible in ServiceTitan calls), the 30-day cutoff for open estimates (assumed), the net-bookings double-count caveat, the estimate-turnaround standard, and routing accuracy.
