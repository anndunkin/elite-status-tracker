module.exports = {
  appId: "com.dunkinglobal.elitestatustracker",
  productName: "Elite Status Tracker",
  directories: { output: "dist-installer" },
  files: [
    "dist/**/*",
    "electron/dist/**/*",
    "node_modules/**/*",
    "!node_modules/*/{CHANGELOG.md,README.md,readme.md}",
    "!node_modules/*/{test,__tests__,tests,example,examples}",
    "!node_modules/.bin",
    "prebuilt-win32-x64/**/*"
  ],
  asar: true,
  asarUnpack: [
    "node_modules/better-sqlite3/build/Release/*.node",
    "electron/dist/preload.js"
  ],
  extraResources: [
    { from: "assets", to: "assets" }
  ],
  npmRebuild: false,
  afterPack: "./scripts/afterPack.js",
  win: {
    target: [
      { target: "zip", arch: ["x64"] },
      { target: "nsis", arch: ["x64"] }
    ],
    icon: "assets/icon.ico",
    requestedExecutionLevel: "asInvoker",
    forceCodeSigning: false,
    // Must be true: this is the step (via rcedit) that actually embeds the
    // custom icon and version metadata into the packaged .exe. It runs on a
    // real Windows CI runner (see .github/workflows), so there's no
    // winCodeSign 7z-symlink-extraction issue that would require disabling
    // it. `forceCodeSigning: false` + no configured cert + `CSC_IDENTITY_
    // AUTO_DISCOVERY: false` in CI already fully disable actual code
    // signing; this flag only additionally (and unintentionally, since
    // v1.0.0) skipped icon/metadata embedding, which is why the taskbar and
    // shortcuts showed the generic Electron icon despite win.icon and the
    // BrowserWindow icon option both being set correctly.
    signAndEditExecutable: true
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    allowElevation: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Elite Status Tracker",
    deleteAppDataOnUninstall: false,
    include: "scripts/installer.nsh"
  },
  mac: {
    target: "dmg",
    icon: "assets/icon.png"
  },
  linux: {
    target: "AppImage",
    icon: "assets/icon.png"
  }
}
