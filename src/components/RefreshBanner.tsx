import { useEffect, useState } from 'react';

export default function RefreshBanner() {
  const [status, setStatus] = useState<{ due: boolean; nextCheckDue: string; lastChecked: string | null } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const load = () => window.api.refresh.status().then(setStatus);
  useEffect(() => { load(); }, []);

  if (!status || !status.due || dismissed) return null;

  const markReviewed = async () => {
    await window.api.programs.getAll().then(async ps => {
      const ids = ps.filter(p => p.is_active === 1).map(p => p.id);
      await window.api.refresh.log(ids, []);
    });
    setDismissed(true);
    load();
  };

  return (
    <div className="flex items-center gap-3 bg-amber-100 dark:bg-amber-900/40 border-b border-amber-300 dark:border-amber-800 px-6 py-2 text-sm">
      <span className="font-semibold text-amber-800 dark:text-amber-200">Quarterly rule review is due.</span>
      <span className="text-amber-700 dark:text-amber-300">
        Verify each program's tier thresholds against its source, then mark reviewed. Two known conflicts are flagged in Manage Rules.
      </span>
      <div className="ml-auto flex gap-2">
        <button className="btn-primary" onClick={markReviewed}>Mark reviewed (+3 months)</button>
        <button className="btn-ghost" onClick={() => setDismissed(true)}>Later</button>
      </div>
    </div>
  );
}
