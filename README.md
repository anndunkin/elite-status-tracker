# Elite Status Tracker

A desktop app for tracking progress toward airline and hotel elite status across
multiple loyalty programs. It records both **planned/booked** travel (estimates)
and **completed** travel (actuals), sums each program's qualifying metrics within
the correct program year, and shows current vs. projected tier status against the
current-year thresholds. A quarterly reminder prompts you to re-verify the tier
rules against each program's published source.

Built with **Electron + React + TypeScript + Vite** and a local **SQLite**
database (better-sqlite3). All data stays on your machine.

## Tracked programs

Airlines: American AAdvantage, Delta SkyMiles, Alaska / Atmos Rewards,
United MileagePlus.
Hotels: Hilton Honors, Marriott Bonvoy, IHG One Rewards, World of Hyatt.

Lapsed / reference-only (historical activity retained): Omni Select Guest,
Starwood Preferred Guest, Fairmont President's Club, Virgin Atlantic Flying Club.

## Screens

- **Dashboard** — a **year toggle** (last / this / next year) at the top, then one
  card per active program showing a three-part status — **Current** (tier held
  now), **Year-to-date** (posted activity this program-year), and **Projected**
  (including planned/booked estimates) — plus a progress bar toward the next tier,
  any lifetime status/mileage (e.g. Delta Million Miler) badge, and running totals.
  Below the cards, two trip lists surface what needs attention: **Needs Update**
  (past trips still marked planned/booked) and **Upcoming Trips**, each with a
  one-click Edit that jumps to the trip.
- **Trips** — list, add, and edit trips. Each trip can carry multiple per-program
  credit entries (marked estimate or actual) and optional flight segments with
  automatic great-circle mileage from IATA airport codes.
- **Program Detail** — click any dashboard card for a full breakdown of the metric
  totals behind each status value, the trips crediting the program this year,
  **card-earnings** entries, year adjustments, the tier table, and an **Edit
  Status** control for manual **status overrides** (one program-year) or a
  permanent **lifetime status** floor.
- **Programs** — tier tables for each program, full rule-version history, and the
  last-activity dates for lapsed programs.
- **Manage Rules** — edit tier thresholds; saving creates a new rule version
  (history is preserved) and re-projects your status.
- **Settings** — light/dark theme, portable data file management (New / Open /
  Save a copy / Export JSON / Import JSON), and the quarterly review status.

## Development

```bash
npm install
npm run dev          # Vite + Electron in watch mode
npm test             # vitest (security / validation / boundary / functionality)
npm run build        # renderer + electron main
```

## Building the Windows installer

```bash
npm run electron:build          # produces dist-installer/*.exe (+ .zip)
bash build/sign.sh              # code-signs the installer with the self-signed cert
```

The native `better_sqlite3.node` for Windows is injected from
`prebuilt-win32-x64/` by `scripts/afterPack.js` during packaging (no native
rebuild required).

## Data & privacy

The database file lives in your user-data directory by default. Use
**Settings → Save a copy as…** to keep a portable `.db`, or **Export JSON** for a
human-readable, versioned snapshot that **Import JSON** can restore.

## License

Private. © Ann Dunkin / Dunkin Global Advisors.

## Security note: pinned dependencies

`keyv` and `cacheable-request` are pinned to `4.5.4` and `7.0.4` respectively via
the `overrides` field in `package.json`. This is a deliberate protection against
the August 2026 Keyv/Cacheable npm supply chain attack, which compromised
`keyv@6.0.0`, `cacheable-request@13.0.20`, and 400+ other packages
(see the [Wiz writeup](https://www.wiz.io/blog/keyv-and-cacheable-npm-supply-chain-attack)).

These are transitive dependencies pulled in via `got` → `@electron/get` → `electron`.
**Before removing or updating these overrides**, verify that newer versions of
`keyv`/`cacheable-request` are confirmed clean against current npm security advisories.

