# Klyro

> **Ask anything, without leaving the app.**

Klyro is a cross-platform (Windows / macOS / Linux) **meeting and interview
assistant**. Press one key and an overlay opens on top of whatever you are
doing; ask a question about the screen or the conversation and the answer comes
back in place — invisible to the people you are talking to.

It uses the models and agents **you already have**: OpenCode, the Claude Code
and Codex CLIs, Antigravity, Ollama, or any API key you already hold. No
subscription of ours, no key to paste.

This is an **independent implementation**. No proprietary third-party source code
or assets are used.

## Status

Klyro is production-hardened: autonomous-agent reliability, IPC/security
hardening, local OCR vision fallback, bundled offline Whisper speech recognition,
encrypted secret storage, and verified multi-provider streaming.

See [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) for feature-by-feature
status and supported platforms, and [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## Architecture

```
src/
  main/            Electron main process (Node)
    knowledge/     Pure retrieval: tokenising, chunking, BM25, similarity,
                   code-file rules and template rendering
    domains/       Feature domains: windows, overlay, settings, chat, screens,
                   shortcuts, tray, permissions, conversations, memory, documents,
                   context, calendar, meetings, interviews, integrations, MCP,
                   remote HUD, privacy, usage and storage maintenance
    providers/     Model provider abstraction (OpenAI-compatible, Anthropic,
                   Gemini, Ollama/local)
    store/         Atomic JSON persistence
    util/          Idle-timeout guard for model streams
    security/      Encrypted secret storage (Electron safeStorage) and the
                   renderer origin policy
  preload/         contextBridge API (no Node in the renderer)
  renderer/        React + TypeScript UI
  shared/          Types + IPC contract shared by main/preload/renderer
```

Security posture: `contextIsolation` on, `nodeIntegration` off, sandboxed
renderer, origin-validated IPC, and API keys stored encrypted at rest — never in
the frontend bundle.

Privacy controls live in **Settings → Data & privacy**: per-scope wiping, a
storage breakdown with cleanup, and an opt-in crash-report capture that is
**off by default**. When enabled, redacted crash reports are stored locally
only (you can read and clear them) and are sent nowhere unless an upload
endpoint is explicitly configured (`KLYRO_DIAGNOSTICS_URL`).

## Getting started

```bash
npm install
npm run dev          # launch in development
npm run typecheck    # type-check main + renderer
npm test             # unit tests
npm run build        # production build
npm run smoke        # boot the built app and assert both windows render
npm run pack:linux   # unpacked build in release/linux-unpacked
npm run dist:linux   # AppImage + deb
npm run dist:win     # NSIS installer (must run on Windows)
```

Application icons are generated from the official brand mark by
`npm run icons` (`node scripts/make-icons.mjs`, uses `@resvg/resvg-js`) and
committed, so a release build does not need any system rasterizer.

Tagging a release (`git tag v0.2.1 && git push origin v0.2.1`) runs
`.github/workflows/release.yml`, which builds Linux and Windows artifacts and
attaches them to a GitHub release. Every push runs typecheck, unit tests, the build
and the smoke check.

### AI providers

Klyro is provider-agnostic. Open **Settings → Providers**, choose a provider,
paste your API key (stored encrypted locally), and pick a model:

- **OpenAI-compatible** (OpenAI, Azure, OpenRouter, LM Studio, …)
- **Anthropic** (Claude)
- **Google Gemini**
- **Local** (Ollama at `http://localhost:11434`) — no cloud key required

### Local coding agents

Klyro can use coding agents you already have — **OpenCode**, **Claude Code**,
**Codex** and **Antigravity** — through their own sign-in. Each one appears in
**Models & agents** with the state it reports, and the overlay's model chip can
switch to it without leaving the current question. Klyro does not drive the
mouse or keyboard on your behalf.

## Memory & knowledge

Klyro grounds answers in things you tell it and documents you give it — all
stored locally, never uploaded except as part of the prompt you send.

- **Memory** — open **Knowledge → Memory** to save facts, tag and pin them. Before
  each turn the most relevant memories are retrieved (BM25) and added to the
  prompt; near-duplicates are suppressed automatically. Enable *Learn durable
  facts from conversations* in Settings to have Klyro distil memories for you.
- **Documents** — **Knowledge → Documents → Add documents…** imports text,
  Markdown, code, CSV/JSON, HTML, and PDF/Office files. PDFs need `pdftotext`
  (poppler-utils) and Office files need `unzip`; Klyro says which file it skipped
  and why. Relevant excerpts are retrieved and cited in the prompt.
- **Search everything** — one box ranks across memories and document chunks.
- **Integrations** — connect **GitHub** with a personal access token (stored
  encrypted) to see your repositories and issues, or file an issue without
  leaving Klyro. *Test connection* runs a live credential check and shows the
  result without ever exposing the token.

## Meetings & interviews

**Meetings** — record from the microphone or the meeting's own audio; the
transcript is written and timestamped as you go, saved locally, and mirrored to
the Ghost Phone HUD. *Summarize* produces a short summary plus extracted action
items, and a recap is written automatically when recording stops.
- **Action-Item Pulse** — real-time HUD detection of first-person commitments,
  second-person requests, and key decisions with instant deadline parsing and
  1-click capture to notes.
- **Agenda Tracker** — automatic extraction of discussion points from calendar
  invitations with live transcript keyword matching and progress indicators.
- **1-Click Export to Notion & Linear** — push synthesized meeting notes, action
  items, decisions, and follow-ups directly to Notion pages or Linear issues,
  alongside Slack and CRM webhooks.
- **Quiet presence** — during active recording, Klyro automatically silences its
  own audio output, clears dock and taskbar notification badges, and suppresses
  window attention flashes to prevent audio or visual leaks into meeting streams.
- **Ghost Phone HUD** — stream live transcripts and answers to your phone or
  tablet for a zero on-screen footprint. Secured via local QR code or one-time
  six-digit pairing code with bearer token authentication (no secrets in URLs).

**Interviews** — every question and answer is kept in a session you can revisit,
with a summary, notes, bookmarks and an optional CRM/MEDDPIC breakdown.

## Updates

Klyro checks the GitHub release page once per launch, fifteen seconds after the
HUD so the check never delays an answer. It tells you what it found; it
downloads only when you click **Download** and installs only when you click
**Restart now**. A downloaded version also installs on the next quit.

The AppImage and the Windows installer update in place. A `.deb` does not — the
package manager owns those files — so that build points at the releases page
instead of pretending it can replace itself. The check is skipped while Airgap
Shield is on, because it is a request to GitHub, and it can be turned off in
Settings → Usage & Diagnostics.

## Accessibility

Panels behave like dialogs (focus moves in, Escape closes them), icon-only buttons
carry labels, tabs expose `aria-selected`, the transcript is a live region, focus is
always visible, and `prefers-reduced-motion` is respected.

## Security

`contextIsolation` on, `nodeIntegration` off, sandboxed renderer, origin-validated
IPC, API keys and integration tokens encrypted at rest, and a strict production CSP
(`default-src 'none'` with `object-src`, `base-uri`, `form-action` and
`frame-ancestors` disabled).

A window may only ever display Klyro's own renderer: navigation elsewhere is
refused, web links open in your browser, webviews cannot attach, and the permission
policy grants microphone capture to Klyro's origin and nothing else.

Screen capture protection uses native OS window exclusion (`WDA_EXCLUDEFROMCAPTURE`
on Windows and window-sharing exclusion on macOS). The built-in Privacy Check
measures both whole-display and single-window capture paths via pixel-by-pixel
comparison to verify exclusion rather than assuming it.

## License

MIT © 2026 Aditya Singh
