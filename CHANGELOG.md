# Changelog

All notable changes to Klyro are recorded here. Versions follow [SemVer](https://semver.org/).

## [Unreleased]

Post-0.2.0 engineering completion program (details in `docs/ENGINEERING_CHECKLIST.md`).

### Fixed

- Sidebar panels (Agent, Memory, Settings) did not open after the redesign:
  panel opening now closes other panels first instead of open-then-close, the
  lazy Agent/Knowledge panels render at their single overlay site with a
  Suspense boundary, and raw `\uXXXX` escapes in JSX text render their real
  glyphs. Verified by a scripted click-through of every sidebar item in the
  running app.

### Added

- **Common integration contract (G1)** — one client shape (descriptor, cheap
  status, `selfTest()`) plus a registry; GitHub implements it with a live
  credential check, exposed as a "Test connection" button in the Integrations
  view.
- **Opt-in crash reporting (J2)** — off by default; when enabled, redacted
  reports are stored locally (max 20) and viewable/clearable in Settings, and
  are only uploaded if `KLYRO_DIAGNOSTICS_URL` is explicitly configured.
- Packaging: `package.json` now carries `homepage`/`repository`, fixing the
  deb build; Linux AppImage + deb verified locally (see
  `docs/RELEASE_VERIFICATION.md`).

## [0.2.0] — 2026-10-18

Feature-complete for the planned A–E roadmap: shell, autonomous agent, memory and
knowledge, coding/meetings/workflows, and packaging.

### Added

- **Desktop agent (Stage B).** Observe → plan → act loop with a strict-JSON planner,
  one action per screenshot and re-observation after each action, a confirmation gate
  for consequential actions, cancellation, a step cap, and persisted task history.
  Input backends: `xdotool`/`ydotool`/`wtype` (Linux), `osascript` + `cliclick` (macOS),
  PowerShell + user32 (Windows), with a capability probe and exact install hints.
- **Knowledge (Stage C).** Local memory with tags, pinning, Jaccard duplicate
  suppression and optional fact extraction; document import for text, code, HTML, CSV,
  JSON, PDF (`pdftotext`) and Office (`unzip`); BM25 retrieval injected as a delimited
  data block so every provider benefits without tool-calling support; GitHub
  integration (account, repositories, issues, create issue).
- **Coding mode (Stage D).** Index a project folder into the knowledge store
  (dependency and build directories skipped) and run Explain / Find bugs / Write tests
  / Refactor / Document on a snippet, grounded in the most relevant indexed files.
- **Meetings (Stage D).** Chunked microphone capture, per-chunk transcription with live
  timestamps, local transcript storage, and summary + action-item extraction.
- **Workflows (Stage D).** Named multi-step workflows (`prompt` and `githubIssues`
  steps) with `{{input}}` / `{{prev}}` substitution, four built-ins, custom workflows,
  and per-step progress events. Runs land in a real conversation.
- **Packaging.** electron-builder configuration for Linux (AppImage, deb) and Windows
  (NSIS), generated application icons, and build scripts including unpacked
  `--dir` targets.
- **CI and releases.** Typecheck, unit tests, build and an end-to-end smoke check on
  every push; tagged builds publish Linux and Windows artifacts to a GitHub release.

### Changed

- Panels (agent, knowledge, studio, settings) are code-split and loaded on first open,
  which also defers their data fetching until then.
- Settings now shows a loading state and surfaces load failures instead of rendering
  nothing while it waits.

### Security

- Clients may only ever display Klyro's own renderer: navigation away is refused, web
  links open in the user's browser, webviews cannot attach, and the CSP now uses
  `default-src 'none'` with `object-src`, `base-uri`, `form-action` and `frame-ancestors`
  locked down.
- Permission requests are limited to microphone capture from Klyro's own renderer.

### Accessibility

- Visible focus rings, `prefers-reduced-motion` support, dialog semantics with
  `aria-modal`, labelled icon buttons, tab roles, a live region for the transcript, and
  Escape to dismiss every panel.

## [0.1.0] — 2026-10-18

- Initial shell: Electron + TypeScript + React, streaming chat, searchable local
  history, screen capture with a source picker, voice input and transcription,
  provider/model configuration with keys encrypted at rest, a frameless quick-ask
  overlay (`CommandOrControl+Shift+Space`), and a tray icon.

[0.2.0]: https://github.com/singhaditya73/klyro/releases/tag/v0.2.0
[0.1.0]: https://github.com/singhaditya73/klyro/releases/tag/v0.1.0
