import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StatusProgress from '../src/components/StatusProgress';
import Dashboard from '../src/pages/Dashboard';
import { requirementProgress, progressPercent, statusProgress } from '../src/lib/statusProgress';
import type { ProgramProjection } from '../electron/types';
import { vi } from 'vitest';

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
    expect(screen.getByText('Projected: Platinum')).toBeInTheDocument();
    expect(screen.queryByText('Top tier earned')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getAllByText('· Projected to meet')).toHaveLength(3);
  });
  it('does not claim actual top tier when only projected top tier is met', () => {
    const p = fixture(); p.projectedTotals.nights = 100;
    render(<StatusProgress projection={p} />);
    expect(screen.getByRole('progressbar', { name: /projected total/ })).toHaveAttribute('aria-valuenow', '100');
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
  it('interpolates projected milestones between thresholds', () => {
    expect(statusProgress({ nights: 40 }, tiers).projectedFraction).toBe(.875);
    expect(statusProgress({ nights: 30 }, tiers).projectedFraction).toBe(.75);
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
