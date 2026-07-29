// v1.5: display-only metric key renaming. The underlying storage key never
// changes — this only affects what label the UI shows next to a value.
// American AAdvantage's "points" metric is displayed as "LPs" (Loyalty Points)
// to match the program's current terminology, while everything on disk still
// uses the historical 'points' key so existing data keeps working.
export function displayMetricKey(programId: string | null | undefined, key: string): string {
  if (programId === 'aa' && key === 'points') return 'LPs';
  return key;
}

// Renderer-safe copy of electron/database.ts's statusMultiplierForAA, used only for the
// Trip editor's convenience pre-fill (the authoritative multiplier is applied server-side
// in computeProjections, which resolves the tier held entering the status year). Duplicated
// here rather than imported from electron/database.ts to avoid pulling Node/better-sqlite3
// internals into the browser bundle.
export function statusMultiplierForAAPreview(tier: string | null | undefined): number {
  switch (tier) {
    case 'Gold': return 7;
    case 'Platinum': return 8;
    case 'Platinum Pro': return 9;
    case 'Executive Platinum': return 11;
    default: return 5;
  }
}

// Renderer-safe mirror of electron/database.ts's deriveSegmentCost, kept in sync so the trip
// editor previews exactly the cost the backend will credit: segments tagged with this program
// win, and the trip's untagged segments are the fallback when none are tagged for it.
export function segmentCostForProgram(
  segments: Array<{ program_id?: string | null; cost_usd?: number | null }>,
  programId: string,
): number {
  const priced = segments.filter(s => typeof s.cost_usd === 'number');
  const tagged = priced.filter(s => s.program_id === programId);
  const source = tagged.length > 0 ? tagged : priced.filter(s => !s.program_id);
  return source.reduce((sum, s) => sum + (s.cost_usd as number), 0);
}
