# User Guide

## Installing

1. Download `Elite Status Tracker Setup 1.0.0.exe` from the release page.
2. Run it. Because the app is signed with a self-signed certificate, Windows
   SmartScreen may show a "Windows protected your PC" notice — click
   **More info → Run anyway**.
3. Choose an install location (you can change it) and finish. A desktop and Start
   menu shortcut are created.

The app opens with your historical travel already loaded so you can explore it
immediately.

## The Dashboard

Each card is one program for the current status year. It shows:

- **Now** — the tier you currently qualify for (completed trips + posted
  adjustments only).
- **Projected** — the tier you'd reach if all your planned and booked trips
  complete as estimated.
- A **progress bar** toward the next tier, with the running totals and the
  requirement for that tier.

## Adding a trip

1. Go to **Trips → + Add Trip**.
2. Enter a label, start date, and status (planned / booked / completed).
3. Under **Program credit**, click **+ Entry** for each program the trip earns
   toward. Tick **estimate** for planned/booked expectations; leave it unticked
   for confirmed, posted actuals. Fill in the metric fields shown for that
   program (e.g. points, nights, MQD).
4. (Optional) Add **flight segments**. Type the origin and destination airport
   codes (e.g. `SEA`, `NRT`) and the great-circle distance fills in
   automatically; you can override it or enter one manually for unknown codes.
5. **Save Trip.** The dashboard updates immediately.

> Trips imported from the historical spreadsheet show a `*` next to the date —
> their month/day is an estimate.

## Editing program rules

Loyalty programs change their thresholds. On **Manage Rules**:

1. Pick a program.
2. Adjust any tier's threshold values and update the source citation.
3. **Save as new version.** Your previous rules are kept in history (visible on
   the Programs screen) and your status is recalculated.

## Quarterly review

Roughly every three months a banner reminds you to re-verify each program's tier
rules against its official source. After checking, click **Mark reviewed** (in the
banner or in Settings) to log the review and reset the timer for three months.

Two thresholds are known to be uncertain and should be confirmed at your first
review:

- **Marriott Bonvoy Ambassador** spend — seeded at **$23,000** ($23K vs $25K
  across sources).
- **World of Hyatt Explorist** nights — seeded at **30** (20 vs 30 across
  sources).

## Managing your data

Everything is stored locally. In **Settings → Data file**:

- **New tracker file…** — start a fresh file (re-seeds programs and history).
- **Open…** — switch to another `.db` file.
- **Save a copy as…** — save the current data to a new `.db` location (e.g. a
  backup or a synced folder).
- **Export JSON…** — write a readable, versioned snapshot.
- **Import JSON…** — restore from a snapshot (replaces current data).

> New / Open / Import replace what's currently loaded. Export a copy first if
> you're unsure.

## Themes

Toggle light/dark from the top-right of any screen or in **Settings**. Your
choice is remembered.
