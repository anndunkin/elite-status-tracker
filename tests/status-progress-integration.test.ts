// @vitest-environment node
import { expect, it } from 'vitest';
import { seededDb } from './helpers';
import { computeProjections, tripCreate, cardEarningCreate } from '../electron/database';
import { statusProgress } from '../src/lib/statusProgress';

it('projects completed + booked + planned once, with posted credits, inside AA program year', () => {
  const db = seededDb();
  try {
    for (const [status, points, date] of [
      ['completed', 20000, '2026-04-01'], ['booked', 70000, '2026-10-01'],
      ['planned', 80000, '2027-02-15'], ['planned', 999999, '2027-03-01'],
    ] as const) {
      tripCreate(db, { label: 'Synthetic QA', start_date: date, status,
        entries: [{ program_id: 'aa', is_estimate: status !== 'completed', metric_values: { points } }] });
    }
    cardEarningCreate(db, { program_id: 'aa', entry_date: '2026-05-01', metric_key: 'points', amount: 5000 });
    const aa = computeProjections(db, new Date('2026-09-28T12:00:00Z')).find(p => p.program.id === 'aa')!;
    expect(aa.ytdTotals.points).toBe(25000);
    expect(aa.projectedTotals.points).toBe(175000);
    expect(statusProgress(aa.ytdTotals, aa.tiers).next?.tier_name).toBe('Gold');
    expect(statusProgress(aa.projectedTotals, aa.tiers).earned?.tier_name).toBe('Platinum Pro');
  } finally { db.close(); }
});
