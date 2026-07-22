import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { ThemeProvider, useTheme } from './theme';
import Dashboard from './pages/Dashboard';
import Trips from './pages/Trips';
import Programs from './pages/Programs';
import ProgramDetail from './pages/ProgramDetail';
import CardEarnings from './pages/CardEarnings';
import ManageRules from './pages/ManageRules';
import Settings from './pages/Settings';
import RefreshBanner from './components/RefreshBanner';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/trips', label: 'Trips' },
  { to: '/programs', label: 'Programs' },
  { to: '/card-earnings', label: 'Card Earnings' },
  { to: '/rules', label: 'Manage Rules' },
  { to: '/settings', label: 'Settings' },
];

function Shell() {
  const { theme, toggle } = useTheme();
  const [dbPath, setDbPath] = useState('');

  useEffect(() => { window.api.file.currentPath().then(setDbPath); }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-primary-600">✈</span>
          <span className="text-lg font-bold">Elite Status Tracker</span>
        </div>
        <nav className="flex gap-1">
          {NAV.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-sm font-medium ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden md:inline text-xs text-slate-400 max-w-xs truncate" title={dbPath}>{dbPath}</span>
          <button className="btn-ghost" onClick={toggle} title="Toggle theme">
            {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
          </button>
        </div>
      </header>

      <RefreshBanner />

      <main className="flex-1 overflow-auto p-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/trips" element={<Trips />} />
          <Route path="/programs" element={<Programs />} />
          <Route path="/programs/:id" element={<ProgramDetail />} />
          <Route path="/card-earnings" element={<CardEarnings />} />
          <Route path="/rules" element={<ManageRules />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}
