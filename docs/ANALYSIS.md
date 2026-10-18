# Product Analysis — Cluely (independent investigation)

This document records an **independent analysis** of a publicly shipped desktop
application, performed to understand its user-facing capabilities before building
our own implementation. No proprietary source code or assets are copied into Klyro.

## Subject

| Property | Value |
| --- | --- |
| File | `Cluely2.1.24.dmg` |
| SHA-256 | `dbf0066cbe068a7c1de1b92f1e57f2b1b9c97be8b0878f0d3d1f18b5eebbd44a` |
| Bundle id | `com.cluely.app.april22` |
| Version | `2.1.24` |
| Format | UDZO DMG → HFS+ → Electron `.app` (universal) |

## Method

1. DMG inspected with REA (`open_binary` → `inspect_artifact`). Child inventory of
   a DMG requires a native macOS adapter, so the volume was unpacked locally.
2. `7z x` extracted the HFS+ volume and the app bundle.
3. The Electron `app.asar` was parsed with a purpose-built reader (double Chromium
   Pickle header) to inventory 3,266 files.
4. `dist-electron/main.js` (bundled but unminified, 16,954 lines) was mined for
   module structure, endpoints, and API usage.
5. Renderer feature chunks were enumerated by name.

## Recovered architecture (main process)

```
electron/constants.ts
electron/domains/{dock, login, lifecycle, native-audio, session, shortcuts,
                  tray, v1-migration, state, auto-update, deep-link,
                  permissions, screenshot, ipc, menu}.ts
common/ipc.ts            # IPC helper; validates sender-frame origin
electron/utils/log.ts
```

Notable: the app is a **pnpm monorepo**, bundles the renderer with **rolldown/Vite**,
uses **zod** for validation, and validates every IPC sender against a known origin.

## Network surface

- API: `https://api.v2.cluely.com`
- Renderer origin: `https://renderer.v2.cluely.com`
- Marketing/site: `https://v2.cluely.com`
- Updates: `electron-updater` → Cloudflare R2/S3 bucket `cluely-v2-desktop-glass-releases-prod`
- Deep-link scheme: `cluely-v2://`

Server-side logic and models are **not** present in the artifact and cannot be
recovered from it.

## Observed capabilities

| Area | Evidence |
| --- | --- |
| Text chat | `chat-*.js`, main chat bundle |
| Screen capture / sharing | `screenshot.ts`, `desktopCapturer`, screen permission UI |
| Real-time audio + transcription | `native-audio.ts`, `transcription-*.js`, bundled `audiotee`, `sox` (win32/macos), `vad` model, `node-record-lpcm16` |
| Meetings | `meeting-*.js`, bundled sample recording |
| Global hotkey | `shortcuts.ts`, `globalShortcut` |
| Tray / dock / menu | `tray.ts`, `dock.ts`, `menu.ts` |
| Auth / onboarding | `login.ts`, `auth-*.js`, `onboarding-*` |
| Permissions UX | `permissions.ts` (microphone / screen / accessibility) |
| "Undetectable" overlay | `undetectable-demo-*.js` |
| Rich output rendering | KaTeX, Shiki, `streamdown-text`, cytoscape |
| Wallet / paywall | `Web3SolanaWalletButtons-*.js` |
| Auto-update / deep links | `auto-update.ts`, `deep-link.ts` |

## Constraints and conclusions

- macOS builds bundle `audiotee` for system-audio capture; Linux/Windows need
  different capture paths. Native deep-link module ships **darwin-only** prebuilds.
- The recovered module map and endpoints inform our **design only**.
- Klyro is an independent implementation with its own backend/integration model.
