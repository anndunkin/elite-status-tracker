# Elite Status Tracker v1.6 — Spec

Delivered: 2026-07-29
Prior: v1.5.1

## Problem statement

> "The elite status tracker doesn't pull the MQDs from the segments. I have to add
> them manually. Each segment probably needs to be tagged with a program to make
> that work."

The diagnosis is correct. Delta MQDs and AA Loyalty Points have been derived from
segment `cost_usd` since v1.5, but nothing in the UI ever let the user say *which
program a segment earns for*. The segment editor had From / To / Miles / Cost and
no Program control, so every segment the app has ever created via the editor was
saved with `program_id = NULL`.

That left `deriveSegmentCost` leaning entirely on its untagged fallback, which is
correct but invisible and fragile:

- On a **mixed-program trip** there is no way to say "$400 of this itinerary flew
  on Delta and $600 on American." The fallback lumps all untagged cost onto
  whichever program is being evaluated, so the same dollars get credited to both.
- Derivation is silently suppressed whenever the stored metric value is `0`
  rather than absent. Two paths produced an unintended `0`: clearing the LP
  number input in the trip editor stored `Number('') === 0`, and a portable-file
  export/import round-trip could turn an absent key into a stored `null` (which
  the Delta branch, unlike the AA branch, did not treat as absent).
- With no visible confirmation of the derived number, a user who sees a blank MQD
  field reasonably concludes the feature is broken and types the value by hand —
  which then permanently pins it, because an explicit value always wins.

## Deliverables

### 1. Per-segment Program picker (`src/pages/Trips.tsx`)

- Each row in **Flight segments** gains a `Program` `<select>` after `Cost $`,
  listing all active programs plus a blank `—` option. Blank means "untagged",
  which keeps the pre-v1.6 fallback behavior available on purpose.
- New segments are pre-tagged from the trip's own program credit:
  - exactly **one distinct** program among the trip's entries → pre-select it;
  - **several** distinct programs → start blank, so the user must choose which
    one earns the cost;
  - **no** entries yet → start blank.
  A program may legitimately appear twice among the entries (once as an estimate,
  once as an actual), so the check is on the *distinct* set of `program_id`s, not
  the entry count.
- Existing segments are never auto-retagged when a program entry is added or
  changed. Instead an inline amber hint appears in the Segments section — "Tag
  your segments with a program to auto-calculate Delta MQDs / AA Loyalty
  Points." — shown only when it would change an outcome: the trip credits a
  derivation-driven program (`dl` / `aa`) *and* some priced segment is untagged.
- The Delta and AA helper texts now say the cost is summed from segments tagged
  with that program, and note that untagged segments still count while none are
  tagged. The Delta text additionally shows the running derived figure
  ("Currently 500 MQDs."), so the user can see the auto-calc working instead of
  inferring from an empty input that it isn't.
- Clearing a metric input now **removes the key** instead of storing `0`. This is
  the bug that turned "I'll blank this out and let the app compute it" into "this
  value is now pinned to zero forever."
- The AA LP pre-fill preview now uses the same tagged-preferred / untagged-
  fallback rule as the backend (`segmentCostForProgram` in
  `src/lib/metricLabels.ts`), so the previewed number matches what gets stored.
  Previously the preview matched only explicitly-tagged AA segments and so read
  as `0` for every segment the editor had ever produced.

### 2. Derivation logic (`electron/database.ts`)

- `deriveSegmentCost` keeps its v1.5.1 semantics unchanged — prefer segments
  tagged for the program, else fall back to the trip's untagged segments — and is
  now exported so it can be unit-tested directly. The two candidate sets are
  disjoint on `program_id` (explicitly tagged vs. empty), so once a trip's
  segments are tagged, a dollar can never be credited to two programs.
- The Delta branch now treats a stored `null` MQD the same as an absent one,
  matching the AA branch. Only a genuine user-entered number (including an
  explicit `0`) suppresses derivation.
- Segment inserts write `s.program_id || null`, so an empty string becomes SQL
  `NULL`. Both read as "untagged" everywhere in the app, but `''` violates the
  `program_id TEXT REFERENCES programs(id)` constraint and would surface as a
  foreign-key error on write.

### 3. Migrations (`applyDataMigrations`)

Both run from `openDatabaseAt` after `seedIfFresh`, alongside the existing v1.5
migrations, and are reported in `DataMigrationsSummary`.

- **`stripDerivableZeroMetricsOnce(db)`** — walks `trip_program_entries` for
  `dl`/`mqd` and `aa`/`points` and deletes the key wherever the stored value is
  `0` or `null`, so derivation takes over. Gated by
  `app_meta.derivable_zeros_stripped` so it runs **exactly once**: a zero the
  user deliberately records *after* the migration is respected. Returns the row
  count, or `null` if it had already run.
- **`normalizeSegmentProgramIds(db)`** — rewrites any `trip_segments.program_id`
  that is `''` to `NULL`. Idempotent, so it runs unconditionally.

Only `trip_program_entries` is swept, not `program_year_adjustments`: adjustments
have no segments to derive from, so a zero there is meaningful.

### 4. Schema

No schema change. `trip_segments.program_id` has existed since v1.0 — it simply
had no way to be set from the UI.

### 5. Tests (`tests/segment-program-tagging.test.ts`)

20 new tests (198 total, up from 178) covering functionality (tagged segments credit the right program;
a mixed Delta + AA trip splits $400/$600 with no double-counting), boundary
conditions (untagged back-compat; tagged siblings suppressing untagged ones;
explicit values and `null` values; award tickets with no cost), the
`deriveSegmentCost` helper directly, the one-time migration including its
run-once gate, and validation of segment `program_id` referential integrity.

**Validation behavior, chosen and documented:** a segment tagged with a
program id that does not exist is **rejected** by the `REFERENCES programs(id)`
foreign key. Because `tripCreate` / `tripUpdate` are transactional, the entire
trip write rolls back rather than silently dropping the tag. An empty-string tag
is *not* an error — it is normalized to `NULL` (untagged) on the way in.
