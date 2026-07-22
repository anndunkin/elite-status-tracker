# Elite Status Tracker — v1.3 Update Spec

Repo: `/home/user/workspace/elite-status-tracker`, pushed to
`https://github.com/anndunkin/elite-status-tracker`, currently at tag `v1.2.0` on `main`
(history was rewritten/force-pushed after v1.2.0 to strip personal data files — the repo is
now PUBLIC, so treat any new committed content as public-safe; do not add real personal
travel data to committed fixtures/docs, keep to synthetic examples).

This is an INCREMENT — read the existing code first, especially:
- `electron/database.ts` — `computeProjections(database, today: Date = new Date())` at
  ~line 545. Critically, this function ALREADY takes an optional `today` param and derives
  `programYear = currentProgramYear(today, program.year_type)`, then buckets all
  actual/estimate totals by program-year relative to that. This is the exact lever to reuse
  for the year-toggle feature below — do not build a parallel year-computation path.
- `electron/rules.ts` — `programYearOf`, tier logic.
- `electron/types.ts` — `Trip`, `TripStatus` (`'planned' | 'booked' | 'completed'`),
  `TripWithDetails`, `ProgramProjection`.
- `electron/main.ts` / `electron/preload.ts` — IPC registration conventions
  (`ipcMain.handle('projection:all', ...)`, `trips.getAll`, `trips.update`, etc.)
- `src/pages/Dashboard.tsx` — current dashboard, renders `ProgramProjection[]` from
  `window.api.projection.all()`, cards link to `/programs/:id`.
- `src/pages/Trips.tsx` — existing trip list + editor. **Important**: it already supports a
  `?edit=<tripId>` query param that opens the `TripEditor` modal pre-populated for that
  trip (see the `useEffect` reading `searchParams.get('edit')`). Reuse this deep link for
  "edit from the dashboard" rather than building a second trip editor.

Do not rewrite from scratch. Preserve all existing functionality and the 102 passing tests
unless a change below explicitly supersedes it.

Use `bash` with `api_credentials=["github"]` for all git/gh commands. Never use any GitHub
MCP/connector tool.

## 1. Dashboard: "Needs Update" section (past trips not marked completed)

Add a section to the Dashboard, above or alongside the existing program-card grid, listing
trips where:
- `start_date` (or `end_date` if present, use whichever is later/most conservative — prefer
  `end_date ?? start_date`) is in the past relative to today, AND
