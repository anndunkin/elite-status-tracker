import { useEffect, useState } from 'react';
import type {
  Program, ProgramRuleVersion, ProgramTier, ProgramLastActivity, TierRequirement,
} from '../../electron/types';

function reqText(json: string): string {
  let reqs: TierRequirement[];
  try { reqs = JSON.parse(json); } catch { return json; }
  const groups = new Map<number, TierRequirement[]>();
  for (const r of reqs) {
    const k = r.group ?? 0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  return [...groups.values()]
    .map(g => g.map(r => `${r.threshold.toLocaleString()} ${r.metric}`).join(' + '))
    .join('  OR  ');
}

export default function Programs() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [lastActivity, setLastActivity] = useState<ProgramLastActivity[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tiers, setTiers] = useState<{ versions: ProgramRuleVersion[]; tiersByVersion: Record<number, ProgramTier[]> } | null>(null);

  useEffect(() => {
    window.api.programs.getAll().then(ps => { setPrograms(ps); setSelected(ps.find(p => p.is_active === 1)?.id ?? null); });
    window.api.programs.lastActivity().then(setLastActivity);
  }, []);

  useEffect(() => {
    if (selected) window.api.programs.getTiers(selected).then(setTiers);
  }, [selected]);

  const active = programs.filter(p => p.is_active === 1);
  const lapsed = programs.filter(p => p.is_active === 0);
  const laById = Object.fromEntries(lastActivity.map(l => [l.program_id, l]));

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside>
        <h1 className="text-2xl font-bold mb-3">Programs</h1>
        <div className="card p-2 mb-4">
          <p className="px-2 py-1 text-xs font-semibold uppercase text-slate-400">Active</p>
          {active.map(p => (
            <button key={p.id} onClick={() => setSelected(p.id)}
              className={`block w-full text-left px-3 py-2 rounded-lg text-sm ${selected === p.id ? 'bg-primary-600 text-white' : 'hover:bg-slate-200 dark:hover:bg-slate-800'}`}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="card p-2">
          <p className="px-2 py-1 text-xs font-semibold uppercase text-slate-400">Lapsed / reference</p>
          {lapsed.map(p => {
            const la = laById[p.id];
            return (
              <div key={p.id} className="px-3 py-2 text-sm">
                <div className="font-medium text-slate-600 dark:text-slate-300">{p.name}</div>
                {la?.last_stay_date && <div className="text-xs text-slate-400">Last activity: {la.last_stay_date}</div>}
                {p.notes && <div className="text-[11px] text-slate-400">{p.notes}</div>}
              </div>
            );
          })}
        </div>
      </aside>

      <section>
        {!tiers || !selected ? (
          <p className="text-slate-400">Select a program.</p>
        ) : (
          <div className="space-y-5">
            {tiers.versions.map((v, idx) => (
              <div key={v.id} className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="font-semibold">
                      Rules effective {v.effective_date}
                      {idx === 0 && v.is_current === 1 && <span className="ml-2 text-xs rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5">current</span>}
                    </h2>
                    {v.source_notes && <p className="text-xs text-slate-400 mt-1 break-all">{v.source_notes}</p>}
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 uppercase">
                      <th className="py-1">Tier</th>
                      <th className="py-1">Requirements</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tiers.tiersByVersion[v.id] ?? []).map(t => (
                      <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-1.5 font-medium">{t.tier_name}</td>
                        <td className="py-1.5 text-slate-600 dark:text-slate-300">{reqText(t.requirements)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
