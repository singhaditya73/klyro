# Changelog

All notable changes to Klyro are recorded here. Versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Fixed
- **Provider errors named the wrong provider.** The OpenAI-compatible adapter
  is shared by three Settings slots (OpenAI, Groq, OpenAI-compatible
  endpoint), but it hardcoded "openai" — so a Groq that could not be reached
  was reported as *"Could not reach OpenAI"*, sending the user to the wrong
  Settings card. Each slot now carries its own identity into every error.
- **Network failures showed "fetch failed" and nothing else.** `fetch` wraps
  the real reason (DNS failure, refused connection, rejected certificate) in a
  generic message that Klyro threw away. The reason is now shown, and the
  message names the endpoint that was contacted:
  *"Could not reach Groq at api.groq.com. … getaddrinfo ENOTFOUND
  api.groq.com"*.
- **Answers from a local OpenCode server were cut off.** The server lists a
  session newest first and splits one turn across several messages — a
  progress line, a tool call, then the answer. Klyro read the wrong end of
  that list, so a reply stopped at its first sentence, or came out empty when
  the first message held only a tool call. The whole turn is now read, in
  order, and the answer ends when the server says the turn is done.

## [0.9.6] — 2026-10-21

The picture reaches the model.

### Fixed
- **An attached image never made it to the model.** OpenCode, Claude Code and
  Codex all had a way to carry a picture — the server took it, the CLI took it,
  the CLI took a file — but Klyro sent the text only, so the model answered as
  if the screen were blank. Now:
  - **OpenCode** sends the picture with the question (as a file whose uri is
    the image itself). Verified live against a real server: the model read a
    test picture and answered "Red" for the red half.
  - **Claude Code** reads the picture from stdin as part of the message.
  - **Codex** gets the picture as a file, the way `codex exec --image` takes
    one.
- **Antigravity now says so instead of dropping the picture in silence.** Its
  model call is a prompt and a model id — there is nowhere to put an image —
  so the answer now opens with a clear note that the model saw only the text.
  A picture that vanishes without a word is worse than one that is refused.
- **A picture in your own message sat on the opposite side from your words.**
  Your words are aligned to the right; the picture was aligned to the left, so
  the two looked like separate messages. They are on the same side now.

## [0.9.5] — 2026-10-21

The question leaves the box the moment you press Send.

### Fixed
- **Your question stayed in the input box while the model was answering.**
  The composer cleared the field only after the whole answer had arrived, so
  the text you had just sent was on screen twice: once in the conversation
  and once in the box. The box is emptied the moment you press Send now; the
  question is already in the conversation, and the answer streams in below.
  If the question could not be sent at all, the text comes back.
- The same in the Knowledge panel: asking a document emptied the field only
  once the answer was done.

## [0.9.4] — 2026-10-21

Pick the model you want — in every provider.

### Added
- **A model picker for every provider.** Settings → Providers now has a real
  dropdown per provider instead of a text field, and it is filled from the
  provider itself: Antigravity's catalogue (with the remaining quota on each
  entry), the OpenCode server's models, Ollama's tags, the `/models` endpoint
  of OpenAI, Anthropic, Gemini, Groq and any OpenAI-compatible server, and the
  model ids the Claude Code and Codex CLIs accept. A model that is not
  advertised can still be typed in.
- **A model picker in the chat composer**, so you can switch model per
  question without going to Settings — the chip next to the Send button.
- **A model picker in the quick-ask overlay**, for the fast model it answers
  with.
- The Antigravity card in Integrations now lists its models as buttons: press
  the one you want and Klyro uses that model from then on.
- When a provider cannot be asked for its models, the picker says why — a
  rejected key, a missing key, a server that is not running — instead of
  showing an empty list.

### Fixed
- A slow answer from a provider you have already switched away from could
  replace the newer list with the old one. The picker now drops a late answer
  that no longer belongs to the provider on screen.

## [0.9.3] — 2026-10-21

Antigravity without the IDE: connect once, use it any day.

### Added
- **Antigravity, connected** — Integrations → Antigravity → *Connect* takes a
  snapshot of your Antigravity account session while the IDE is open. From
  then on Klyro starts Antigravity's own agent service itself and uses its
  models (Claude Opus 4.6, Sonnet 4.6, Gemini 3.5) **with the IDE never
  opened**. No API key, no copy-paste.
  - The session is stored in `~/.config/klyro/antigravity-session.json` (mode
    600) and can be removed again with *Disconnect*.
  - Verified live end to end with the Antigravity IDE fully closed: Pro plan,
    the account, 19 models, and a question answered by Claude Opus 4.6.
