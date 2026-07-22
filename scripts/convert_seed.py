#!/usr/bin/env python3
"""
Convert Ann's historical trip-planning spreadsheet dump into structured seed data
(electron/seedTrips.json) consumed once by electron/seedData.ts on fresh-DB creation.

Parsing strategy (per BUILD_SPEC.md "Data source"):
  - Header row is spreadsheet row index 1.
  - The canonical data block runs from column 0 through the "Notes" column.
    Everything to the RIGHT of "Notes" is a duplicate/helper recompute block and is ignored.
  - Data rows -> trips. Rows whose Month/Location cell holds an adjustment label
    (Bonus/Boost/Rollover/CC/CC Annual/Promotional/Feb 28 Reset) -> year-level adjustments.
  - Rows whose Location cell is a reference label (Last * Stay / Virgin Atlantic Expiration)
    -> program_last_activity records.
  - The trailing totals row (blank Month+Location, numeric metrics) is used only for
    cross-validation, never imported.
"""
import json, os, re, sys

RAW = os.path.join(os.path.dirname(__file__), "..", "raw_spreadsheet_dump.json")
OUT = os.path.join(os.path.dirname(__file__), "..", "electron", "seedTrips.json")

MONTHS = {"jan":1,"feb":2,"mar":3,"apr":4,"may":5,"jun":6,"june":6,"jul":7,"july":7,
          "aug":8,"sep":9,"sept":9,"oct":10,"nov":11,"dec":12}

ADJ_LABELS = {
    "bonus":"bonus","boost":"bonus","rollover":"rollover","cc":"credit_card",
    "cc annual":"credit_card_annual","promotional":"promotional","feb 28 reset":"reset",
}
REF_LABELS = {
    "last hyatt stay":"wh","last omni stay":"omni","last starwood stay":"starwood",
    "last starwood transaction":"starwood","last fairmont stay":"fairmont",
    "virgin atlantic expiration":"va",
}

# Header text (lowercased, stripped) -> (program_id, metric_key).
# Historical miles are mapped to each program's *current* qualifying metric so the
# dashboard projection is meaningful (documented in docs/TECHNICAL.md).
def map_header(h):
    t = re.sub(r"\s+", " ", str(h).strip().lower())
    if t in ("as miles", "mvp qual miles"):        return ("as", "points")
    if t == "aa points":                            return ("aa", "points")
    if t == "aa miles":                             return ("aa", "points")
    if t == "aa eqds":                              return ("aa", "spend")
    if t in ("delta mqms", "delta miles"):          return ("dl", "mqm")
    if t in ("delta mqds", "mqds"):                 return ("dl", "mqd")
    if t == "other miles":                          return ("other", "miles")
    if t == "united":                               return ("ua", "pqp")
    if t == "hilton stays":                         return ("hh", "stays")
    if t == "hilton nights":                        return ("hh", "nights")
    if t in ("intercontinental", "intercontinental nts"): return ("ih", "nights")
    if t == "marriott nts":                         return ("mb", "nights")
    if t == "marriott $":                           return ("mb", "spend")
    if t == "hyatt nights":                         return ("wh", "nights")
    return None  # 'AS/AA Miles' combined helper, '3MM', generic 'Miles', flags, etc.

FLAG_HEADERS = {"airline bonus credit?", "booked?", "petsitter booked?", "complete?",
                "month", "location", "notes"}

def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)

def truthy(v):
    if v is None: return False
    s = str(v).strip().lower()
    return s in ("y", "yes", "complete", "done", "true", "booked") or v is True or v == 1