- `status` is NOT `'completed'` (i.e. it's still `'planned'` or `'booked'`)

Scope this to **the currently-viewed dashboard year** (see section 3 — the dashboard will
support viewing different years; this section should reflect trips whose program-year,
per `programYearOf(trip.start_date, ...)`, matches the year currently selected... but
note a trip's program-year depends on which program's entries it has, and a single trip can
have multiple program entries potentially spanning different year_types (e.g. a trip with
both a Delta entry and an American entry could map to different program-years for each
program). For this section, keep it simple: bucket by calendar year of `start_date`
(`new Date(trip.start_date).getFullYear()`) matching the selected dashboard year, not
per-program program-year — this section is about surfacing stale data-entry, not precise
per-program accounting.

**UI**: A card/panel titled "Needs Update — Past Trips Not Marked Complete" (or similar),
listing each qualifying trip with: label, date, current status badge, and an "Edit" button.
Clicking Edit navigates to `/trips?edit=<tripId>` (reuse the existing deep-link mechanism in
Trips.tsx — confirm it still works, do not reimplement). If there are zero qualifying trips,
either hide the section entirely or show a small "All past trips are up to date" success
state — do not show an empty section with just a header.

Sort by date ascending (oldest overdue first) so the most urgent items surface first.

## 2. Dashboard: "Upcoming Trips" section

Add a second section listing trips where `start_date` is today or in the future AND
`status` is `'planned'` or `'booked'` (i.e. not yet completed — this is forward-looking
travel), scoped to the same selected dashboard year as above (calendar year of
`start_date`). Show label, date(s), status badge (planned vs. booked, visually
distinguished), and an "Edit" button using the same `/trips?edit=<tripId>` deep link.

Sort by date ascending (soonest upcoming first).

Both sections should be visually distinct from the existing program-card grid (e.g. as
collapsible panels or a two-column row above the grid) and from each other (e.g. amber/warn
tone for the "needs update" section since it represents stale data, neutral/info tone for
"upcoming"). Keep both compact — a scrollable list capped at a reasonable height (e.g.
max ~6 visible rows with scroll, or pagination) if the list is long, don't let either
section dominate the page over the program-card grid, which remains the primary view.

## 3. Dashboard year toggle: this year / last year / next year

Add a control (e.g. a segmented control or three buttons) near the top of the Dashboard:
**"[Current year] − 1"**, **"[Current year] (default)"**, **"[Current year] + 1"** — labeled
with actual calendar years (e.g. "2025", "2026", "2027") computed from the real current
date, not hardcoded. Default/initial selection is always the real current year.

Selecting a different year must re-run the ENTIRE dashboard (program-card grid AND the two
new sections from #1/#2) as if viewed from that year's perspective:

- **Program-card grid**: `window.api.projection.all()` needs to accept an optional year
  parameter (or synthetic reference date) so `computeProjections` can be called with a
  `today` argument anchored to the selected year instead of the real `new Date()`. Recommend:
  add an optional `viewYear?: number` param threaded through
  `projection:all` IPC → `computeProjections(database, today)` — when `viewYear` is given,
  construct `today` as e.g. `new Date(Date.UTC(viewYear, 11, 31))` (Dec 31 of that year) so
  every program's `currentProgramYear` calculation resolves to viewYear-relative results
  consistently, INCLUDING for AA's non-calendar year_type (verify this produces the
  expected AA status-year when viewYear is selected — write a test for it). Do not change
  the default behavior when no `viewYear` is passed (must still default to true "now").
- **Needs Update / Upcoming sections**: filter trips by calendar year of `start_date`
  matching the selected `viewYear` instead of always the real current year. Note: for
  "next year" and "last year" views, the semantics of "needs update" (past trips not
  completed) and "upcoming" (future trips) should still be evaluated against the REAL
  current date, not a simulated date — e.g. if Ann selects "next year" (2027) while it's
  actually 2026, a 2027 trip that hasn't happened yet is not "overdue," it's upcoming,
  regardless of which section you'd naively bucket it into by year-only filtering. So:
  compute both sections from the full trip list using the REAL current date for the
  overdue/upcoming test (as in #1/#2), and ONLY additionally filter down to trips whose
  `start_date` calendar year equals the selected `viewYear`. This means when Ann is on the
  "last year" or "next year" tab, these two sections show only that year's overdue/upcoming
  trips respectively — which may often be empty for "next year" (no upcoming trips are
  usually overdue) — that's fine and expected, don't force non-empty results.
- Persist the selected year in a URL query param or component state (URL param preferred,
  e.g. `/?year=2027`, so it survives navigation to a program detail page and back) —
  simplest correct approach: add a `year` search param read/written via
  `useSearchParams`, default to the real current year when absent, and pass it through to
  `window.api.projection.all(viewYear)` and to the trip-filtering logic in #1/#2.
- Clearly indicate in the UI when NOT viewing the real current year (e.g. a small banner or
  label: "Viewing 2027 — projections shown as if today were Dec 31, 2027" or similar) so
  Ann never mistakes a past/future year view for the live "now" view.

## API additions

- `projection:all` IPC handler: accept optional `viewYear?: number` argument; preload
  bridge `projection.all(viewYear?: number)`; update `ProgramProjection` type if any new
  fields are needed (e.g. a `viewedAsOfDate` or `programYear` echo per program already
  exists per program — confirm and reuse).
- No new trip-related IPC needed — reuse `trips.getAll()` (already returns full trip list
  with status/dates) for the two new dashboard sections; filter client-side in
  `Dashboard.tsx`, no need for new server-side filtering endpoints given the dataset sizes
  involved (currently a personal trip-tracking app, not enterprise scale).

## Testing

Update/add tests across the four existing suites covering:
- `computeProjections` called with a synthetic `today` anchored to a different year
  produces correct program-year-relative YTD/Projected/Current results for both
  `'calendar'` and `'aa_status_year'` year types (functionality) — this is the core new
  logic surface, test it thoroughly including a case where the selected year crosses an AA
  status-year boundary.
- Default behavior (`viewYear` omitted) is unchanged from v1.2 (regression/boundary).
- "Needs update" filter logic: trips correctly classified into
  overdue/upcoming/neither across boundary dates (today, exactly on start_date, day before,
  day after) (boundary).
- "Needs update"/"upcoming" sections correctly restrict to the selected `viewYear`'s
  calendar-year trips while still using the REAL current date for the overdue/upcoming
  determination (functionality) — include the "viewing next year, trip hasn't happened
  yet, must show as upcoming not overdue" case explicitly, and the mirror case for "last
  year." Include a case where, for a given `viewYear`, the two sections are legitimately
  empty (e.g. no overdue trips exist for that year) and confirm the UI shows the
  appropriate empty/success state rather than an error (functionality).
- Input validation: invalid/out-of-range `viewYear` values (e.g. non-numeric, absurd far
  future/past) are rejected or clamped gracefully server-side, never crash (validation/security).

All tests must pass — confirm the full existing suite (102 tests from v1.2) still passes
plus new tests, report the new total.

## Packaging & delivery (same process as prior releases)

1. `npm install` (should need no new deps), `npm run build`, fix all TS errors.
2. `npm test` — all green.
3. `npm run electron:build` for Windows (nsis), reusing the prebuilt `better_sqlite3.node`
   via the existing afterPack hook.
4. Sign the installer with the existing cert identity
   (`CN=Ann Dunkin, O=Dunkin Global Advisors, OU=Software, C=US`) via the existing signing
   script.
5. Update `CHANGELOG.md` (v1.3.0 entry), `docs/TECHNICAL.md`, `docs/USER_GUIDE.md` to
   document: the two new dashboard sections, the edit-from-dashboard flow, and the year
   toggle (including its "REAL current date drives overdue/upcoming, viewYear drives
   projections and calendar-year filtering" semantics — this nuance needs a clear
   explanation for future-Ann).
6. Commit and push to `main`. Tag and create GitHub release `v1.3.0` with release notes.
   The repo is now public — write release notes as if a stranger might read them (no
   personal trip specifics needed, describe features generically). If `gh release upload`
   fails with HTTP 400 on the large binary (known sandbox proxy limitation on
   `uploads.github.com`), that's expected and non-blocking — note it, the installer will be
   delivered directly to the user instead.
7. Report back: (1) summary of every change against the 3 spec items above, (2) test
   results — pass/fail counts per suite and new total vs. 102, (3) confirmation the Windows
   build succeeded and was signed, with the exact local installer file path, (4) the GitHub
   release URL/tag and asset-upload outcome, (5) explicit confirmation of how the
   "real current date drives overdue/upcoming, viewYear drives everything else" nuance was
   implemented and tested, (6) a one-line usage note on how Ann finds and edits an overdue
   trip from the Dashboard.
