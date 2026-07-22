import path from 'path';

/**
 * Resolve the on-disk path to the application icon for the running window.
 *
 * The icon is a fixed, code-owned asset — no user/renderer input ever flows into
 * this resolution. In dev, the compiled main lives at `electron/dist/main.js`, so
 * the repo's `assets/` folder sits two levels up. In the packaged app the icon is
 * shipped via electron-builder `extraResources` ({ from: "assets", to: "assets" }),
 * landing at `<resourcesPath>/assets/`.
 */
export interface IconPathEnv {
  isPackaged: boolean;
  resourcesPath: string;
  dirname: string;
}

export const ICON_FILE = 'icon.ico';

export function resolveIconPath(env: IconPathEnv): string {
  const base = env.isPackaged
    ? path.join(env.resourcesPath, 'assets')
    : path.join(env.dirname, '..', '..', 'assets');
  return path.join(base, ICON_FILE);
}

/**
 * Defensive containment check: the resolved icon path must stay inside the
 * expected assets directory. Guards against any future change accidentally
 * threading attacker-influenced input into the path.
 */
export function iconPathWithinAssets(env: IconPathEnv): boolean {
  const base = env.isPackaged
    ? path.resolve(env.resourcesPath, 'assets')
    : path.resolve(env.dirname, '..', '..', 'assets');
  const resolved = path.resolve(resolveIconPath(env));
  return resolved === path.join(base, ICON_FILE) && resolved.startsWith(base + path.sep);
}
