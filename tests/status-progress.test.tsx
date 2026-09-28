import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StatusProgress from '../src/components/StatusProgress';
import Dashboard from '../src/pages/Dashboard';
import { requirementProgress, progressPercent, statusProgress } from '../src/lib/statusProgress';
import type { ProgramProjection } from '../electron/types';
import { vi } from 'vitest';
import { SEED_RULES } from '../electron/programsSeed';

const tiers = [10, 20, 30, 50].map((n, i) => ({
  tier_name: ['Silver', 'Gold', 'Platinum', 'Diamond'][i],
  tier_order: i + 1, requirements: [{ metric: 'nights', threshold: n }],
}));
export function fixture(): ProgramProjection {
  return {
    program: { id: 'demo', name: 'Test Hotel', type: 'hotel', is_active: 1, year_type: 'calendar', metric_keys: '["nights"]', notes: null },
    program_year: 2026, currentTotals: { nights: 5 }, ytdTotals: { nights: 5 }, projectedTotals: { nights: 40 },
    currentTier: null, ytdTier: null, projectedTier: 'Platinum',
    heldTier: 'Diamond', heldFromYear: 2025, heldTotals: {}, lifetimeTier: 'Diamond', overrideTier: null,
    currentStatusTier: 'Diamond', lifetimeStatus: null, lifetimeMileage: null, statusOverride: null,
    nextTier: 'Silver', nextTierRequirements: tiers[0].requirements, tiers,
    metricSourceBreakdown: {},
  };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('dashboard dual progress', () => {
  it('keeps Actual at 50% of Silver when forecast is three tiers higher', () => {
    render(<StatusProgress projection={fixture()} />);
    expect(screen.getByRole('progressbar', { name: 'Test Hotel: actual earned' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('Next: Silver · 50%')).toBeInTheDocument();
    expect(screen.getByText('5 / 10 nights')).toBeInTheDocument();
    expect(screen.getByText('Next: Diamond')).toBeInTheDocument();
    expect(screen.queryByText('Top tier earned')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getAllByTestId(/tier-label-/)).toHaveLength(4);
    expect(screen.getByText('40 / 50 nights')).toBeInTheDocument();
    expect(screen.queryByText(/Requires:/)).not.toBeInTheDocument();
  });
  it('does not claim actual top tier when only projected top tier is met', () => {
    const p = fixture(); p.projectedTotals.nights = 100;
    render(<StatusProgress projection={p} />);
    expect(screen.getByRole('progressbar', { name: /projected total/ })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('progressbar', { name: /projected total/ })).toHaveAttribute('aria-valuemax', '50');
    expect(screen.getByText('100 / 50 nights')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /actual earned/ })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByText('Top tier earned')).not.toBeInTheDocument();
  });
  it('advances the actual target at the exact threshold', () => {
    const p = fixture(); p.ytdTotals.nights = 10;
    render(<StatusProgress projection={p} />);
    expect(screen.getByText('Next: Gold · 50%')).toBeInTheDocument();
  });
  it('retains both bars after actual top tier is earned', () => {
    const p = fixture(); p.ytdTotals.nights = 60;
    render(<StatusProgress projection={p} />);
    expect(screen.getByText('Top tier earned')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  });
  it('renders missing rules without a false top-tier claim', () => {
    const p = fixture(); p.tiers = [];
    render(<StatusProgress projection={p} />);
    expect(screen.getByText('No tier rules available.')).toBeInTheDocument();
    expect(screen.queryByText('Top tier earned')).not.toBeInTheDocument();
  });
  it('escapes rule names instead of interpreting markup', () => {
    const p = fixture(); p.tiers = [{ ...tiers[0], tier_name: '<img src=x onerror=alert(1)>' }];
    const { container } = render(<StatusProgress projection={p} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
  it('integrates both bars in Dashboard and refreshes data on year selection', async () => {
    const all = vi.fn().mockResolvedValue([fixture()]);
    vi.stubGlobal('api', undefined);
    window.api = { projection: { all }, trips: { getAll: vi.fn().mockResolvedValue([]) } } as unknown as typeof window.api;
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText('Actual earned')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
    const { fireEvent } = await import('@testing-library/react');
    const lastYear = new Date().getFullYear() - 1;
    fireEvent.click(screen.getByRole('button', { name: String(lastYear), exact: true }));
    await screen.findByText(new RegExp(`Viewing`));
    expect(all).toHaveBeenLastCalledWith(lastYear);
  });
});

describe('qualification-safe progress math', () => {
  it.each([0, 1, 9.999, 10, 19.999, 20, 30, 50, 100])('bounds progress at %s nights', nights => {
    const r = statusProgress({ nights }, tiers);
    expect(r.actualFraction).toBeGreaterThanOrEqual(0);
    expect(r.actualFraction).toBeLessThanOrEqual(1);
    expect(r.projectedFraction).toBeGreaterThanOrEqual(0);
    expect(r.projectedFraction).toBeLessThanOrEqual(1);
  });
  it('uses the limiting AND metric, not a completed first metric', () => {
    expect(requirementProgress({ nights: 100, spend: 5000 }, [
      { metric: 'nights', threshold: 100 }, { metric: 'spend', threshold: 20000 },
    ])).toBe(.25);
  });
  it('uses the strongest OR route even when it is not listed first', () => {
    expect(requirementProgress({ nights: 2, points: 1000 }, [
      { metric: 'nights', threshold: 10, group: 0 }, { metric: 'points', threshold: 1000, group: 1 },
    ])).toBe(1);
  });
  it('uses a proportional numeric scale rather than tier ranks', () => {
    expect(statusProgress({ nights: 40 }, tiers).projectedFraction).toBe(.8);
    expect(statusProgress({ nights: 30 }, tiers).projectedFraction).toBe(.6);
  });
  it('does not round near-completion up to 100%', () => {
    expect(progressPercent(.99999)).toBe(99);
  });
  it.each([NaN, Infinity, -5])('keeps invalid or negative totals safe: %s', nights => {
    expect(requirementProgress({ nights }, tiers[0].requirements)).toBe(0);
  });
  it.each([0, -1, NaN, Infinity])('keeps invalid thresholds safe: %s', threshold => {
    expect(requirementProgress({ nights: 10 }, [{ metric: 'nights', threshold }])).toBe(0);
  });
  it('handles missing metrics and empty routes', () => {
    expect(requirementProgress({}, tiers[0].requirements)).toBe(0);
    expect(requirementProgress({}, [])).toBe(0);
  });
  it('sorts custom tiers without modifying their input order', () => {
    const reversed = [...tiers].reverse();
    expect(statusProgress({}, reversed).next?.tier_name).toBe('Silver');
    expect(reversed[0].tier_name).toBe('Diamond');
  });
});

describe('approved proportional mockup and requirement-line caveat', () => {
  function program(id: string, actual: Record<string, number>, projected: Record<string, number>) {
    const p = fixture();
    p.program.id = id;
    p.tiers = SEED_RULES.find(r => r.program_id === id)!.tiers;
    p.ytdTotals = actual; p.projectedTotals = projected;
    return p;
  }
  it('places American tier markers at 20%, 37.5%, 62.5%, and 100%', () => {
    const p = program('aa', { points: 25000 }, { points: 175000 });
    const r = statusProgress(p.projectedTotals, p.tiers);
    expect(r.scale?.milestones.map(m => m.fraction)).toEqual([.2, .375, .625, 1]);
    render(<StatusProgress projection={p} />);
    expect(screen.getByTestId('tier-tick-aa-1')).toHaveStyle({ left: '20%' });
    expect(screen.getByTestId('tier-tick-aa-2')).toHaveStyle({ left: '37.5%' });
    expect(screen.getByTestId('tier-tick-aa-3')).toHaveStyle({ left: '62.5%' });
    expect(screen.getByTestId('projected-fill-aa')).toHaveStyle({ width: '87.5%' });
    expect(screen.getByText('25,000 / 40,000 LPs')).toBeInTheDocument();
    expect(screen.getByText('175,000 / 200,000 LPs')).toBeInTheDocument();
    expect(screen.queryByText(/Requires:/)).not.toBeInTheDocument();
  });
  it('retains alternative requirements under both Hilton bars, with currency formatting', () => {
    render(<StatusProgress projection={program('hh', { nights: 5 }, { nights: 8 })} />);
    expect(screen.getAllByText('Requires: 10 nights OR 4 stays OR $2,500 spend')).toHaveLength(2);
    expect(screen.getByText('5 / 10 nights')).toBeInTheDocument();
    expect(screen.getByText('8 / 10 nights')).toBeInTheDocument();
    expect(screen.getByText('Projected total · nights')).toBeInTheDocument();
  });
  it('uses the best route for actual progress if stays are farther along than nights', () => {
    render(<StatusProgress projection={program('hh', { nights: 1, stays: 3 }, {})} />);
    expect(screen.getByRole('progressbar', { name: /actual earned/ })).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByText('3 / 4 stays')).toBeInTheDocument();
  });
  it('retains United combined and alternative paths without falsely qualifying on PQP alone', () => {
    render(<StatusProgress projection={program('ua', {}, { pqp: 22000, pqf: 1 })} />);
    expect(screen.getByText('Next: Premier 1K')).toBeInTheDocument();
    expect(screen.getByText('22,000 / 22,000 pqp + 1 / 60 pqf')).toBeInTheDocument();
    expect(screen.getByText('Requires: 22,000 pqp + 60 pqf OR 28,000 pqp')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /projected total/ })).toHaveAttribute('aria-valuetext', expect.stringContaining('Projected status: Platinum'));
    expect(screen.queryByText('Top tier earned')).not.toBeInTheDocument();
  });
  it('shows all AND metrics without a redundant Requires line', () => {
    render(<StatusProgress projection={program('mb', {}, { nights: 110, spend: 12000 })} />);
    expect(screen.getByText('Next: Ambassador')).toBeInTheDocument();
    expect(screen.getByText('110 / 100 nights + $12,000 / $23,000 spend')).toBeInTheDocument();
    expect(screen.queryByText(/Requires:/)).not.toBeInTheDocument();
  });
  it('supports full qualification through an alternative route while clearly labeling the numeric axis', () => {
    render(<StatusProgress projection={program('wh', {}, { points: 100000 })} />);
    expect(screen.getByText('Projected: Globalist')).toBeInTheDocument();
    expect(screen.getByText('Projected total · nights')).toBeInTheDocument();
    expect(screen.getByText('Requires: 60 nights OR 100,000 points')).toBeInTheDocument();
    expect(screen.getByTestId('projected-fill-wh')).toHaveStyle({ width: '0%' });
  });
  it.each([-10, NaN, Infinity])('sanitizes invalid plotted values: %s', nights => {
    expect(statusProgress({ nights }, tiers).scale?.fraction).toBe(0);
  });
  it('does not invent a common numeric scale for incompatible custom metrics', () => {
    const p = fixture();
    p.tiers = [tiers[0], { ...tiers[1], requirements: [{ metric: 'points', threshold: 20 }] }];
    render(<StatusProgress projection={p} />);
    expect(screen.getByText('No common numeric scale in these tier rules.')).toBeInTheDocument();
  });
  it('supports coincident custom thresholds without dividing by zero', () => {
    const p = fixture();
    p.tiers = [tiers[0], { ...tiers[1], requirements: [{ metric: 'nights', threshold: 10 }] }];
    expect(statusProgress({ nights: 5 }, p.tiers).scale?.milestones.map(m => m.fraction)).toEqual([1, 1]);
    expect(statusProgress({ nights: 5 }, p.tiers).projectedFraction).toBe(.5);
  });
  it('uses changed rule thresholds rather than hard-coded American positions', () => {
    const p = program('aa', {}, { points: 175000 });
    p.tiers = p.tiers.map(t => ({ ...t, requirements: t.requirements.map(r => ({ ...r, threshold: r.threshold * 2 })) }));
    expect(statusProgress(p.projectedTotals, p.tiers).scale?.maximum).toBe(400000);
    expect(statusProgress(p.projectedTotals, p.tiers).projectedFraction).toBe(.4375);
  });
});
