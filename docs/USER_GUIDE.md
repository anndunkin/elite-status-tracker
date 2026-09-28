# User Guide

## Installing

1. Download the latest `Elite Status Tracker Setup` installer from the release page.
2. Run it. Version 1.7.3 is unsigned because the signing private key is unavailable.
   Windows may show an unknown-publisher or SmartScreen warning. Only proceed
   after verifying that the installer came from the project's GitHub release.
3. Choose an install location (you can change it) and finish. A desktop and Start
   menu shortcut are created.

A fresh install opens as a blank slate — no trips are pre-loaded — but every
program's current tier rules and reference data (including Hilton lifetime Diamond
and the Delta Million Miler baseline) are ready out of the box. Add your trips
from the **Trips** screen to start tracking.

> Upgrading from an earlier version? Opening your existing tracker file keeps all
> of your trips, card earnings, and adjustments exactly as they were — the
> blank-slate behavior only applies to brand-new files.

## The Dashboard

Each card is one program for the current status year. It shows three distinct
status values:

- **Current** — the tier you actually hold right now, carried over from your most
  recently completed program-year (and never dropping below any lifetime status,
  such as Hilton lifetime Diamond).
- **Year-to-date** — the tier your confirmed, posted activity in the current
  program-year qualifies for (completed trips + posted adjustments + card earnings).
- **Projected** — the tier you'd reach if all your planned and booked trips
  complete as estimated.
- Two stacked **progress bars**. **Actual earned** uses only YTD activity and
  shows progress toward the next actual tier, with totals and requirements.
  **Projected total** includes completed, booked, and planned travel, plus the
  existing adjustments and card earnings. It shows every tier as an evenly spaced
  milestone, with each tier's requirements listed below in matching order.
  Forecast qualification is labeled **Projected to meet**, never earned.
  Both bars respect combined requirements and alternative qualification routes.
  Current held status and lifetime status do not inflate annual earned progress.
  The separate lifetime Million Miler display is unchanged.

**Click any card** to open its **Program Detail** page — a full breakdown of the
metric totals behind each status value, the trips crediting toward the program
this year (click **Edit** to jump straight to a trip), card-earnings entries, year
adjustments (each row has a **Delete** button, with a confirmation prompt, for
removing a mistaken or superseded adjustment), and the tier table.

### Trip attention lists

Below the program cards the dashboard shows two compact trip lists so nothing slips
through the cracks:

- **Needs Update — Past Trips Not Marked Complete.** Any trip whose dates have
  already passed but is still marked **planned** or **booked**. These are usually
  trips you took and simply haven't marked *completed* yet (or need to correct).
  They're sorted oldest-first. Click **Edit** on any row to open that exact trip in
  the Trips editor, change its status to *completed* (and adjust the earned metrics
  if needed), and save. When there's nothing outstanding you'll see a small
  "All past trips are up to date ✓" note instead.
- **Upcoming Trips.** Planned and booked trips still to come, soonest-first, with a
  badge marking each as *planned* or *booked*. **Edit** jumps to the trip the same
  way.

> **To fix an overdue trip:** find it in the **Needs Update** list, click **Edit**,
> flip its status to **completed**, and save — it drops off the list immediately.

### Viewing a different year

The **year toggle** in the top-right lets you view the dashboard for **last year**,
**this year** (the default), or **next year**. Selecting a year re-computes
*everything* — the program status cards and both trip lists — as if you were looking
at the app from that year. Your choice is remembered in the address bar, so it
sticks as you move between pages.

Two things are worth knowing:

- **Projections** for a selected year are shown as if today were December 31 of that
  year, so a program's status year (including American's March–February window)
  resolves to the right period.
- **The two trip lists are always judged against today's real date.** Only the
  year filter and the projection math move with the toggle. That means viewing
  **next year** correctly lists a not-yet-taken trip as *upcoming* (never
  *overdue*), and viewing **last year** shows the trips from that year that were
  never marked complete. A banner reminds you whenever you're not viewing the live
  current year.

## Editing your status (overrides & lifetime status)

Sometimes the tier the app calculates from your tracked activity isn't the whole
story — you may have **bought up** to a status, received a **status match or
challenge**, or hold a **lifetime** status. On any **Program Detail** page, click
**Edit Status** to set what's displayed as your **Current** tier:

1. Pick the **tier** from the dropdown.
2. Leave **“This is permanent / lifetime status”** unchecked for a **one-time
   override** — it corrects the displayed Current tier for **this program-year
   only** and reverts to your calculated tier next year unless you set it again.
3. Check **“This is permanent / lifetime status”** to record a **lifetime floor** —
   it applies to **every** program-year and never drops your displayed Current
   below it (this is the same mechanism behind Hilton lifetime Diamond, now
   available for any program). You can add an optional achieved date and note.
4. **Save.**

Your override and any lifetime status appear as badges at the top of the Status
section, each with a **clear** link to remove it. Setting a status here never
changes your **Year-to-date** or **Projected** numbers — those always reflect your
real earned progress. When more than one applies, the app displays the **highest**
of your calculated held tier, any lifetime floor, and any current-year override.

> **Example — American AAdvantage Executive Platinum:** open the American card →
> **Edit Status** → choose **Executive Platinum**, tick **“This is permanent /
> lifetime status,”** and **Save**. Your Current will show Executive Platinum every
> year going forward, while YTD/Projected keep tracking what you actually earn.

### Delta Million Miler

