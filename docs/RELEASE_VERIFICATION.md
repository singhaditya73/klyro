# Release verification

The pre-release gate for every Klyro release. Status reflects what has actually
been verified on this machine (see `docs/ENGINEERING_CHECKLIST.md` for the phase
log). Nothing here is marked done by intent — only by running the commands.

## 1. Automated gate (run in this order)

| Command | Passes on this machine | Asserts |
| --- | --- | --- |
| `npm run typecheck` | ✅ | Main (`tsc -p tsconfig.node.json`) and renderer (`tsconfig.web.json`) both clean |
| `npm test` | ✅ | 357 unit/integration tests in 57 files, 8 skipped (`vitest run`) |
| `npm run build` | ✅ | `out/main`, `out/preload`, `out/renderer` produced by electron-vite |
| `npx electron scripts/smoke.cjs` (needs a display; CI: `xvfb-run -a …`) | ✅ | Boots the **real built app**; both windows render, the `window.klyro` bridge is present, no renderer errors and no CSP violations |
| `DISPLAY=:0 npm run smoke` | ✅ | Same, invoked via the package script |

CI runs the same gate on every push/pull-request (`.github/workflows/ci.yml`,
Ubuntu, Node 22, `ELECTRON_DISABLE_SANDBOX=1` under xvfb).

### Live checks that need a real provider (0.9.15)

These drive the built app, so they are not part of CI:

| Script | What it proves |
| --- | --- |
| `npx electron scripts/check-ephemeral.cjs` (needs Ollama) | An ephemeral session leaves no text in `interviews.json`, `conversations.json`, `answer-cache.json`, `memory.json` or `audit.json` — and a conversation it borrowed keeps its earlier history. Verified 2026-10-22. |
| `npx electron scripts/check-antigravity-capture.cjs` (IDE open) | The one-time capture: the account, plan and 15 chat models come from the running IDE. |
| `npx electron scripts/check-antigravity-headless.cjs` (no Antigravity process) | Klyro starts Antigravity's own service from the saved session and answers through the app and through the Rust daemon. Verified 2026-10-22. |
| `npx electron scripts/check-overlay-catalogue.cjs` (app closed) | The overlay's model chip opens a menu grouped by every connected provider. Verified 2026-10-22 with Ollama, Claude Code and Antigravity in one list (2 + 6 + 15 models), and a pick from Claude Code moved `activeProvider` and saved its `fastModel`. |
| `npx vitest run src/main/domains/local-agent-launcher.real.test.ts` (OpenCode installed) | Starts the real OpenCode server, reads its password, and runs the connect-time model check: it skipped `flint-40b-free` (no answer in 6 s) and selected `recursive/flint-v1.0:free`, which answered. Verified 2026-10-22. |
| `npx electron --user-data-dir=/tmp/klyro-refresh scripts/check-daemon-refresh.cjs` (app built) | A daemon left over from another build is replaced on launch: the fake daemon reporting `0.1.0` is stopped, the binary on disk takes over, writes its version and answers. Verified 2026-10-22. |
| `npx electron --user-data-dir=/tmp/klyro-real scripts/check-overlay-menu.cjs` (app built) | The overlay's model menu inside the real window: the chip shows a name and not an internal id, the menu is not clipped by the window, the search box is visible, the list scrolls, the LOCAL badges are there, and picking a model switches the provider and gives the window its room back. |
| Screenshots of every surface (app built) | The six pages of the control panel and the overlay — idle, typed and answering — were captured from the running app and reviewed: the overlay fits its content, the answer shows the question, the timing, the copy and the retry, the drawer slides away on a narrow window, and the light theme is legible. |

### Extra runtime checks used during this program

Not part of CI (they drive the UI), but reproducible in a display session:
clicking every sidebar item (Home, Chat, Screen, Agent, Workflows, Memory,
Integrations, Settings) via CDP/`executeJavaScript` and asserting the expected
workspace or panel is present in the DOM with zero console errors. All current
items pass on `main`.

## 2. Packaging matrix

| Target | Command | Runs on | Status |
| --- | --- | --- | --- |
| Linux AppImage + deb | `npm run dist:linux` | Linux | ✅ **Built and verified here**: `Klyro-0.2.0-x86_64.AppImage` + `Klyro-0.2.0-amd64.deb`, unsigned; the unpacked build (`release/linux-unpacked/klyro`) boots and logs "Klyro 0.2.0 ready" and keeps running |
| Unpacked builds | `npm run pack:{linux,win,mac}` | as platform | Script available (`pack:linux` verified) |
| Windows NSIS | `npm run dist:win` | **Windows only** (NSIS needs Wine from Linux; hosted runners don't provide it) | Not verified here |
| macOS dmg | `npm run dist:mac` | macOS | Not verified here (no macOS machine in this environment) |

Artifacts land in `release/` (config: `electron-builder.yml`; the package
contains only `out/**` and `package.json` — no sources, tests, or type maps).
Note: `package.json` must keep its `homepage` and `repository` fields — without
them the deb (FPM) metadata step fails with "Please specify project homepage".

## 3. Signing & updates — honest current state

- **Nothing is signed or notarized yet.**
  - Linux: the verified AppImage/deb are unsigned. AppImage may need a
    right-click → properties → "executable" on some desktops; deb installs
    with `apt`.
  - Windows: no Authenticode certificate is configured. Windows SmartScreen
    will warn on first run. To fix: obtain a code-signing certificate and set
    `win.certificateSubjectName`/`certificateFile` in `electron-builder.yml`.
  - macOS: unsigned, and the dmg target has never been built in this
    environment. To fix: Apple Developer ID + entitlements + notarization
    (`mac.identity`, `notarize` in electron-builder, hardened runtime).
- **No auto-updater is wired.** `electron-updater` is not a dependency and the
  app does not check for updates. If/when updates are wanted, the steps are:
  add `electron-updater`, publish with GitHub Releases
  (`publish: { provider: 'github' }`), sign installers first (updaters verify
  signatures), and keep `electron-builder.yml` appID/repostitory URLs in sync.
  Hand-updating today means downloading a new release from GitHub.

## 4. Tagging a release

1. Confirm the §1 gate is green on `main`.
2. Update `CHANGELOG.md` and the version in `package.json`
   (`npm version <x.y.z>` bumps `package.json`, syncs `crates/klyro-core/Cargo.toml` (the daemon reports that version), and commits).
3. `git tag vX.Y.Z && git push origin vX.Y.Z` — `.github/workflows/release.yml`
   builds Linux artifacts and attaches them to the GitHub release.
   Windows installers must be built on a Windows machine (`npm run dist:win`).

## 5. Known external blockers (does not gate code correctness)

- **Wayland screen capture**: needs `xdg-desktop-portal` + a desktop backend
  (`xdg-desktop-portal-gtk` or `-kde`) installed and allowed by the user;
  without it the Screen assistant reports the portal failure truthfully
  instead of capturing.
- **Global shortcut conflict**: `CommandOrControl+Shift+Space` may already be
  taken by the desktop environment. Klyro logs a warning and keeps running;
  the shortcut can be changed in Settings.
- **Automation backends** are optional system packages (`xdotool`, `ydotool`
  daemon, `wtype`); the Agent panel states exactly what is missing when none
  is installed.
