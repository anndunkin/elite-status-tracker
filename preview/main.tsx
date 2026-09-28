import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import Dashboard from '../src/pages/Dashboard';
import { SEED_PROGRAMS, SEED_RULES } from '../electron/programsSeed';
import { statusProgress } from '../src/lib/statusProgress';
import type { ProgramProjection } from '../electron/types';
import '../src/index.css';

// Preview-only synthetic examples; never included in the desktop build.
const metrics: Record<string, [Record<string, number>, Record<string, number>]> = {
  aa: [{ points: 25000 }, { points: 175000 }],
  dl: [{ mqd: 30000 }, { mqd: 35000 }],
  as: [{ points: 5000 }, { points: 85000 }],
  ua: [{ pqp: 6000, pqf: 8 }, { pqp: 17000, pqf: 44 }],
  hh: [{ nights: 8 }, { nights: 65 }],
  mb: [{ nights: 28, spend: 4000 }, { nights: 110, spend: 12000 }],
  ih: [{ nights: 0 }, { nights: 45 }],
  wh: [{ nights: 60 }, { nights: 80 }],
};
const rows = SEED_PROGRAMS.filter(p => p.is_active).map(program => {
  const tiers = SEED_RULES.find(r => r.program_id === program.id)!.tiers;
  const [actualTotals, projectedTotals] = metrics[program.id];
  const a = statusProgress(actualTotals, tiers);
  const p = statusProgress(projectedTotals, tiers);
  return {
    program: { ...program, notes: null, metric_keys: JSON.stringify(program.metric_keys) },
    program_year: 2026, currentTotals: actualTotals, ytdTotals: actualTotals, projectedTotals,
    currentTier: a.earned?.tier_name ?? null, ytdTier: a.earned?.tier_name ?? null,
    projectedTier: p.earned?.tier_name ?? null, heldTier: null, heldFromYear: null,
    heldTotals: {}, currentStatusTier: program.id === 'dl' ? 'Diamond' : null,
    lifetimeTier: program.id === 'dl' ? 'Platinum' : null, overrideTier: null,
    lifetimeStatus: program.id === 'dl'
      ? { program_id: 'dl', tier_name: 'Platinum', achieved_date: null, notes: null } : null,
    lifetimeMileage: program.id === 'dl' ? {
      program_id: 'dl', baseline_miles: 2100000, baseline_date: '2026-01-01',
      milestones: [{ label: '3,000,000 Miler', threshold: 3000000 }],
      accruedSinceBaseline: 0, currentMiles: 2100000,
      nextMilestone: { label: '3,000,000 Miler', threshold: 3000000 }, milesToNext: 900000,
    } : null, statusOverride: null,
    nextTier: a.next?.tier_name ?? null, nextTierRequirements: a.next?.requirements ?? null,
    tiers, metricSourceBreakdown: {},
  } satisfies ProgramProjection;
});
window.api = {
  projection: { all: async (year?: number) => rows.map(p => ({ ...p, program_year: year ?? 2026 })) },
  trips: { getAll: async () => [] },
} as unknown as typeof window.api;

function Preview() {
  const [dark, setDark] = useState(false);
  return <div className={dark ? 'dark' : ''}>
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <p className="text-sm text-slate-600 dark:text-slate-300">Dashboard preview · Synthetic examples, not your travel data</p>
        <button className="btn-ghost" onClick={() => setDark(v => !v)}>{dark ? 'Light mode' : 'Dark mode'}</button>
      </div>
      <MemoryRouter><Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/programs/:id" element={<div className="card p-6">
          <p>This preview focuses on the updated dashboard. Program details remain available in the desktop application.</p>
          <Link className="btn-primary mt-4" to="/">Back to dashboard</Link>
        </div>} />
      </Routes></MemoryRouter>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