The Delta card and Program Detail page also track lifetime (Million Miler) mileage
toward 3,000,000 miles, separate from annual Medallion status. It starts from a
baseline of 2,032,832 miles as of 2026-07-01 and grows as you log completed Delta
flight segments flown after that date.

## Card Earnings

Some elite credit comes from credit-card spend rather than a specific trip. Use the
**Card Earnings** screen to log those dated credits for the four card-earning
programs — Delta (MQDs), American (Loyalty Points), World of Hyatt (nights), and
Marriott Bonvoy (nights):

1. Click **+ Add Entry**, pick the program, set the date and amount, and (optionally)
   a note such as "Amex Platinum anniversary credit."
2. **Save.** The entry is bucketed into the correct program-year by its date and
   feeds directly into the Year-to-date and Projected status for that program.

Entries can be filtered by program, edited, and deleted at any time.

## Adding a trip

1. Go to **Trips → + Add Trip**.
2. Enter a label, start date, and status (planned / booked / completed).
3. Under **Program credit**, click **+ Entry** for each program the trip earns
   toward. Tick **estimate** for planned/booked expectations; leave it unticked
   for confirmed, posted actuals. Fill in the metric fields shown for that
   program (e.g. LPs, nights, MQD).
4. (Optional) Add **flight segments**. Type the origin and destination airport
   codes (e.g. `SEA`, `NRT`) and the great-circle distance fills in
   automatically; you can override it or enter one manually for unknown codes.
   Add a **Cost** value on a segment to drive the auto-calculated metrics below.
5. Set each segment's **Program** — the program that segment's cost earns
   toward. If the trip has exactly one program entry, new segments are tagged
   with it for you; if it credits several programs, the dropdown starts blank so
   you can say which leg flew on which airline. See *Tagging segments with a
   program* below.
6. **Save Trip.** The dashboard updates immediately.

> Trips imported from the historical spreadsheet show a `*` next to the date —
> their month/day is an estimate.

### Tagging segments with a program

Each flight segment has a **Program** dropdown. It answers one question: *which
program earns this segment's cost?* That matters because Delta MQDs and American
Loyalty Points are calculated from segment cost (see below).

- **Single-program trip** — new segments are tagged automatically with the trip's
  program. Nothing to do.
- **Mixed-program trip** — tag each segment yourself. A Seattle–Atlanta leg on
  Delta and an Atlanta–Miami leg on American should be tagged `dl` and `aa`
  respectively, so each program is credited only with its own cost. Without tags
  the app has to fall back to counting *all* the trip's cost toward whichever
  program it happens to be calculating, which inflates both.
- **Leaving it blank (`—`)** is still valid and means "untagged". Untagged
  segments are credited to the trip's program as long as *no* segment is tagged
  for that program — which is how every trip created before v1.6 keeps working
  unchanged. As soon as you tag one segment for a program, only tagged segments
  count toward it, so tag them all or none.

Adding a program entry never retags segments you already entered. If a trip
credits Delta or American and still has untagged priced segments, the editor
shows a reminder under *Flight segments*.

### Auto-calculated metrics (Delta MQDs, American LPs)

Two programs derive their qualifying metric from flight segment **Cost** instead
of requiring you to type it in by hand. Both use the segment **Program** tag to
decide which costs belong to them:

- **Delta SkyMiles MQDs** — $1 of segment cost = 1 MQD. The Delta entry in the
  Trip editor hides the old manual MQD field entirely; just add your flight
  segments with a Cost value, tag them **Delta**, and the MQD total is calculated
  automatically at save/projection time. The Delta entry shows the running total
  ("Currently 500 MQDs.") so you can confirm it picked up your segments. If you
  ever need an exact value that differs from raw spend (a promotion, a companion
  fare, etc.), you can still enter one directly by editing the stored entry — an
  explicit MQD always overrides the auto-calc.
  **Delta MQMs (Medallion Qualification Miles) are no longer tracked at all** —
  Delta retired them, so only MQDs matter now.
- **American AAdvantage LPs (Loyalty Points)** — `cost × your current AA earning
  multiplier`, where the multiplier depends on the AA elite tier you hold
  entering the current status year: 5x with no status, 7x Gold, 8x Platinum, 9x
  Platinum Pro, 11x Executive Platinum. The AA entry's **LPs** field is
  pre-filled with an estimate when you add flight segments with a Cost value —
  type over it with the exact posted amount once American credits the trip, and
  your manual value takes priority over the estimate. To go back to the
  auto-calculated figure, **clear the field** rather than typing `0`; a `0` you
  enter on purpose is treated as a real value and turns the auto-calc off for
  that trip. AA's old `spend` metric
  has been removed; only LPs are tracked. (The metric is labeled "LPs" in the
  interface, but is still stored under its original `points` key internally.)

### Where did this number come from?

Every program's Program Detail page includes a **"Where these numbers come
from"** table showing, for the current program-year, how much of each metric
came from **trips**, **year adjustments**, and **credit-card earnings** — with a
total column that always adds up to the displayed Year-to-date figure. If a
total looks higher or lower than you expect, check this table first: it's the
fastest way to spot a source you didn't intend (for example, a trip whose LPs
were auto-calculated from segment cost *and* a separate card-earnings entry
logged for that same activity).

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

One threshold is still known to be uncertain and should be confirmed at your next
review:

- **World of Hyatt Explorist** nights — seeded at **30** (20 vs 30 across
  sources).

> **Marriott Bonvoy Ambassador** is now confirmed at **100 nights AND $23,000
> spend** and is no longer flagged.

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
