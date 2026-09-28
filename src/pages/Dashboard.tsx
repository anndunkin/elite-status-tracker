import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ProgramProjection, TripWithDetails } from '../../electron/types';
import { selectDashboardTrips } from '../../electron/rules';
import { displayMetricKey } from '../lib/metricLabels';
import StatusProgress from '../components/StatusProgress';

function totalsText(totals: Record<string, number>, programId?: string): string {
  const keys = Object.keys(totals);
  if (!keys.length) return '—';
  return keys.map(k => `${totals[k].toLocaleString()} ${displayMetricKey(programId, k)}`).join(', ');
}

function StatusRow({ label, tier, totals, tone, programId }:
  { label: string; tier: string | null; totals?: Record<string, number>; tone: 'current' | 'ytd' | 'projected'; programId?: string }) {
  const badge = tone === 'current'
    ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
    : tone === 'ytd'
      ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100'
      : 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300';
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-xs uppercase text-slate-400 w-20 shrink-0">{label}</span>
      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge}`}>{tier ?? 'No status'}</span>
      {totals && <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400 text-right">{totalsText(totals, programId)}</span>}
    </div>
  );
}

function StatusBadge({ status }: { status: TripWithDetails['status'] }) {
  const cls = status === 'booked'
    ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
    : status === 'planned'
      ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
      : 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{status}</span>;
}

function TripRow({ trip, onEdit }: { trip: TripWithDetails; onEdit: (id: number) => void }) {
  const dates = trip.end_date && trip.end_date !== trip.start_date
    ? `${trip.start_date} → ${trip.end_date}` : trip.start_date;
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      <div className="w-40 shrink-0 text-xs text-slate-500 dark:text-slate-400">{dates}</div>
      <div className="flex-1 min-w-0 truncate font-medium">{trip.label}</div>
      <StatusBadge status={trip.status} />
      <button className="btn-ghost text-xs" onClick={() => onEdit(trip.id)}>Edit</button>
    </div>
  );
}

function TripPanel({ title, subtitle, tone, trips, emptyText, onEdit }: {
  title: string; subtitle: string; tone: 'warn' | 'info';
  trips: TripWithDetails[]; emptyText: string; onEdit: (id: number) => void;
}) {
  const header = tone === 'warn'
    ? 'text-amber-700 dark:text-amber-300'
    : 'text-primary-700 dark:text-primary-300';
  const ring = tone === 'warn'
    ? 'border-amber-300 dark:border-amber-700/60'
    : 'border-slate-200 dark:border-slate-700';
  return (
    <div className={`card border ${ring} p-0 overflow-hidden`}>
      <div className="px-3 pt-3 pb-2">
        <h2 className={`font-semibold text-sm ${header}`}>{title}</h2>
        <p className="text-[11px] text-slate-400">{subtitle}</p>
      </div>
      {trips.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-slate-400">{emptyText}</p>
      ) : (
        <div className="max-h-64 overflow-auto divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
          {trips.map(t => <TripRow key={t.id} trip={t} onEdit={onEdit} />)}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [rows, setRows] = useState<ProgramProjection[]>([]);
  const [trips, setTrips] = useState<TripWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const realCurrentYear = new Date().getFullYear();
  const yearParam = Number(searchParams.get('year'));
  const viewYear = Number.isInteger(yearParam) && yearParam >= realCurrentYear - 1 && yearParam <= realCurrentYear + 1
    ? yearParam : realCurrentYear;
  const isLiveView = viewYear === realCurrentYear;

  useEffect(() => {
    setLoading(true);
    // For the live (real current year) view, omit viewYear so projection uses true "now".
    const projArg = isLiveView ? undefined : viewYear;
    Promise.all([window.api.projection.all(projArg), window.api.trips.getAll()])
      .then(([r, t]) => { setRows(r); setTrips(t); setLoading(false); });
  }, [viewYear, isLiveView]);

  // Overdue/upcoming always use the REAL current date; viewYear only restricts by calendar year.
  const { needsUpdate, upcoming } = useMemo(
    () => selectDashboardTrips(trips, viewYear, new Date()),
    [trips, viewYear]);

  const editTrip = (id: number) => navigate(`/trips?edit=${id}`);
  const selectYear = (y: number) => {
    if (y === realCurrentYear) searchParams.delete('year');
    else searchParams.set('year', String(y));
    setSearchParams(searchParams, { replace: true });
  };

  if (loading) return <p className="text-slate-500">Loading projections…</p>;

  const years = [realCurrentYear - 1, realCurrentYear, realCurrentYear + 1];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold">Status Dashboard</h1>
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-sm">
          {years.map(y => (
            <button
              key={y}
              onClick={() => selectYear(y)}
              className={`px-3 py-1.5 focus:outline-none ${
                y === viewYear
                  ? 'bg-primary-600 text-white'
                  : 'bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
              {y}{y === realCurrentYear ? ' (now)' : ''}
            </button>
          ))}
        </div>
      </div>
      <p className="text-slate-500 mb-4 text-sm">
        <b>Current</b> = tier held now (from your last completed program-year, floored by any lifetime status).
        <b> YTD</b> = actual progress in the current program-year. <b>Projected</b> = YTD plus planned &amp; booked estimates.
        Click any card to drill into the underlying trips and entries.
      </p>

      {!isLiveView && (
        <div className="mb-4 rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          Viewing <b>{viewYear}</b> — projections shown as if today were Dec 31, {viewYear}. Overdue/upcoming
          trips below are still judged against today's real date.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(p => {
          const lm = p.lifetimeMileage;
          const lmPct = lm && lm.nextMilestone
            ? Math.min(100, Math.round((lm.currentMiles / lm.nextMilestone.threshold) * 100)) : 0;
          return (
            <button
              key={p.program.id}
              onClick={() => navigate(`/programs/${p.program.id}`)}
              className="card flex flex-col p-4 text-left hover:ring-2 hover:ring-primary-500 transition focus:outline-none focus:ring-2 focus:ring-primary-500">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-semibold">{p.program.name}</h2>
                  <p className="text-xs text-slate-400 uppercase">{p.program.type} · {p.program_year} year</p>
                </div>
                <span className="text-xs rounded bg-slate-100 dark:bg-slate-800 px-2 py-1 text-slate-500">
                  {p.program.type === 'airline' ? '✈' : '🏨'}
                </span>
              </div>

              {p.lifetimeStatus && (
                <div className="mt-2">
                  <span className="inline-block rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-2.5 py-0.5 text-xs font-semibold">
                    ★ Lifetime {p.lifetimeStatus.tier_name}
                  </span>
                </div>
              )}

              <div className="mt-3 space-y-1.5">
                <StatusRow label="Current" tier={p.currentStatusTier} tone="current" programId={p.program.id} />
                <StatusRow label="YTD" tier={p.ytdTier} totals={p.ytdTotals} tone="ytd" programId={p.program.id} />
                <StatusRow label="Projected" tier={p.projectedTier} totals={p.projectedTotals} tone="projected" programId={p.program.id} />
              </div>

              {lm && (
                <div className="mt-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 p-2">
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>Million Miler (lifetime)</span>
                    <span>{lm.currentMiles.toLocaleString()} mi</span>
                  </div>
                  {lm.nextMilestone && (
                    <>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full bg-amber-500" style={{ width: `${lmPct}%` }} />
                      </div>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {lm.milesToNext?.toLocaleString()} mi to {lm.nextMilestone.label}
                      </p>
                    </>
                  )}
                </div>
              )}

              <StatusProgress projection={p} />
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2 mt-6">
        <TripPanel
          title="Needs Update — Past Trips Not Marked Complete"
          subtitle={`Planned/booked trips in ${viewYear} whose dates have passed`}
          tone="warn"
          trips={needsUpdate}
          emptyText="All past trips are up to date. ✓"
          onEdit={editTrip}
        />
        <TripPanel
          title="Upcoming Trips"
          subtitle={`Planned/booked trips in ${viewYear} still to come`}
          tone="info"
          trips={upcoming}
          emptyText={`No upcoming trips for ${viewYear}.`}
          onEdit={editTrip}
        />
      </div>
    </div>
  );
}
