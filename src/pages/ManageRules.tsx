import { useEffect, useState } from 'react';
import type {
  Program, ProgramRuleVersion, ProgramTier, TierRequirement,
} from '../../electron/types';

interface TierDraft { tier_name: string; tier_order: number; requirements: TierRequirement[]; }

export default function ManageRules() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [sourceNotes, setSourceNotes] = useState('');
  const [tiers, setTiers] = useState<TierDraft[]>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    window.api.programs.getAll().then(ps => {
      const active = ps.filter(p => p.is_active === 1);
      setPrograms(active);
      if (active[0]) setSelected(active[0].id);
    });
  }, []);

  const loadCurrent = (programId: string) => {
    window.api.programs.getTiers(programId).then(({ versions, tiersByVersion }) => {
      const current = versions.find(v => v.is_current === 1) ?? versions[0];
      setSourceNotes(current?.source_notes ?? '');
      const ct: ProgramTier[] = current ? tiersByVersion[current.id] ?? [] : [];
      setTiers(ct.map(t => ({
        tier_name: t.tier_name, tier_order: t.tier_order,
        requirements: JSON.parse(t.requirements) as TierRequirement[],
      })));
    });
  };

  useEffect(() => { if (selected) { setMsg(''); loadCurrent(selected); } }, [selected]);

  const setThreshold = (ti: number, ri: number, value: number) => {
    setTiers(tiers.map((t, i) => i !== ti ? t : {
      ...t, requirements: t.requirements.map((r, j) => j !== ri ? r : { ...r, threshold: value }),
    }));
  };

  const save = async () => {
    setMsg('');
    try {
      await window.api.programs.createRuleVersion(selected, effectiveDate, sourceNotes, tiers);
      setMsg('Saved new rule version. Prior versions are retained in history.');
      loadCurrent(selected);
    } catch (err) { setMsg(`Error: ${String(err)}`); }
  };

  const conflictNote = (rv: string): string | null => {
    if (rv.includes('$23K vs $25K')) return 'Known conflict: Marriott Ambassador spend threshold ($23K vs $25K). Verify at review.';
    if (rv.includes('20 vs 30')) return 'Known conflict: Hyatt Explorist nights threshold (20 vs 30). Verify at review.';
    return null;
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Manage Program Rules</h1>
      <p className="text-sm text-slate-500 mb-4">Editing thresholds creates a new rule version (history is preserved) and re-projects your status.</p>

      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Program</label>
            <select className="input" value={selected} onChange={e => setSelected(e.target.value)}>
              {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Effective date</label>
            <input type="date" className="input" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Source notes / citation</label>
          <input className="input" value={sourceNotes} onChange={e => setSourceNotes(e.target.value)} />
          {conflictNote(sourceNotes) && (
            <p className="mt-1 text-xs font-medium text-amber-600">{conflictNote(sourceNotes)}</p>
          )}
        </div>

        <div className="space-y-2">
          {tiers.map((t, ti) => (
            <div key={ti} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <div className="font-medium text-sm mb-2">{t.tier_name}</div>
              <div className="flex flex-wrap gap-3">
                {t.requirements.map((r, ri) => (
                  <div key={ri}>
                    <label className="label">{r.metric}{(r.group ?? 0) > 0 ? ` (alt ${r.group})` : ''}</label>
                    <input type="number" className="input w-32" value={r.threshold}
                      onChange={e => setThreshold(ti, ri, Number(e.target.value))} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {tiers.length === 0 && <p className="text-sm text-slate-400">No tiers loaded.</p>}
        </div>

        {msg && <div className="text-sm text-slate-600 dark:text-slate-300">{msg}</div>}
        <div className="flex justify-end">
          <button className="btn-primary" onClick={save}>Save as new version</button>
        </div>
      </div>
    </div>
  );
}