- The saved session is refreshed by the agent service itself, so it keeps
  working after the access token expires.

### Fixed
- Antigravity model calls went to `cloudcode-pa.googleapis.com`, which answers
  `429 RESOURCE_EXHAUSTED` even for an entitled account. The service now uses
  the same `daily-cloudcode-pa.googleapis.com` host the IDE uses.

## [0.2.2] — 2026-10-19

Groq first-class support plus provider-UX and workflow fixes.

### Added
- **Groq provider** with its own Settings card (label, encrypted key storage,
  connection test, editable model/base URL). Default model is the current
  production `openai/gpt-oss-120b`; speech-to-text uses `whisper-large-v3`.

### Fixed
- Provider "Test connection" spinner never stopped after a result: pending
  state and result state were the same field. Results now render as a proper
  success/error notice and the button re-enables.
- Saving an API key gave no visible confirmation (the draft is intentionally
  never read back). Cards now show an explicit "Key saved in the encrypted
  secret store" confirmation plus the persistent "Key saved" pill, disable
  "Save key" while the draft is empty, and explain the not-yet-saved state.
- A dead model name now says what to type instead: on a 404 the adapter asks
  the endpoint's own `/models` and appends the actually-available ids to the
  error ("Available models here: …").
- Speech-to-text sent `whisper-1` unconditionally; each compatible provider
  now carries the id it really serves (Groq needs `whisper-large-v3`), and
  Groq is accepted as a transcription provider.
- Clicking "New chat" while already on an empty conversation reused to pile
  up empty sessions; it now stays in the current fresh chat.
- Workspaces with reduced-width content columns (Workflows, Screen,
  Integrations) left dead space hugging the left edge on wide windows; the
  content column is centered now.

## [0.2.1] — 2026-10-19

Post-0.2.0 engineering completion program (details in `docs/ENGINEERING_CHECKLIST.md`)
and a full UI/UX polish pass.

### Fixed

- Sidebar panels (Agent, Memory, Settings) did not open after the redesign:
  panel opening now closes other panels first instead of open-then-close, the
  lazy Agent/Knowledge panels render at their single overlay site with a
  Suspense boundary, and raw `\uXXXX` escapes in JSX text render their real
  glyphs. Verified by a scripted click-through of every sidebar item in the
  running app.
- Chat empty-state logo loaded from a runtime URL that resolves in neither the
  renderer dev server nor the packaged app; it now imports the bundled mark
  (inlined by Vite) with a graceful fallback, and its dead "New chat" button
  actually starts a conversation.
- The collapsed sidebar referenced a size (64px) but the Workspaces navigation
  and Settings were wrapped in expanded-only blocks, so collapsing removed all
  navigation; collapsed mode is now a proper icon rail with title tooltips and
  aria-labels. The collapse/expand control itself was wired but never rendered.
- Home's composer was a second, divergent copy of the chat composer (text "X"
  remove button, inconsistent padding, late file-bottom import); it now reuses
  the shared `Composer` component with a hero variant and navigates to Chat on
  send, where the answer streams.
- Screen Assistant's Ask action streamed its answer into the Chat workspace
  without telling the user (the "Answer" section could never render); it now
  confirms and offers a direct link, and keeps the capture for follow-ups.
- Unstyled leftover classes still referenced by components (`.code-out`,
  `.provider__key/`, `.provider__actions`) now have shared definitions.
- Sidebar no longer clips its Settings footer on short windows: the chats list
  and the workspace rail shrink and scroll instead of overflowing.

### Added

- **Common integration contract (G1)** — one client shape (descriptor, cheap
  status, `selfTest()`) plus a registry; GitHub implements it with a live
  credential check, exposed as a "Test connection" button in the Integrations
  view.
- Design-system consolidation: motion duration/easing tokens, elevated-surface
  and overlay tokens, disabled/placeholder text tokens, `.section-label`,
  `.quick-action`, `.composer__hint`, standardized workspace-header pattern,
  and a subtle keyed workspace transition. Legible disabled states; message
  copy affordance appears on hover/focus without layout shift.
- Dialog accessibility: focus returns to the invoking control when a panel
  closes (close button, Escape, or opening another panel).
- Two-step destructive confirmation for "Clear all" (memories/documents) and
  sidebar chat deletion — nothing destructive executes on a single click.
- GitHub token form: show/hide toggle, honest connecting state, connection
  state pill; planned integrations marked "Planned · OAuth" with no fake
  connect buttons.
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
