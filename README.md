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

Pool total and goals, roster and attendance, quarterly scorecard scores and gate, the Outlook inbox, automation dashboard and handoff clean-queue points.

## Open decisions

Estimate follow-up window (3 days assumed), first-touch target and whether to use mean or median, the net-bookings double-count caveat, the linear attainment curve in the pool (needs Operations Manager and Owner sign-off).
