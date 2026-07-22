# Elite Status Tracker — v1.4 Update Spec

Repo: `/home/user/workspace/elite-status-tracker`, pushed to
`https://github.com/anndunkin/elite-status-tracker`, currently at tag `v1.3.0` on `main`.
The repo is PUBLIC — do not commit any real personal data; keep any new
fixtures/docs generic/synthetic.

This is an INCREMENT — read the existing code first:
- `src/pages/Dashboard.tsx` — currently renders the "Needs Update" and "Upcoming Trips"
  panels (added in v1.3) in a `grid gap-4 md:grid-cols-2 mb-6` block ABOVE the program-card
  grid (`grid gap-4 md:grid-cols-2 xl:grid-cols-3`, around line 189). Also review the year
  toggle control added in v1.3 (segmented control + `?year=` search param) — it stays in
  its current position at the top of the page; only the two trip-list panels are moving.
- `electron/main.ts` — `createWindow()` builds a `BrowserWindow` (~line 37) with NO `icon`
  option set. This is why the taskbar/window/title-bar icon falls back to Electron's
  default even though the icon shows correctly on the installer and desktop shortcut.
- `electron-builder.config.js` — `win.icon: "assets/icon.ico"` (correctly sets the
  installer/.exe file icon) but `signAndEditExecutable: false`. Combined with the missing
  `BrowserWindow` icon option, this is the full root cause of "icon shows on installer, not
  on the installed app or taskbar."
- `assets/icon.ico` and `assets/icon.png` already exist in the repo — reuse them, do not
  regenerate or replace the actual icon artwork.
- `docs/USER_GUIDE.md`, `docs/TECHNICAL.md`, `CHANGELOG.md`, `README.md` — existing docs to
  update.
- `tests/security.test.ts` (12 tests), `tests/functionality.test.ts` (48),
  `tests/boundary.test.ts` (27), `tests/validation.test.ts` (28) — 115 total... actually
  confirm exact current counts by running the suite first; last reported total was 125
  across all four suites combined as of v1.3.0. Do not lose or disable any existing test.

Do not rewrite from scratch. Preserve all existing functionality and tests unless a change
below explicitly supersedes it.

Use `bash` with `api_credentials=["github"]` for all git/gh commands. Never use any GitHub
MCP/connector tool.

## 1. Reorder Dashboard: trip panels below the program-card status grid

