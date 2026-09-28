// Run on an isolated Windows CI runner, never on a user's machine.
const { _electron: electron } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const out = path.resolve('qa-evidence');
fs.mkdirSync(out, { recursive: true });
// installer.nsh sets $INSTDIR from $EXEDIR during customInit. Stage both
// versions beside the SAME directory instead of assuming /D overrides it.
const stagingDir = path.join(process.env.RUNNER_TEMP, 'elite-status-installer-test');
fs.mkdirSync(stagingDir, { recursive: true });
const installDir = path.join(stagingDir, 'Elite Status Tracker');
const executablePath = path.join(installDir, 'Elite Status Tracker.exe');
const installer = path.join(stagingDir, 'current-setup.exe');
fs.copyFileSync(path.resolve('dist-installer', fs.readdirSync('dist-installer').find(n => n.endsWith('.exe'))), installer);
const prior = process.env.PRIOR_INSTALLER ? path.join(stagingDir, 'previous-setup.exe') : null;
if (prior) fs.copyFileSync(process.env.PRIOR_INSTALLER, prior);
const report = [];
const record = message => { report.push(message); console.log(message); };
let dbPath;
let app;
async function launch(checkNew, seed = false) {
  app = await electron.launch({ executablePath, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    await page.getByRole('heading', { name: 'Status Dashboard' }).waitFor({ timeout: 60000 });
    const currentDb = await page.evaluate(() => window.api.file.currentPath());
    if (dbPath) assert.equal(currentDb, dbPath);
    dbPath = currentDb;
    if (seed) {
      await page.evaluate(async () => {
        const year = new Date().getFullYear();
        await window.api.trips.create({ label: 'Installer QA retention', start_date: `${year}-04-01`, status: 'completed',
          entries: [{ program_id: 'aa', is_estimate: false, metric_values: { points: 25000 } }] });
        await window.api.trips.create({ label: 'Installer QA forecast', start_date: `${year}-10-01`, status: 'planned',
          entries: [{ program_id: 'aa', is_estimate: true, metric_values: { points: 150000 } }] });
      });
    } else {
      assert((await page.evaluate(() => window.api.trips.getAll())).some(t => t.label === 'Installer QA retention'));
    }
    if (checkNew) {
      await page.reload();
      await page.getByText('Actual earned', { exact: true }).first().waitFor();
      assert.equal(await page.getByRole('progressbar').count(), 16);
      assert.equal(await page.getByRole('progressbar', { name: 'American AAdvantage: actual earned', exact: true }).getAttribute('aria-valuenow'), '62');
      assert.equal(await page.getByText('Projected: Platinum Pro', { exact: true }).count(), 1);
      // Theme persists across upgrade/reinstall. Normalize before capturing
      // each mode rather than assuming every launch starts in light mode.
      const themeToggle = page.getByTitle('Toggle theme');
      if (await page.evaluate(() => document.documentElement.classList.contains('dark'))) await themeToggle.click();
      await page.screenshot({ path: path.join(out, 'windows-dashboard-light.png') });
      await themeToggle.click();
      await page.screenshot({ path: path.join(out, 'windows-dashboard-dark.png') });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
      const overflow = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="status-progress-"]')].some(el => el.scrollWidth > el.clientWidth));
      assert.equal(overflow, false);
      await page.screenshot({ path: path.join(out, 'windows-dashboard-small.png') });
      await page.getByRole('button', { name: /American AAdvantage AIRLINE/i }).click();
      await page.getByRole('heading', { name: 'American AAdvantage' }).waitFor();
      const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
      assert.equal(prefs.contextIsolation, true);
      assert.equal(prefs.nodeIntegration, false);
      record('Packaged runtime: dual bars, forecast separation, navigation, minimum window size, and renderer isolation passed.');
    }
  } finally { await app.close(); app = null; }
}
function install(file) {
  execFileSync(file, ['/S'], { timeout: 180000 });
  assert(fs.existsSync(executablePath));
}
(async () => {
  if (prior) {
    install(prior); await launch(false, true);
    record('Previous-version clean install and synthetic data creation passed.');
    install(installer); await launch(true);
    record('Upgrade from v1.6.2 preserved the database and trips.');
  } else { install(installer); await launch(true, true); record('Clean install passed.'); }
  install(installer); await launch(true);
  record('Same-version reinstall/repair preserved the database and trips.');
  const uninstaller = fs.readdirSync(installDir).find(n => /^Uninstall.*\.exe$/i.test(n));
  assert(uninstaller);
  execFileSync(path.join(installDir, uninstaller), ['/S'], { timeout: 180000 });
  for (let i = 0; i < 60 && fs.existsSync(executablePath); i++) await new Promise(r => setTimeout(r, 500));
  assert(!fs.existsSync(executablePath));
  assert(fs.existsSync(dbPath));
  record('Uninstall removed the application and preserved the database.');
  install(installer); await launch(true);
  record('Reinstall after uninstall reopened preserved trips.');
  fs.writeFileSync(path.join(out, 'windows-smoke-results.txt'), report.join('\n') + '\n');
})().catch(async err => {
  if (app) await app.close().catch(() => {});
  console.error(err); process.exitCode = 1;
});