def main():
    data = json.load(open(RAW))
    trips, adjustments, last_activity = [], [], []
    per_program_counts = {}
    validation = []

    for year_str in sorted(data.keys()):
        year = int(year_str)
        rows = data[year_str]
        # header row = first row containing 'Month' and 'Location'
        hdr_idx = None
        for i, r in enumerate(rows[:4]):
            low = [str(c).strip().lower() if c is not None else "" for c in r]
            if "month" in low and "location" in low:
                hdr_idx = i; break
        if hdr_idx is None:
            continue
        header = rows[hdr_idx]
        low_hdr = [str(c).strip().lower() if c is not None else "" for c in header]
        notes_idx = low_hdr.index("notes") if "notes" in low_hdr else len(header)

        # Build canonical column map (skip generic 'Miles' when 'AS Miles' present)
        has_as_miles = any(low_hdr[c] == "as miles" for c in range(notes_idx))
        colmap = {}  # col_idx -> (program, metric)
        for c in range(2, notes_idx):
            h = low_hdr[c]
            if not h or h in FLAG_HEADERS:
                continue
            m = map_header(h)
            if m:
                # avoid double-mapping the same (prog,metric) to two adjacent cols
                colmap[c] = m
        month_col, loc_col = 0, 1

        # status flag columns (by header where present; 2012 has none -> positional)
        booked_col = low_hdr.index("booked?") if "booked?" in low_hdr else None
        complete_col = low_hdr.index("complete?") if "complete?" in low_hdr else None
        bonus_credit_col = low_hdr.index("airline bonus credit?") if "airline bonus credit?" in low_hdr else None

        totals_sum = {}   # (prog,metric)->sum for validation
        current_month = None

        for r in rows[hdr_idx+1:]:
            if r is None: continue
            c0 = r[month_col] if len(r) > month_col else None
            c1 = r[loc_col] if len(r) > loc_col else None
            c0s = str(c0).strip().lower() if c0 is not None else ""
            c1s = str(c1).strip().lower() if c1 is not None else ""

            # reference row
            if c1s in REF_LABELS:
                prog = REF_LABELS[c1s]
                dateval = r[2] if len(r) > 2 else None
                iso = None
                if isinstance(dateval, str) and dateval not in ("?", ""):
                    iso = dateval.split("T")[0]
                last_activity.append({"program_id": prog, "last_stay_date": iso,
                                      "notes": f"From {year} sheet: {c1}"})
                continue

            # adjustment row
            if c0s in ADJ_LABELS:
                atype = ADJ_LABELS[c0s]
                for c, (prog, metric) in colmap.items():
                    v = r[c] if len(r) > c else None
                    if is_num(v) and v != 0:
                        # AA status year starts Mar 1 of `year` per spec
                        adjustments.append({
                            "program_id": prog, "program_year": year,
                            "adjustment_type": atype,
                            "metric_values": {metric: v},
                            "notes": f"{c0} ({year})",
                        })
                        per_program_counts.setdefault(prog, {"trips":0,"adjustments":0,"last_activity":0})
                        per_program_counts[prog]["adjustments"] += 1
                continue

            # totals row: blank month+location but has numeric metrics
            metrics_present = [(c, r[c]) for c in colmap if len(r) > c and is_num(r[c])]
            if not c0s and not c1s:
                if metrics_present:
                    for c, v in metrics_present:
                        totals_sum.setdefault(colmap[c], 0)
                    # capture declared totals
                    validation.append({"year": year,
                        "declared": {f"{colmap[c][0]}:{colmap[c][1]}": v for c, v in metrics_present}})
                continue

            # month carry-forward
            if c0s in MONTHS:
                current_month = MONTHS[c0s]
            month = current_month or 1

            # trip row: must have a location or a month
            if not c1s and c0s not in MONTHS:
                continue
            label = str(c1).strip() if c1 is not None else str(c0).strip()
            if not label:
                continue

            mv = {}  # program -> {metric: value}
            for c, (prog, metric) in colmap.items():
                v = r[c] if len(r) > c else None
                if is_num(v) and v != 0:
                    mv.setdefault(prog, {})[metric] = v
                    key = (prog, metric)
                    totals_sum[key] = totals_sum.get(key, 0) + v

            # 2012-style generic 'Miles' col with airline in Notes
            if not has_as_miles:
                mi = low_hdr.index("miles") if "miles" in low_hdr else None
                if mi is not None and len(r) > mi and is_num(r[mi]) and r[mi] != 0:
                    note = str(r[notes_idx]).upper() if len(r) > notes_idx and r[notes_idx] else ""
                    prog = "as" if "AS" in note else "dl" if "DL" in note else "aa" if "AA" in note else "other"
                    metric = "points" if prog in ("as","aa") else "mqm" if prog=="dl" else "miles"
                    mv.setdefault(prog, {})[metric] = r[mi]

            status = "completed" if (complete_col is not None and truthy(r[complete_col] if len(r)>complete_col else None)) \
                else "completed" if (complete_col is None and booked_col is None) \
                else "booked" if (booked_col is not None and truthy(r[booked_col] if len(r)>booked_col else None)) \
                else "planned"

            note_txt = ""
            if len(r) > notes_idx and r[notes_idx]:
                note_txt = str(r[notes_idx]).strip()
            bonus_note = ""
            if bonus_credit_col is not None and len(r) > bonus_credit_col and r[bonus_credit_col]:
                bonus_note = str(r[bonus_credit_col]).strip()

            start = f"{year:04d}-{month:02d}-01"
            entries = []
            for prog, metrics in mv.items():
                entries.append({"program_id": prog, "metric_values": metrics,
                                "card_bonus_notes": bonus_note if prog != "other" else ""})
                per_program_counts.setdefault(prog, {"trips":0,"adjustments":0,"last_activity":0})
                per_program_counts[prog]["trips"] += 1
            trips.append({
                "label": label, "start_date": start, "status": status,
                "is_historical_estimate_date": True, "notes": note_txt,
                "year": year, "entries": entries,
            })

    for la in last_activity:
        per_program_counts.setdefault(la["program_id"], {"trips":0,"adjustments":0,"last_activity":0})
        per_program_counts[la["program_id"]]["last_activity"] += 1

    out = {
        "version": 1,
        "generated_from": "raw_spreadsheet_dump.json",
        "trips": trips,
        "adjustments": adjustments,
        "last_activity": last_activity,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), indent=2)

    print(f"Trips: {len(trips)}  Adjustments: {len(adjustments)}  LastActivity: {len(last_activity)}")
    print("Per-program entry counts (trip program-entries / adjustments / last_activity):")
    for p in sorted(per_program_counts):
        c = per_program_counts[p]
        print(f"  {p:9s} trips={c['trips']:4d}  adj={c['adjustments']:3d}  last={c['last_activity']}")
    # dump counts for report
    json.dump(per_program_counts, open(os.path.join(os.path.dirname(OUT), "seedCounts.json"), "w"), indent=2)

if __name__ == "__main__":
    main()