Move the "Needs Update — Past Trips Not Marked Complete" and "Upcoming Trips" panel block
(currently rendered above the program-card grid) to render AFTER/BELOW the program-card
grid instead. The year-toggle control at the top of the page stays where it is — it applies
to the whole dashboard including both the grid and the two panels, so its position is
unaffected by this reorder. No functional/logic change — this is a pure JSX reordering
within `Dashboard.tsx` (move the block, don't duplicate or rebuild it). Preserve all
existing styling, spacing, and the "off-year" banner (if present) exactly as-is; add
reasonable spacing (e.g. `mt-6` or similar matching existing spacing conventions) between
the grid and the moved panel block if needed so they don't look cramped together.

## 2. Fix the custom app icon so it shows on the installed app and taskbar

Root cause (see file notes above): `BrowserWindow` in `electron/main.ts` never receives an
`icon` option, so Windows uses Electron's default icon for the running app/taskbar/window,
even though the installer's `.exe` file icon is correctly set via
`electron-builder.config.js`'s `win.icon`.

Fix, in order:
1. In `electron/main.ts`'s `createWindow()`, add an `icon` option to the `BrowserWindow`
   constructor pointing at the packaged icon file. Use a path that resolves correctly both
   in dev (`npm run dev`/`electron .`) and in the packaged app (where `__dirname` points
   inside the asar-unpacked or app resources directory) — follow the existing pattern this
   codebase uses elsewhere for resolving packaged-vs-dev asset paths (check
   `scripts/copy-electron-assets.js` and any existing `app.isPackaged` / `process.resourcesPath`
   conditional logic in `electron/main.ts` for precedent; if none exists, add one, e.g.:
   resolve to `path.join(process.resourcesPath, 'assets/icon.ico')` when packaged
   (`app.isPackaged`), and `path.join(__dirname, '../assets/icon.ico')` (or wherever the
   assets folder actually sits relative to `electron/dist/main.js` in dev) otherwise. Verify
   the assets folder is actually included in the packaged app's resources — check
   `electron-builder.config.js`'s `files`/`extraResources` config; if `assets/` isn't
   currently copied into the packaged output, add an `extraResources` entry for it (e.g.
   `{ from: "assets", to: "assets" }`) so the icon file is actually present at runtime in
   the installed app, not just bundled into the installer's own resource header.
2. On Windows specifically, also verify/set the taskbar icon explicitly if needed — Electron
   normally derives the taskbar icon from the `BrowserWindow`'s `icon` option, but if this
   codebase sets `app.setAppUserModelId(...)` anywhere (check `electron/main.ts`), confirm
   it's set BEFORE the window is created and doesn't conflict; if it's not set at all,
   consider adding `app.setAppUserModelId('com.dunkinglobal.elitestatustracker')` (matching
   the existing `appId` in `electron-builder.config.js`) early in the app lifecycle — this
   is required on Windows for the taskbar to correctly associate the running process with
   its intended icon/identity rather than falling back to Electron's default, especially
   for pinned taskbar icons and grouping.
3. Confirm `electron-builder.config.js`'s `win.icon` and `signAndEditExecutable` settings
   are still correct given the above — `signAndEditExecutable: false` may be fine to leave
   as-is if the `BrowserWindow` icon fix alone resolves the taskbar/window icon (which it
   should, since that's the actual mechanism Windows uses for a running app's taskbar icon
   — the exe's embedded resource icon is really only what Explorer shows for the file
   itself before it's running, which was ALREADY working per the user's report). Do not
   change `forceCodeSigning` or the signing pipeline.
4. Test manually if possible in this sandbox (headless Linux, so real Windows taskbar
   verification isn't fully possible here) — at minimum, verify programmatically that:
   - the resolved icon path exists on disk both in a simulated dev-mode path resolution and
     in the actual packaged `dist-installer/win-unpacked/` output after building (read the
     icon path resolution logic with `app.isPackaged` forced/mocked true in a unit test, and
     separately confirm the file exists in the built `win-unpacked` resources folder as a
     packaging-level check),
   - the `BrowserWindow` constructor call includes a non-empty `icon` option in both dev and
     packaged code paths.

## 3. Documentation updates

Update ALL of the following to reflect the current true state of the app (v1.3's dashboard
changes AND this v1.4 update — audit for drift, don't just append a changelog entry and
call it done):
- `CHANGELOG.md` — add a v1.4.0 entry (dashboard panel reorder, icon fix, doc updates,
  test suite growth).
- `docs/USER_GUIDE.md` — confirm the Dashboard section describes the CURRENT layout
  (year toggle at top, program-card grid, then Needs Update / Upcoming panels below —
  update any prose/screenshots-as-text-description that still implies the old ordering from
  v1.3, and confirm the Card Earnings, Program Detail, manual status override, and Million
  Miler sections from v1.1/v1.2 are still accurately described — fix any drift found).
- `docs/TECHNICAL.md` — document the icon resolution mechanism added in this update
  (dev vs. packaged path resolution, `extraResources` if added, `setAppUserModelId` if
  added) since this is exactly the kind of packaging detail that's easy to silently
  regress later. Also audit the rest of this file for drift against the current schema
  (program_status_overrides, program_lifetime_status generalized to all programs,
  program_lifetime_mileage, card_earnings_entries tables from v1.1-v1.3) and fix anything
  stale.
- `README.md` — confirm feature list/screenshots-as-text still match current
  functionality; add anything from v1.1-v1.4 missing from the feature list.

## 4. Ensure the test suite includes security tests

`tests/security.test.ts` already exists with prior coverage. For this release, EXTEND it
(don't replace) with tests relevant to the new surface area introduced by this update:
- Icon path resolution must not be vulnerable to path traversal or accept attacker-influenced
  input (in this app it's a fixed constant path, not user input — but confirm and assert
  that no user-controlled string ever flows into the icon path resolution logic; add a test
  asserting the resolved icon path always stays within the expected assets/resources
  directory boundary, e.g. via `path.resolve` + a prefix-containment check, as defensive
  regression coverage even though current risk is low).
- Re-run and confirm the FULL EXISTING security suite still passes unmodified in behavior
  (no existing security test should be weakened or removed to make this update pass).
- Add/confirm boundary+security coverage for the dashboard reorder having zero effect on
  any IPC/data-access security properties (this is a pure UI reorder, so this should just
  be a quick regression confirmation, not new logic — note in the test file comments why
  no new security surface was introduced by item #1, if that's the conclusion after review).

Report the final per-suite and total test counts, explicitly calling out the security
suite's count and confirming it grew or was maintained (never shrank) relative to v1.3.0's
count.

## Packaging & delivery (same process as prior releases)

1. `npm install` (should need no new deps unless something is needed for the icon fix —
   avoid adding deps if achievable with core Node/Electron APIs), `npm run build`, fix all
   TS errors.
2. `npm test` — all green, report full breakdown.
3. `npm run electron:build` for Windows (nsis), reusing the prebuilt `better_sqlite3.node`
   via the existing afterPack hook. After building, inspect the packaged
   `dist-installer/win-unpacked/` output to confirm the icon asset is actually present in
   the resources directory (per item #2's verification step) — this is a critical check
   given the nature of the bug being fixed.
4. Sign the installer with the existing cert identity
   (`CN=Ann Dunkin, O=Dunkin Global Advisors, OU=Software, C=US`) via the existing signing
   script.
5. Commit and push to `main`. Tag and create GitHub release `v1.4.0` with generic
   public-facing release notes (repo is public). If `gh release upload` fails with HTTP 400
   on the large binary (known sandbox proxy limitation on `uploads.github.com`), that's
   expected and non-blocking — note it, the installer will be delivered directly to the
   user instead.
6. Report back: (1) summary of every change against the 4 spec items above, (2) test
   results — pass/fail counts per suite (call out security suite specifically) and new
   total vs. 125, (3) confirmation the Windows build succeeded and was signed, with the
   exact local installer file path, AND confirmation the icon asset is present in the
   packaged `win-unpacked` resources folder, (4) the GitHub release URL/tag and
   asset-upload outcome, (5) a summary of exactly what doc files were touched and what
   drift was fixed in each, (6) an honest caveat that full taskbar-icon visual verification
   isn't possible in this Linux sandbox and the user should confirm on their actual Windows
   machine after installing — describe what WAS verified programmatically (icon option set
   in BrowserWindow constructor, file present in packaged resources, path resolution logic
   tested) versus what could NOT be verified (actual rendered taskbar pixels).
