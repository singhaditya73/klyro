# Klyro — Complete Project Report

**What it is, what it does, how it works, and what is real**

| | |
|---|---|
| **Project** | Klyro |
| **Version** | `0.9.24` |
| **License** | MIT © 2026 Aditya Singh |
| **Commit examined** | `9cdd3f0 fix(package-check): optional dependencies may be absent` |
| **Report date** | 2026-11-05 |
| **Stack** | Electron 44 · React 19 · TypeScript 5.9 · Vite 8 / electron-vite 6 · Rust 1.75 · Tokio · `whisper-rs` |
| **Source size** | ~30,185 lines of TypeScript/TSX tracked in `src/`; ~2,566 lines of hand-written Rust in `crates/klyro-core/src` |
| **Tests** | 64 TypeScript test files (63 passed, 1 skipped); 402 tests (394 passed, 8 skipped); 21 Rust tests passed |
| **Working tree** | 28 modified tracked files, 10 untracked source files — documented separately in §5 |

> **How to read this report**
>
> - **“Committed”** means it exists in `HEAD` (`9cdd3f0`, the 0.9.24 release line).
> - **“Working tree / WIP”** means it exists only as uncommitted or untracked code on this machine. It compiles and is type-checked, but it is not part of a release.
> - **“Not implemented”** means documentation claims it, but no working code path exists.
> - Product claims are separated from verified behaviour throughout.

---

## 1. Executive summary

Klyro is a **local-first, bring-your-own-key (BYOK) meeting and interview assistant** for Windows, Linux, and (at the code level) macOS. Its primary surface is a frameless always-on-top overlay opened with a global hotkey. The overlay can:

- answer typed questions while streaming tokens,
- listen to a meeting through the microphone and/or system audio,
- transcribe locally with a bundled Whisper model,
- capture the screen and either send the image to a vision model or run local OCR and send extracted text,
- answer spoken questions in a couple of seconds,
- keep a searchable local knowledge base of notes and documents,
- record interviews and meetings, then generate structured CRM notes,
- stay out of screen shares on Windows and macOS.

Behind the overlay is an Electron control panel with seven routes: **Home, Models & Agents, Knowledge, Meetings & Interviews, Integrations & MCP, Settings, Privacy & Data**.

Technically, Klyro is two runtimes:

1. **Electron main process** — owns windows, IPC, storage, provider HTTP calls, OCR, calendar, integrations, and most feature domains.
2. **`klyro-core`, a small Rust daemon** — owns the overlay’s hot path: provider streaming and local Whisper transcription over a loopback JSON-lines protocol with a per-run token. The app still answers if the daemon is unavailable.

The product is genuinely broad and unusually complete for a solo/indie Electron app: 10 provider integrations, a working offline STT/OCR stack, encrypted credentials, retention controls, ephemeral sessions, an audit log, and a real test suite. It is also a product with a strong **stealth/anti-observation theme** — window capture exclusion, click-through ghost mode, a “panic” killswitch, a Notepad decoy, a remote phone HUD, and a typing simulator explicitly designed to defeat paste detection. That theme creates the most important security, ethical, and legal risks in the project, covered in §22.

The largest documentation problem is that **`README.md` and `docs/FEATURE_MATRIX.md` describe a different, older product**: a desktop agent, workflows, a code/Studio mode, GitHub integration, and a general chat workspace that do not exist in the code. Conversely, the current UI has a Meetings & Interviews surface and an Integrations & MCP page that the feature matrix still lists as “deliberately not here.” Details are in §23.

---

## 2. What Klyro is — and what it is not

### 2.1 Product positioning

The README calls Klyro “a cross-platform meeting and interview assistant” whose promise is: *press one key, ask about the screen or the conversation, get an answer in place, invisible to the people you are talking to.* The installer metadata goes further: *“Your AI. Your entire computer.”*

Those two statements describe different products. The **implemented** product is the first one, plus a local knowledge base and post-meeting note generation. The “entire computer” framing belongs to the removed/unfinished desktop-agent vision.

### 2.2 What it actually is

- A **quick-ask overlay** for live meetings, interviews, sales calls, and screen-based work.
- A **local knowledge assistant** over notes, memories, and imported documents.
- A **meeting recorder and note generator** with CRM-style output.
- A **multi-provider model client** that can use cloud APIs, local Ollama, or local coding agents.
- A **privacy-oriented desktop utility** with capture exclusion, local transcription, and local storage.

### 2.3 What it is not (despite documentation)

- Not a desktop-automation agent. There is no working click/type agent loop, no agent history, no approval flow in the current tree.
- Not a workflow engine. The `Workflow*` types survive in `src/shared/types.ts`, but no workflow domain, IPC handler, or UI exists.
- Not a coding/Studio product. There is no project indexer, code-action UI, or diff review feature.
- Not a GitHub client. There is no GitHub API call anywhere; only a GitHub MCP server *definition* exists, and MCP itself is not implemented.
- Not an MCP client. `@modelcontextprotocol/sdk` is a dependency and the UI stores server definitions, but Klyro never starts or calls an MCP server. The code says so explicitly in `src/main/domains/integrations.ts`.
- Not a shipped macOS release. The code has macOS branches, but `electron-builder.yml` marks macOS as “not a supported release target yet.”

---

## 3. Status and verification

The following was run against the working tree on 2026-11-05:

| Check | Command | Result |
|---|---|---|
| TypeScript typecheck (main + preload) | `npm run typecheck:node` | pass |
| TypeScript typecheck (renderer) | `npm run typecheck:web` | pass |
| Combined typecheck | `npm run typecheck` | **pass, exit 0** |
| Vitest | `npm test -- --reporter=dot` | **63 passed / 1 skipped test files; 394 passed / 8 skipped tests** |
| Rust tests | `cargo test` in `crates/klyro-core` | **21 passed, 0 failed** |
| Build config | `electron-vite` + `electron-builder.yml` | present and detailed |
| CI | `.github/workflows/ci.yml` | typecheck → tests → build → Xvfb smoke |
| Release | `.github/workflows/release.yml` | Linux + Windows artifacts, package check |

The working tree is not a clean release tag: it contains 2,347 added lines across 28 modified tracked files and 1,973 lines across 10 untracked files. Typecheck and tests pass with those changes included, but no release has been cut from them.

---

## 4. Feature inventory — committed product

This section describes features present in `HEAD` (the 0.9.24 line).

### 4.1 The overlay (primary surface)

| Feature | Behaviour | Where |
|---|---|---|
| Global hotkey | Default `Ctrl/Cmd+Shift+Space`; configurable; registered globally | `domains/shortcuts.ts` |
| Always-on-top frameless window | 640 px default width, 208 px default height, 150–520 px content-driven height, 20–100% opacity | `domains/windows.ts` |
| Streaming answers | Token deltas streamed over IPC as `chat:stream` events | `domains/chat.ts`, `preload/index.ts` |
| Model picker | Lists models from every connected provider, searchable, grouped by provider; switching persists | `components/ModelPicker.tsx` |
| Response style | Concise / balanced / detailed appended to the system prompt | `domains/chat.ts` |
| Conversation history | Stored locally; bounded context of 40 turns and 4 images per request | `domains/conversations.ts` |
| Instant replay | Same question + same screenshot hash returns a cached answer, labelled as replay | `domains/answer-cache.ts` |
| Copy / retry / stop | Per-answer controls; abort propagates to provider stream | `OverlayApp.tsx`, `domains/chat.ts` |
| Content-sized overlay | Renderer reports needed height; main clamps and animates | `window:resize` / `overlay:resize` |
| Drag handles | Explicit drag regions; width remembered | `domains/windows.ts` |
| Session Q&A history | In-overlay history of questions and answers | `OverlayApp.tsx` |
| Audio feedback glow | Visual level feedback while recording/listening | `OverlayApp.tsx`, `styles.css` |
| “Catch Me Up” | Summarises the recent meeting transcript on demand | committed in `b2e685d` |
| “Objection Helper” | Takes the latest attendee statement and asks for diplomatic rebuttals | committed in `b2e685d` |
| Meeting scratchpad | Private notes saved into the interview session on stop | committed in `b2e685d` |
| Private mode | Excludes overlay from captures on Windows/macOS; stays visible when focus moves | `domains/windows.ts` |
| Screen selection | Choose primary or a numbered display for the overlay | `domains/windows.ts` |

The overlay uses a dedicated renderer entry (`src/renderer/index.html`) with a hash route and a second `BrowserWindow`; it is not a separate app binary.

### 4.2 Voice and listening

| Feature | Behaviour |
|---|---|
| **Listen mode** | Records short slices, watches room level, ends an utterance after ~700 ms of silence, transcribes only that utterance, and answers only if it looks like a question. |
| **Talk mode** | Microphone stays open; voice activity detection starts/ends the user’s utterance; speaking again interrupts the answer. |
| **Record question** | Press once to start, once to stop; transcribes and answers. |
| **Meeting recording** | Records microphone (or system audio where available), builds a timestamped transcript, and saves it to a local session. |
| **Question heuristic** | `looksLikeQuestion()` checks for `?` or interrogative cues near the end of the chunk; the model also returns `—` when there is nothing to answer. |
| **Hardware DSP** | Echo cancellation, noise suppression, auto gain, mono, 16 kHz constraints. |
| **Provider STT first** | If the active provider has a transcription adapter and credentials, that is tried first. |
| **Local Whisper fallback** | Bundled `ggml-tiny.en-q5_1.bin` (~31 MB) via `klyro-core`; no key, no network. |
| **Prewarm** | Whisper model preloaded at launch; audio pipeline prewarms on voice. |

The local model is English-only (`tiny.en`), which is an important limitation for non-English meetings.

### 4.3 Screen, vision, and OCR

- **Instant capture** hides Klyro for the shot, captures the selected display, and attaches the image to the next question.
- **Source picker** is available when instant capture is off.
- **Vision routing** uses per-provider/model patterns to decide whether an image can be sent. Models known to be text-only are not sent images.
- **Local OCR fallback** runs RapidOCR (PP-OCRv6 ONNX) fully offline. If the provider cannot carry an image, Klyro extracts text from the screenshot and appends it to the prompt as `[Screen Content (via Local OCR)]`.
- **Honest failure**: if no text is found and the provider cannot carry an image, the overlay says so rather than silently answering as if the screen were blank.
- **Privacy check** takes two real captures and compares pixels to measure whether the overlay is actually excluded; it does not merely assert exclusion.

Bundled OCR models: `PP-OCRv6_det_small.onnx`, `PP-OCRv6_rec_small.onnx`, classifier, and dictionary under `resources/models/ocr/`.

### 4.4 Providers and agents

Ten provider slots, one interface:

| Provider | Transport | Key required | Notes |
|---|---|---|---|
| OpenAI | OpenAI Chat Completions | yes | default `gpt-4o-mini`; Whisper STT |
| Anthropic | Anthropic Messages API | yes | default `claude-3-5-sonnet-latest` |
| Google Gemini | Gemini API | yes | default `gemini-2.0-flash` |
| Groq | OpenAI-compatible | yes | default `openai/gpt-oss-120b`; fast STT |
| Ollama | Local HTTP | no | default `http://localhost:11434`, `llama3.1` |
| OpenAI-compatible | OpenAI shape | usually | LM Studio, OpenRouter, Azure, vLLM, etc. |
| OpenCode | Local OpenCode server/session API | optional | connects to `opencode serve`, default `127.0.0.1:4096` |
| Claude Code | Local CLI | no | uses the user’s Claude subscription |
| Codex | Local CLI | no | uses the user’s Codex login |
| Antigravity | Local Connect-RPC service | no | starts the IDE’s agent service directly |

Notable provider internals:

- Groq, OpenAI, and custom endpoints share one OpenAI-shaped implementation but keep separate identities, so an error says “Groq,” not “OpenAI.”
- Vision support is resolved by regex patterns per provider/model, with `unknown` used honestly for local/custom endpoints.
- Antigravity cannot carry an image at the transport layer; Klyro reports that instead of dropping the image silently.
- OpenCode has a fairly deep client (`providers/opencode.ts`, 668 lines) including session creation, model discovery, and an answer check that asks a free model a one-word question.
- Local agent binaries are discovered and launched by `domains/local-agent-launcher.ts` and `domains/local-agents.ts`.

### 4.5 Control panel

The control panel is a React SPA with hash routing (`#/models`, etc.) and seven destinations:

| Route | Purpose |
|---|---|
| **Home** | Dashboard: open overlay, active model and whether it answers, connected providers, knowledge counts, recent sessions. |
| **Models & Agents** | Connect hosted providers, local servers, and coding agents; pick models; test connections. |
| **Knowledge** | Memory, documents, and unified search. |
| **Meetings & Interviews** | Session history, transcripts, Q&A, summaries, CRM notes, exports. |
| **Integrations & MCP** | Slack/CRM webhooks, calendar feed (WIP), MCP server definitions. |
| **Settings** | Providers, assistant behaviour, desktop, history, usage, diagnostics. |
| **Privacy & Data** | What is stored, where answers go, retention, capture check, clearing data. |

The shell is responsive: on narrow windows the sidebar becomes a drawer. Themes are system/dark/light and propagate to all windows through `settings:changed`.

### 4.6 Knowledge, memory, and documents

| Feature | Behaviour |
|---|---|
| **Memory** | Facts saved manually or extracted from conversations (opt-in). Retrieved per turn with BM25; near-duplicates suppressed with Jaccard similarity. |
| **Documents** | Imports text, Markdown, code, CSV, JSON, HTML, PDF (via `pdftotext`), and Office files (via `unzip`). Unsupported files are reported with a reason. |
| **Chunking** | Paragraph/sentence-aware chunks (~1,200 chars, 150-char overlap) with real character offsets and line numbers. |
| **Retrieval** | Okapi BM25 over an in-memory corpus; top memories and document chunks formatted into a system-prompt block. |
| **Citations** | Chunks carry source location metadata so answers can point at real files/lines. |
| **Search** | One box ranks across memories and document chunks. |
| **Prompt-injection defence** | Retrieved content is wrapped as untrusted data with delimiters and labels. |

The knowledge context block is capped at 8,000 characters and cached for 60 seconds. There is also a speculative prefetch that builds the context while the user is still speaking.

### 4.7 Meetings, interviews, and CRM notes

This is the most feature-dense part of the committed product.

**Session model.** An `InterviewSession` contains company, role, timestamps, duration, questions, transcript lines, answers, notes, summary, tags, bookmark state, context notes, and an `ephemeral` flag.

**Ephemeral sessions.** When enabled (per session or by default), nothing is written to disk: not the session, not the conversation, not the answer cache, not the memory extractor. A “Keep this one” action writes it deliberately. This is a genuinely strong privacy design.

**Retention.** One policy covers interview transcripts, chat history, and the audit log: 7/30/90/365 days or “until deleted.” Pruning runs at startup and when the setting changes. The usage ledger stores counts only.

**Meeting notes.** `domains/meeting-notes.ts` builds a structured synthesis prompt with templates:

- Client / Sales Call
- Team / Engineering Sync
- Interview
- 1-on-1 Check-in
- General Meeting
- MEDDPIC (enterprise deal qualification)

Output includes an executive summary, action items with owners/deadlines/categories, key decisions, customer/commercial insights (pain, budget, timeline, objections, next steps), and a follow-up email draft.

**Talk ratio.** `computeTalkRatio()` calculates per-speaker word counts and percentages from `[Speaker]: text` transcript lines, adds the user’s typed questions, and produces a pacing note. It has a fallback estimate when transcripts are not speaker-tagged.

**Exports.** Slack-formatted recap, Markdown export, and copy-to-email. Action items can be checked off in the session view.

**Meeting type detection.** `MeetingType` includes `client_call`, `internal_sync`, `interview`, `one_on_one`, `general`, `meddpic`. The UI selects a template.

### 4.8 Integrations

- **Slack webhook** — send a recap or message to a configured incoming webhook.
- **CRM webhook** — POST structured JSON to HubSpot-style or generic endpoints.
- **MCP server definitions** — add/remove/toggle/test; three defaults (Slack, GitHub, Filesystem); four presets in the UI (Slack, GitHub, Google Drive, Postgres).
- **Secrets** — webhook URLs, Notion token, and Linear key are stored in the encrypted secret store, never in `integrations.json`.
- **Reality check**: the MCP “test” only checks that the command exists on `PATH`. It does not start the server, list tools, or call anything. The code and the 0.9.24 changelog both state this.

### 4.9 Privacy, security, and data controls

- **OS-encrypted secrets** via Electron `safeStorage` (Keychain / DPAPI / libsecret). Plaintext is refused unless the user explicitly opts in.
- **Context isolation on, Node integration off, sandboxed renderer**, origin-validated IPC, strict production CSP.
- **Navigation lockdown**: only Klyro’s own renderer may load; external links open in the browser; webviews blocked; only microphone/audio capture permission granted.
- **Diagnostics off by default**, local only, no upload unless `KLYRO_DIAGNOSTICS_URL` is set.
- **Per-scope data clearing**: conversations, memory, documents, meetings/interviews.
- **Storage report** and cleanup.
- **Audit log**: append-only local record of actions; exportable as JSON; never sent anywhere.
- **Usage ledger**: per-provider request counts; WIP adds tokens and estimated spend.

### 4.10 Answer pipeline (committed behaviour)

A `chat:send` request goes through:

1. Load settings and active provider.
2. Resolve or create the conversation; if the session is ephemeral, substitute an in-memory stand-in.
3. Append the user message and an empty assistant message.
4. Register the abort controller.
5. Emit `start`.
6. Build bounded turns (last 40 messages, last 4 images).
7. Classify the question (`technical` / `behavioral` / `project` / `general`) and select answer advice.
8. Build the system prompt: base prompt + response style + interview/session context + knowledge block.
9. If the provider cannot carry an image, run OCR and append extracted text.
10. If fast mode and the answer cache has an identical question + screenshot hash, replay it.
11. If fast mode and the provider is daemon-capable, try `klyro-core` first.
12. Otherwise stream from the provider adapter, with idle-timeout protection.
13. Update the assistant message, emit `done`, record usage and audit, and add the exchange to session history.
14. On failure, emit a classified `error` with provider-specific advice.

---

## 5. Work in progress — uncommitted and untracked code

Everything below exists in the working tree but **not** in `HEAD`. It type-checks and is partly tested, but it is unreleased and should be treated as experimental.

### 5.1 Calendar sync and automatic meeting detection

**Files:** `src/main/domains/calendar.ts` (601 lines, untracked), `calendar.test.ts`, new IPC channels, new types, Integrations UI card, overlay prompt.

- Parses RFC 5545 iCalendar (line unfolding, escaped text, UTC/local/all-day dates, attendees, organizer, status, meeting URLs).
- Extracts company names from titles (`Acme x Klyro`, `Demo with Acme`, `Acme Sync`) and from non-public attendee email domains.
- Syncs an ICS feed over HTTPS (10 s timeout), keeps events from yesterday to +14 days, caches them in `calendar.json`.
- Detects active Zoom / Google Meet / Teams / Webex / Slack Huddle windows through `desktopCapturer` window titles.
- Prompts the user for a meeting starting within 5 minutes or currently in progress.
- Dismissal list is bounded to 50 entries.
- Feeds attendee names into the diarizer when a meeting starts.

**Status:** functional, tested (calendar tests), wired end to end. Privacy note: the ICS URL is stored in `calendar.json` in plaintext, not in the encrypted secret store. Calendar feeds are often private bearer URLs.

### 5.2 Dual-channel meeting audio mixer

**File:** `src/renderer/src/lib/audio-mixer.ts` (253 lines, untracked).

- Captures microphone + system loopback and mixes them with the Web Audio API.
- Windows: `getDisplayMedia({ video: true, audio: true })`, discards video.
- Linux: enumerates input devices and looks for a PulseAudio/PipeWire `Monitor of …` source.
- macOS: no loopback path; degrades to microphone.
- Exposes per-channel RMS energy and system FFT data for diarization.
- Falls back to microphone-only without interrupting recording.

**Status:** implemented and unit-tested; platform behaviour depends on OS loopback support. The macOS fallback means “hears the meeting” is really “hears the room” on macOS.

### 5.3 Speaker diarization

**File:** `src/renderer/src/lib/diarization.ts` (285 lines, untracked).

- Anchors the local microphone channel as “You.”
- Clusters system-audio speakers using an 8-band spectral vector and cosine similarity (threshold 0.82).
- Maps clusters to calendar attendee names; adapts names from self-introductions.
- Tracks words and speaking time per speaker.
- Feeds `MeetingTalkRatio.speakers` and CRM notes.

**Status:** heuristic, not ML-based. It separates “you” from “attendees” reliably via physical channels, but distinguishing 3+ attendees by spectral centroid is best-effort and will confuse similar voices. Marketing it as “real-time diarization” would overstate it.

### 5.4 Hybrid vector retrieval

**Files:** `src/main/knowledge/vector-index.ts` (259 lines, untracked), changes to `retrieval.ts`.

- 64-dimensional “dense” embedding built from a hand-curated concept-cluster table plus deterministic hash projection for out-of-vocabulary words.
- Int8 quantization, cosine similarity, LRU cache of 5,000 chunk vectors.
- Reciprocal Rank Fusion (RRF, k = 60) combines BM25 and vector ranks; optional weights.
- A “cross-attentive reranker” boosts exact bigrams and full-query containment.

**Status:** the code calls this “semantic dense embedding,” but it is **not** a neural embedding. It is a hand-built concept projection with hashed features. It will improve synonym recall for the ~200 curated words and behave like a fuzzy lexical index otherwise. The name and comments overstate the technique; see §22.

### 5.5 RSVP speed reader

**File:** `src/renderer/src/components/RsvpReader.tsx` (137 lines, untracked).

- Displays answers one word (or short phrase) at a time at a configurable words-per-minute rate.
- Opens from the overlay; Escape closes it.

**Status:** UI feature; no persistence or analytics.

### 5.6 Humanized typing

**File:** `src/main/domains/humanizer.ts` (115 lines, untracked).

- Hides the overlay, then types text into the previously focused window.
- Linux: `xdotool type --delay`.
- Windows: PowerShell + `System.Windows.Forms.SendKeys` with random per-character delay.
- macOS: AppleScript `keystroke` with delay.
- Falls back to clipboard staging if the tool is missing.
- The comment explicitly says it bypasses “anti-paste / zero-millisecond copy-paste detection on test platforms.”

**Status:** implemented, but this is the most ethically and legally fraught feature in the tree. It is a mechanism for making machine-generated text appear human-authored in environments that explicitly try to detect that. See §22.

### 5.7 Ghost Phone remote HUD

**File:** `src/main/domains/remote-hud.ts` (323 lines, untracked).

- Starts an HTTP server on port 5892, bound to `0.0.0.0`.
- Serves a mobile HTML page plus `/events` SSE stream and `/api/status`.
- Mirrors the live question, streaming answer, and last 30 transcript lines to a phone.
- **No authentication, no origin check, `Access-Control-Allow-Origin: *`.**
- Anyone on the same LAN can read the live meeting transcript and answers by visiting `http://<host-ip>:5892`.

**Status:** functional and useful on a trusted network, but this is a serious security defect as written. See §22.

### 5.8 Ghost mode, zero-focus, panic killswitch, decoy, notch teleprompter

**Files:** `windows.ts`, `shortcuts.ts`, `ipc.ts`, `OverlayApp.tsx`, `styles.css`.

| Feature | Effect | State |
|---|---|---|
| **Ghost mode** | `setIgnoreMouseEvents(true, { forward: true })` + opacity 0.22; clicks pass through to the app underneath. Toggle via `Ctrl+Shift+G` if configured, or overlay button. | WIP, not persisted in settings |
| **Zero-focus mode** | `setFocusable(false)` and `showInactive()` so the overlay never steals focus from a browser or test window. | WIP, not persisted |
| **Panic killswitch** | Double-Escape in overlay or configured shortcut hides overlay + control panel, aborts active chat, clears the overlay. | WIP |
| **Decoy Notepad** | Renders a fake “Meeting_Notes - Notepad” window over the overlay; click or Escape restores. | WIP |
| **Notch teleprompter** | Snaps the overlay to the top-center of the work area, under the webcam, and switches to a prompter layout. | WIP |
| **Capture-border bypass** | Chromium flags disable `DrawBorderOnScreenCapture`, `ScreenCaptureBorder`, `CaptureBorder`. | WIP, ethically significant |

`ghostShortcut` is honored by `shortcutBindings()` if present in settings, but it is **not in `AppSettings` and has no UI**, so no user can configure it through the app today.

### 5.9 Two-second fast-provider fallback

**File:** `domains/chat.ts` (uncommitted changes), `types.ts`.

- For fast overlay queries, starts a 2,000 ms first-token timer.
- If the primary provider has not produced a token, aborts it and retries on the first available fallback in this order: **Groq → Gemini → OpenAI → Ollama**.
- On primary error before any token, also falls back.
- Emits `fallback: { from, to, reason }` on the `done` event.

**Status:** implemented and tested. **Privacy risk:** the fallback route is chosen by key availability, not by the user’s current provider choice. A user on Anthropic with a Groq key can have their prompt and screenshot sent to Groq without an explicit per-request choice. The UI displays fallback info after the fact, not before.

### 5.10 Speculative STT and prewarming

- After 1.2 s of voiced audio, the recorder grabs a speculative prefix and warms Whisper decoding.
- Meeting context (RAG) is prefetched while the user speaks.
- The local Whisper model is prewarmed at launch.
- Audio pipeline is prewarmed on voice detection.

**Status:** implemented; performance claims are plausible but not benchmarked in the repo.

### 5.11 Network hardening: DoH, airgap, pooling

**File:** `src/main/providers/request.ts` (uncommitted changes).

- Global `undici` Agent with keep-alive (60–300 s), 64 connections, pipelining 1.
- Custom DNS `lookup` resolves through **Cloudflare DoH at `1.1.1.1`** (`cloudflare-dns.com`), with a 5-minute cache.
- **Airgap shield** blocks every non-localhost outbound connection when enabled.
- Falls back to system DNS if DoH fails.

**Status:** backend implemented and IPC-exposed (`network:setAirgap`), but **there is no UI control** anywhere in the renderer. DoH is on by default and hardcoded to Cloudflare. This is a privacy trade-off (no plaintext DNS, but Cloudflare sees every hostname) and a resilience risk (blocked/slow DoH adds latency or falls back silently).

### 5.12 Usage tokens and estimated spend

**Files:** `usage.ts`, `SettingsView.tsx`, `types.ts`.

- Adds `inputTokens`, `outputTokens`, `totalTokens`, `estimatedSpendUsd` per provider.
- Pricing table uses one representative model per provider (OpenAI GPT-4o-mini, Anthropic Claude 3.5 Sonnet, Gemini 2.0 Flash, Groq Llama 3.3 70B, DeepSeek, Mistral, Ollama free).
- Settings shows a “Cost & Usage Intelligence” card with total spend and per-provider rows.

**Status:** implemented. **Accuracy caveat:** when the provider does not return a real token count, the code assumes 100 tokens split 70/30. Spend is therefore an estimate, sometimes a rough one, and the pricing table is model-independent.

### 5.13 CRM speaker statistics and talk ratio

- `MeetingTalkRatio` gains a `speakers` array with per-speaker word counts and percentages.
- `computeTalkRatio()` now prefers speaker-tagged transcript lines and only falls back to heuristics.
- Meeting action items gain a `category` (`technical`, `commercial`, `follow_up`, `decision`).

**Status:** implemented and tested.

### 5.14 GPU, GC, and capture flags

**File:** `src/main/index.ts` (uncommitted).

- `enable-gpu-rasterization`, `enable-zero-copy`, `ignore-gpu-blocklist`.
- `--expose-gc` and a 45-second idle `global.gc()` interval.
- Disables Chromium’s screen-capture border flags.

**Status:** implemented. The capture-border flags are explicitly intended to prevent Windows 11/macOS recording indicators from appearing. That is a transparency-reducing feature and should be treated as a policy decision, not a performance tweak.

### 5.15 Integrations UI additions

- Calendar sync card (Google/Outlook ICS), save-and-sync, event count, auto-detect toggle, setup instructions.
- Usage/spend card in Settings.
- Overlay calendar prompt and “start co-pilot” flow.

**Status:** implemented; depends on §5.1.

---

## 6. What is documented but not implemented

| Claimed feature | Where claimed | Reality |
|---|---|---|
| Desktop agent (click/type loop) | `README.md`, `docs/FEATURE_MATRIX.md` Part 5 lists it as deliberately excluded, but README documents it in detail | No `agent` domain, no IPC handlers, no renderer view. Only the humanizer types text when explicitly invoked. |
| Workflows | README “Studio”, `FeatureMatrix` part 5 | Only orphan `Workflow*` types remain in `src/shared/types.ts`; no engine, IPC, or UI. |
| Code/Studio mode | README “Studio” | No project indexer, code actions, or UI. |
| GitHub integration | README “Integrations”, `IntegrationId = 'github'` type | No GitHub API calls, no OAuth/PAT flow, no repo/issue UI. A GitHub MCP server preset exists only as a stored command string. |
| MCP client | UI page, dependency, docs | Definitions and a `which` check only. No process spawn, no JSON-RPC, no tool call. |
| General chat workspace | README architecture mentions `chat` route | The control panel has no chat route; the overlay is the only chat surface. |
| Project/automation domains | README architecture tree | Directories do not exist. |
| “Every provider is in the daemon” | `docs/FEATURE_MATRIX.md`, `docs/DAEMON.md` | `DAEMON_PROVIDERS` excludes Anthropic and Gemini; Rust has no Anthropic/Gemini client. |
| macOS release | README says cross-platform | `electron-builder.yml`: “Not a supported release target yet.” Code paths exist. |

---

## 7. Architecture

### 7.1 Process model

```
┌──────────────────────────────────────────────────────────────────────┐
│ Electron main process (Node)                                         │
│                                                                      │
│  windows.ts ── control panel window + overlay window                 │
│  domains/ipc.ts ── ~105 IPC channels, zod-validated                  │
│  domains/chat.ts ── answer pipeline, fallback, cache, OCR            │
│  domains/audio.ts ── provider STT → local Whisper fallback           │
│  domains/ocr.ts ── RapidOCR PP-OCRv6 (ONNX, offline)                 │
│  domains/interviews.ts ── sessions, ephemeral memory, retention      │
│  domains/meeting-notes.ts ── CRM synthesis, talk ratio               │
│  domains/knowledge/* ── BM25 + hybrid vector retrieval               │
│  domains/calendar.ts ── ICS sync + window meeting detection (WIP)    │
│  domains/remote-hud.ts ── LAN HTTP/SSE phone HUD (WIP)               │
│  providers/* ── 10 adapters, retry, error taxonomy, DoH             │
│  security/* ── safeStorage secrets, origin policy, untrusted wrap    │
│  store/json-store.ts ── atomic JSON persistence                      │
│                                                                      │
│        │ IPC (contextBridge, no Node in renderer)                    │
│        ▼                                                             │
│  preload/index.ts ── window.klyro API                                │
│        │                                                             │
│        ▼                                                             │
│  Renderer (React 19)                                                 │
│    App.tsx ── 7-route control panel                                  │
│    OverlayApp.tsx ── quick-ask overlay, listen/talk/record           │
│                                                                      │
│        │ loopback TCP, JSON lines, token auth                        │
│        ▼                                                             │
│  klyro-core (Rust daemon)                                            │
│    provider/{openai,ollama,opencode,cli,antigravity}.rs              │
│    transcribe.rs ── whisper-rs, 16 kHz mono f32 PCM                  │
└──────────────────────────────────────────────────────────────────────┘
```

### 7.2 Why a Rust daemon

The README and code comments give the rationale: Electron is heavy (hundreds of MB across processes), while the daemon starts in milliseconds and holds provider connections warm. The daemon owns the overlay’s hot path so opening the overlay does not pay for a browser runtime.

The daemon is deliberately Electron-agnostic. It knows nothing about windows, settings files, or the UI. It receives everything it needs per request or through a `configure` message.

### 7.3 Source map

```
src/
  main/
    index.ts              app lifecycle, GPU flags, CSP, daemon start
    domains/
      windows.ts          control panel + overlay windows, private mode, ghost/zero-focus
      shortcuts.ts        global hotkeys
      chat.ts             answer pipeline
      audio.ts            transcription routing
      ocr.ts              RapidOCR
      screenshot.ts       capture + source picker
      conversations.ts    stored chat history
      answer-cache.ts     instant replay
      interviews.ts       sessions, ephemeral, retention
      interview-model.ts  question classification, context extraction
      meeting-notes.ts    CRM synthesis, talk ratio
      knowledge.ts        search API
      documents.ts        import + chunk + store
      memory.ts           facts + recall
      context.ts          prompt block assembly + prefetch
      settings.ts         defaults + migration
      provider-settings.ts validation
      provider-models.ts  catalogue
      privacy.ts          data summary + clear
      retention.ts        pruning
      audit.ts            append-only log
      usage.ts            counts + spend
      maintenance.ts      storage report
      integrations.ts     Slack/CRM/MCP definitions
      calendar.ts         ICS + meeting detection (WIP)
      remote-hud.ts       LAN HUD (WIP)
      humanizer.ts        typing simulator (WIP)
      daemon.ts           Rust daemon client + lifecycle
      antigravity*.ts     local agent IDE integration
      local-agent*.ts     OpenCode/Claude/Codex discovery and launch
      tray.ts             tray icon
      permissions.ts      mic/screen permission state
      ipc.ts              handler registration
    providers/
      index.ts            registry
      openai.ts           OpenAI-shaped adapter (OpenAI/Groq/custom)
      anthropic.ts
      gemini.ts
      ollama.ts
      opencode.ts
      claude-code.ts
      codex.ts
      antigravity.ts
      request.ts          fetch + DoH + airgap + retry
      retry.ts
      errors.ts           failure taxonomy
      routing.ts          model/vision resolution
      http.ts             host parsing
    knowledge/
      retrieval.ts        tokenize, BM25, chunk, RRF
      vector-index.ts     64-dim hash/concept vectors (WIP)
      locations.ts        citation formatting
      eval.ts             retrieval evaluation
    security/
      secrets.ts          safeStorage
      origins.ts          origin/permission policy
      untrusted.ts        prompt-injection wrapping
    store/
      json-store.ts       atomic JSON
      storage.ts
    util/
      idle-timeout.ts
      with-timeout.ts
  preload/index.ts        contextBridge API
  renderer/src/
    App.tsx               control panel
    OverlayApp.tsx        overlay
    components/           views and dialogs
    lib/                  listen, audio-mixer, diarization
  shared/
    types.ts              1,115 lines of domain types + KlyroApi
    ipc.ts                ~105 channel names
crates/klyro-core/
  src/main.rs             lifecycle, token, state file
  src/server.rs           auth, dispatch, streaming
  src/protocol.rs         JSON-line request/response
  src/transcribe.rs       whisper-rs
  src/provider/           openai, ollama, opencode, cli, antigravity, stream
```

### 7.4 IPC contract

`src/shared/ipc.ts` is the single source of truth for channel names; `src/main/domains/ipc.ts` registers handlers; `src/preload/index.ts` exposes them as `window.klyro`. Renderer types live in `src/shared/types.ts` (`KlyroApi`, 1,115 lines).

Representative channel groups:

- app: `app:info`, `app:quit`
- settings: `settings:get`, `settings:update`, `settings:changed`
- providers: list/set key/clear key/test/models/detect
- chat: `chat:send`, `chat:abort`, `chat:stream`
- conversations: list/get/create/rename/delete/search
- capture/audio/OCR: `capture:sources`, `capture:grab`, `audio:transcribe`, `audio:prewarm`, `ocr:extract`
- knowledge: memory CRUD, document list/import/delete, `knowledge:search`
- interviews: start/add question/add transcript/update/summarize/CRM notes/export/facets
- integrations: Slack send, CRM send, MCP list/add/remove/toggle/test
- audit/usage: list/clear
- windows: hide/toggle/minimize/resize/snap/ghost/zero-focus/panic
- network: `network:setAirgap` (no UI)
- calendar: status/set feed/sync/upcoming/dismiss/toggle auto-detect (WIP)

IPC inputs are validated with `zod` at the boundary. The preload exposes no Node primitives.

---

## 8. The answer pipeline in detail

### 8.1 Context construction

`buildTurns()` takes the conversation, filters empty messages, keeps the most recent 40 turns, and walks backward to spend a 4-image budget on the newest attachments. Older images are dropped rather than silently sent.

`buildKnowledgeContext(query)`:

1. Checks a 60-second cache.
2. If memory is enabled, recalls `memoryRecallCount` records with BM25 and wraps them as untrusted data.
3. If knowledge is enabled, searches document chunks and compresses each hit to the most query-relevant sentences (max ~650 chars).
4. Formats each chunk with a location (`path:line`).
5. Caps the whole block at 8,000 characters.

### 8.2 Prompt assembly

The system prompt is:

```
<user system prompt>
<response-style suffix>
<interview/session context: decisions, terms, company, role>
<knowledge block>
```

Question classification (`technical`, `behavioral`, `project`, `general`) adds answer-shape advice. This is a heuristic, not a separate model call.

### 8.3 Screen handling

If the request has attachments:

1. Determine whether the transport can carry images and whether the model likely has vision.
2. If not, run local OCR.
3. Append readable text to the prompt and drop the image.
4. If OCR finds nothing, emit a visible warning instead of pretending.

If the transport can carry the image, the newest attachments are sent as data URLs.

### 8.4 Fast path and fallback

Order of preference for fast overlay queries:

1. **Answer cache** (same model + question + screenshot hash).
2. **Rust daemon** (if the provider is in `DAEMON_PROVIDERS` and Antigravity is reachable).
3. **Primary provider** with a 2-second first-token budget.
4. **Fallback provider** (Groq → Gemini → OpenAI → Ollama, first with a key).
5. **Error** with a classified message.

The daemon path is only used when `useFastModel === true`, so control-panel chats and summaries go through the app. If the daemon returns an error or does not take the request, the app falls through to its own client.

### 8.5 Failure taxonomy

`providers/errors.ts` classifies HTTP status, network failures, auth failures, rate limits, context-length errors, and provider-specific error bodies into a `ProviderError` with a `kind` and a human-readable message. `request.ts` retries before the body is streamed and avoids retrying non-retryable categories (e.g., bad key). `withIdleTimeout` aborts a stream that stalls (90 s default).

---

## 9. Provider subsystem

### 9.1 Registry

`providers/index.ts` maps each `ProviderId` to an adapter. OpenAI, Groq, and custom endpoints share `openAICompatibleFor(id)` but get separate identities for errors and telemetry.

### 9.2 Request layer

`providers/request.ts` centralises:

- `fetch` invocation,
- retry with delay and jitter,
- response classification,
- DNS resolution through Cloudflare DoH (WIP default),
- airgap blocking (WIP),
- global keep-alive pooling (WIP).

The DoH implementation queries `https://1.1.1.1/dns-query` with a `cloudflare-dns.com` Host header, parses A records, caches for 5 minutes, and falls back to system DNS. If the airgap shield is on, every non-localhost lookup throws.

### 9.3 Model catalogues

`provider-models.ts` and `provider-models` adapters query each provider’s model list where available (OpenAI `/models`, Ollama `/api/tags`, OpenCode server, Antigravity catalogue). For CLI agents, the accepted model ids are known statically or discovered from the CLI. The UI allows typing a model id that is not advertised.

### 9.4 Local agents

- **OpenCode**: discover the local server, optionally start it, check that a model actually answers, and route through its session API.
- **Claude Code / Codex**: locate the binary, run it headless with the prompt, stream stdout.
- **Antigravity**: discover the running IDE service or start it, persist the account session, enumerate chat models, and call Connect-RPC. The daemon can place the call when the app has the endpoint.

`local-agents.ts` and `local-agent-launcher.ts` handle detection, installation hints, and process lifecycle. OpenCode started by Klyro is stopped on quit.

---

## 10. The Rust daemon (`klyro-core`)

### 10.1 Lifecycle

1. Parse `--version` / `-V` and exit if requested (used by the app to compare builds).
2. Resolve the state directory: `$KLYRO_STATE_DIR` or `$HOME/.config/klyro` (or `%USERPROFILE%` on Windows).
3. If a state file exists and a daemon answers on its port, exit (single-instance behaviour).
4. Bind `127.0.0.1:0` (OS-assigned port).
5. Generate a 32-byte random token.
6. Write `klyro-core.json` with port, token, pid, version; chmod `0600` on Unix.
7. Serve until stopped; remove the state file on exit.

The app starts the daemon if configured, checks its version, and replaces a stale binary.

### 10.2 Protocol

One JSON object per line in both directions.

**Client → daemon:**

- `auth { token }` — must be the first line.
- `hello { version }`
- `configure { providers: [{ id, base_url, model, api_key }] }`
- `models { provider }`
- `ask { provider, model, base_url, api_key?, prompt, images[], binary, port, csrf }`
- `transcribe { audio_pcm_base64, model_path }`
- `prewarm { model_path }`
- `ping`

**Daemon → client:**

- `hello { version, pid, port }`
- `delta { text }`
- `done { ms }`
- `models { models[] }`
- `transcribed { text }`
- `prewarmed`
- `error { message }`
- `pong`

Authentication is a single token line; a client that cannot present it receives an error and is disconnected. There is no TLS, but the listener is loopback-only and the state file is mode `0600`.

### 10.3 Provider support in Rust

`State::client_for_ask()` selects:

| Provider | Rust client |
|---|---|
| `ollama` | `Ollama` |
| `opencode` | `OpenCode` (session API) |
| `claude-code` | `ClaudeCode` (CLI process) |
| `codex` | `Codex` (CLI process) |
| `antigravity` | `Antigravity` (Connect-RPC) |
| everything else with a base URL | `OpenAi` (OpenAI-shaped) |

That “everything else” branch is why OpenAI, Groq, and custom endpoints work. **Anthropic and Gemini do not**, because their APIs are not OpenAI-shaped. The app acknowledges this by excluding them from `DAEMON_PROVIDERS`, but the documentation’s “every provider is in it” claim is false.

### 10.4 Transcription

`transcribe.rs` uses `whisper-rs` with a bundled GGML model. The app sends base64-encoded 16 kHz mono little-endian f32 PCM. `Prewarm` keeps the model in memory. Transcription runs on `spawn_blocking` so it does not stall the async server.

### 10.5 Daemon strengths and limits

**Strengths:** tiny footprint, fast start, warm connections, token auth, no Electron dependency, graceful app fallback.

**Limits:** no Anthropic/Gemini, no TLS, one token for the process lifetime, no per-client authorization, no rate limiting, no streaming backpressure beyond line writes, and no explicit cancellation message (the app aborts its own socket or the daemon finishes the stream).

---

## 11. Audio pipeline

```
Microphone / system loopback
        │
        ▼
MediaRecorder (webm/opus preferred)
        │
        ├── short slices + level watcher (listen mode)
        │       └── utterance boundary: 700 ms silence, 400 ms preroll
        │
        ├── 1.2 s speculative prefix → warm Whisper
        │
        ▼
PCM16k decode (renderer) ──► IPC audio:transcribe
        │
        ▼
main/domains/audio.ts
        │
        ├── 1. active provider STT (if adapter + key)
        │       └── failure → fall through
        │
        ├── 2. bundled Whisper via klyro-core
        │       └── model: ggml-tiny.en-q5_1.bin
        │
        └── 3. error with a provider-specific explanation
        │
        ▼
transcript text ──► knowledge prefetch ──► question heuristic ──► chat
```

Key behaviours:

- Silence is never transcribed, so a quiet meeting costs nothing.
- The question heuristic avoids LLM calls on non-questions.
- The model is asked to return `—` when there is nothing to answer.
- Audio is held in memory; it is not written to disk.
- The dual-channel mixer and diarizer are WIP and live in the renderer.

---

## 12. Knowledge and retrieval internals

### 12.1 Lexical retrieval (committed)

- Tokenisation: lowercase, Unicode letters/numbers, length ≥ 2, stopword removal.
- Okapi BM25 with `k1 = 1.5`, `b = 0.75`.
- Candidate pre-filter by posting lists; scoring only on documents containing at least one query term.
- Chunking: paragraph-aware, sentence-boundary fallback, 1,200-char target, 150-char overlap.
- Chunk metadata: character offsets and 1-based start/end lines.
- Jaccard similarity for near-duplicate memory suppression.

### 12.2 Hybrid retrieval (WIP)

- `computeDenseEmbedding(text)` builds a 64-float vector.
- Curated concept clusters (memory, automation, security, meetings, providers, documents, privacy, workflows, shortcuts, releases) add 1.8 to specific dimensions.
- Every token also gets a deterministic FNV-style hash projection into two dimensions with ±0.4/0.3 weights.
- Vectors are L2-normalised, quantised to int8, cached in an LRU (5,000 entries).
- `hybridSearch()` fuses BM25 and vector ranks with RRF (k = 60, default 50/50 weighting), then adds small boosts for bigram and full-query containment.

This is a clever, dependency-free approximation, but it is **not semantic in the neural sense**. It knows the words in its concept table and hashes everything else. The eval suite (`knowledge/eval.ts`, `retrieval-eval.test.ts`) tests retrieval quality, but the comments should not call it a dense embedding without qualification.

### 12.3 Prompt-injection handling

Retrieved documents and memories are wrapped as untrusted data:

```
<untrusted source="saved memories">
...
</untrusted>
```

The system prompt tells the model this is data, not instructions. This is a mitigation, not a guarantee; a sufficiently persuasive document can still influence a model.

---

## 13. Meetings, interviews, and notes internals

### 13.1 Session lifecycle

1. `interviews.start(company, role, { ephemeral })` creates a session.
2. Questions and transcript lines are appended during the meeting.
3. The overlay can add answers and notes.
4. `interviews.summarize(id)` calls the active provider with a structured prompt; `generateCrmNotes(id, type)` uses the meeting-note template.
5. The result is parsed as JSON with a defensive schema; malformed fields become `undefined` rather than crashing.
6. `computeTalkRatio()` derives speaker statistics.
7. Export produces Slack text, Markdown, or an email body.

### 13.2 Prompting strategy

The meeting-notes prompt asks for strict JSON with fields for summary, action items, decisions, CRM insights, MEDDPIC, follow-up email, and risks. Type-specific instructions change the emphasis (e.g., sales calls focus on pain/budget/timeline/objections; engineering syncs focus on decisions/blockers/ownership).

### 13.3 Retention and privacy

- `retentionDays` applies to interviews, conversations, and audit entries.
- Ephemeral sessions live in a `Map` and are excluded from `interviews.json`, the answer cache, and memory extraction.
- A stored conversation is never deleted to make room for an ephemeral one; the ephemeral session gets an in-memory stand-in.
- `privacy.summary()` counts stored vs ephemeral sessions and reports storage.

### 13.4 Limitations

- CRM “insights” are model-generated and can be wrong; there is no verification step.
- Talk ratio is word-count based, not time based.
- Diarization is heuristic and WIP.
- The JSON parser is defensive but the model may still omit fields.
- There is no speaker-level sentiment or objection tracking beyond the prompt.

---

## 14. Overlay, windows, and stealth internals

### 14.1 Window configuration

- Frameless, transparent, always-on-top, skip-taskbar.
- `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`.
- Default 640 × 208, content-driven height 150–520.
- Opacity 20–100%, applied globally.
- Show/hide animation ~150 ms.
- Overlay is created at launch so the hotkey only pays for the animation.

### 14.2 Capture exclusion

`applyOverlayPrivateMode()` uses the platform API that password managers use:

- Windows: `SetWindowDisplayAffinity` / `WDA_EXCLUDEFROMCAPTURE`.
- macOS: `NSWindow.sharingType = .none`.
- Linux: no per-window exclusion API; the app says so honestly.

A privacy probe takes two captures and compares pixels to verify the claim.

### 14.3 Ghost and zero-focus

- **Ghost**: mouse events pass through (`setIgnoreMouseEvents(true, { forward: true })`) and opacity drops to 0.22. The overlay is visible but non-interactive; a banner allows restoring.
- **Zero-focus**: `setFocusable(false)` and `showInactive()` so the window never takes focus. This is useful for not disrupting a browser or a proctored test window, and is also a stealth feature.

### 14.4 Panic killswitch

`panicKillswitch()`:

1. Sends `overlay:emergencyReset` to the renderer.
2. Hides the overlay.
3. Hides the control panel (`hideEverything()`).
4. Dynamically imports `chat` and calls `abortChat()`.

The overlay also triggers it on a double-Escape within 350 ms.

### 14.5 Decoy mode

Renders a fake Notepad window (“Meeting_Notes - Notepad”) with plausible meeting notes and a blinking cursor. Clicking it or pressing Escape restores the real overlay. This is camouflage, not a functional disguise of the process.

### 14.6 Notch teleprompter

Positions the overlay top-center, 4 px below the work-area top, and switches the CSS to a prompter layout. The intent is to place text near the webcam so the user appears to maintain eye contact.

### 14.7 Capture-border bypass

Chromium switches disable the visible capture border/indicator on Windows 11 and macOS. This reduces the transparency of screen recording and is a significant policy/ethical issue.

---

## 15. Calendar sync and meeting detection (WIP)

### 15.1 iCalendar parsing

Supports:

- line unfolding (`CRLF`/`LF` + space/tab),
- `UID`, `SUMMARY`, `DESCRIPTION`, `LOCATION`, `DTSTART`, `DTEND`, `ATTENDEE`, `ORGANIZER`, `STATUS`,
- escaped `\n`, `\,`, `\;`, `\\`,
- UTC (`...Z`), local (`YYYYMMDDTHHMMSS`), and all-day (`YYYYMMDD`) dates,
- cancellation by invalidating the event id,
- meeting URLs in description, location, title, or summary.

### 15.2 Company extraction

Patterns:

- `with|w/ <company>`
- `<company> x|<>|/ Klyro|me|us`
- `Klyro|me|us x|<>|/ <company>`
- `<company> Product Demo|Demo|Interview|Sync|Call|Discussion|Overview|Onboarding`

Filters out public email domains and generic meeting words. Falls back to the first non-public attendee domain.

### 15.3 Meeting-window detection

Scans `desktopCapturer.getSources({ types: ['window'] })` for titles containing:

- Google Meet (`meet - …`, `meet.google.com`)
- Zoom (`zoom meeting`, `zoom - …`, `zoom workplace`)
- Microsoft Teams
- Webex
- Slack Huddle

Skips titles containing “klyro.” Dismissed synthetic ids are remembered.

### 15.4 Upcoming-meeting logic

An event is “upcoming” from 5 minutes before start until its end. Status text is “Starts in Nm,” “Starting in < 1m,” or “In progress.” If no calendar event qualifies, the window detector runs.

### 15.5 Security caveats

- The feed URL is stored in plaintext in `calendar.json`.
- The fetch has a 10-second timeout but no host allowlist; any URL is fetched.
- iCalendar content is untrusted; the parser is defensive but not fuzzed.
- The calendar URL can be a bearer secret (Google/Outlook private ICS links).

---

## 16. Remote HUD (WIP)

`remote-hud.ts` is a small HTTP server:

- `GET /events` — SSE stream; sends `init` with current state, then broadcasts `start`, `delta`, `question`, `transcript`, `done`, `error`.
- `GET /api/status` — JSON snapshot.
- `GET /` — mobile HTML HUD with dark styling and auto-reconnect.

State: last 30 transcript lines, current question, current answer, streaming flag, talk ratio.

**Security posture:** binds `0.0.0.0`, no auth, no TLS, no origin restriction, `Access-Control-Allow-Origin: *`. On a shared or untrusted LAN, this exposes live meeting content. It should be loopback-only or require a pairing token before shipping.

---

## 17. Storage and data lifecycle

### 17.1 Persistent files

All under Electron `app.getPath('userData')`, written atomically (temp file + rename) by `JsonStore`:

| File | Contents |
|---|---|
| `settings.json` | `AppSettings` |
| `secrets.json` | OS-encrypted provider keys and integration secrets |
| `conversations.json` | stored chat history |
| `interviews.json` | stored interview/meeting sessions |
| `memory.json` | saved memory facts |
| `documents.json` | imported document metadata + extracted text |
| `audit.json` | append-only audit log |
| `usage.json` | per-provider counts/tokens/spend |
| `integrations.json` | Slack/CRM non-secret settings + MCP definitions |
| `calendar.json` | ICS feed URL, cached events, dismissals (WIP) |

### 17.2 Corruption handling

`JsonStore` never overwrites an unparseable file. It quarantines it (renames aside) and starts from defaults, logging the kept path. A leftover `.tmp` from a crash is removed rather than mistaken for data.

### 17.3 Ephemeral data

- Ephemeral interview sessions live only in a `Map`.
- Their conversations use an in-memory stand-in.
- They are excluded from the answer cache and memory extraction.
- They disappear on quit.

### 17.4 Retention

`retentionDays` prunes interviews, conversations, and audit entries at startup and on change. `0` means keep until deleted. Usage counts are not timestamped and are cleared manually.

### 17.5 Repo-local artifacts

`audit.json`, `usage.json`, and `mcp.json` can appear at the repository root during smoke/dev runs; they are git-ignored. `release/`, `out/`, and Rust `target/` are also ignored build output.

---

## 18. Security model

### 18.1 Strengths

- `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderer.
- Preload exposes a narrow, typed API — no `ipcRenderer` or `require` in the renderer.
- Origin validation on navigation and IPC.
- Strict production CSP (`default-src 'none'`, no objects, no frames).
- Secrets encrypted with `safeStorage`; plaintext refused by default.
- Integration secrets separated from non-secret JSON.
- Diagnostics opt-in, local only.
- Audit log and per-scope data clearing.
- Daemon loopback-only with a random token and `0600` state file.
- Prompt-injection wrapping for retrieved content.
- Local OCR/STT keep screen and audio content off the network when configured.

### 18.2 Weaknesses and risks

1. **Remote HUD is unauthenticated and LAN-exposed** (§5.7). This is the most serious concrete vulnerability.
2. **Cross-provider fallback can leak data** (§5.9). A prompt and screenshot can go to a provider the user did not select.
3. **Hardcoded Cloudflare DoH** sends every hostname to Cloudflare and can fail silently to system DNS.
4. **Airgap has no UI**, so users cannot actually enable it from the app.
5. **Calendar feed URL is stored in plaintext**, although it is often a bearer secret.
6. **Humanizer explicitly defeats anti-paste detection**, enabling misrepresentation in assessments and interviews.
7. **Capture-border bypass** hides recording indicators, reducing informed consent.
8. **Decoy/ghost/zero-focus/panic** features are designed to conceal tool use from other people and from proctoring software.
9. **`ghostShortcut` is referenced but not in settings**, so the feature is only reachable from the overlay button or a manually injected settings file.
10. **Usage spend is estimated** with fixed 100-token assumptions when real counts are unavailable; presenting it as “honest” is too strong.
11. **MCP “test” is a `which` check**, not a connectivity test; the UI must not imply otherwise.
12. **Daemon has one shared token for the process lifetime**, no per-client scoping, and no TLS. Loopback mitigates but does not eliminate local malware risk.

### 18.3 Threat model notes

Klyro assumes a single-user desktop. It does not defend against:

- malware running as the same user (it can read the state file, attach to the daemon, or read `secrets.json` if the OS keychain is unlocked),
- a compromised provider or MITM on a provider connection (TLS is used, but there is no certificate pinning),
- someone physically at the machine,
- another device on the LAN when the remote HUD is on,
- prompt injection from imported documents.

---

## 19. Build, packaging, and release

### 19.1 Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | electron-vite dev server |
| `npm run build` | production build to `out/` |
| `npm run typecheck` | node + web typecheck |
| `npm test` | Vitest |
| `npm run smoke` | build + boot real app, assert both windows render |
| `npm run check:package` | inspect `app.asar` for missing entry points |
| `npm run pack:*` | unpacked build per platform |
| `npm run dist:*` | installer per platform |
| `npm run icons` | generate icons from the brand mark |

`prebuild` downloads the Whisper and OCR models if absent.

### 19.2 Packaging

`electron-builder.yml`:

- appId `com.klyro.app`, product `Klyro`.
- `asar: true`; native `.node` files and `@img/**` unpacked.
- Bundles `out/**`, `package.json`, Rust binary, Whisper model, OCR models.
- Keeps `src`/`doc`/`docs` directories inside `node_modules` because some packages ship runtime code there (a 0.9.24 fix).
- Prunes unused onnxruntime binaries and MCP SDK server/Express code.
- Linux: AppImage + deb; Windows: NSIS; macOS: dmg config present but unsupported.
- Max compression, artifact name `${productName}-${version}-${arch}.${ext}`.

### 19.3 CI

`.github/workflows/ci.yml` on every push/PR to `main`:

1. Node 22 + `npm ci`.
2. Typecheck.
3. Unit tests.
4. Build.
5. Xvfb smoke test of the built app (both windows, preload bridge, no CSP violations).

### 19.4 Release

`.github/workflows/release.yml` builds Linux and Windows artifacts on tags, runs `check:package`, and publishes the GitHub release. `scripts/sync-version.mjs` keeps `crates/klyro-core/Cargo.toml` in sync.

### 19.5 0.9.24 packaging fixes

- Windows startup crash from over-aggressive `doc`/`src` pruning in `node_modules`.
- OCR failure because sharp/libvips native libraries were inside `app.asar`.
- Windows daemon state path used `HOME` instead of `USERPROFILE`.
- Smaller installers (Whisper tiny.en q5_1, per-platform onnxruntime).

---

## 20. Testing and quality

### 20.1 TypeScript tests

64 files, 402 tests. Coverage includes:

- provider adapters, identity, retry, errors, routing, vision,
- chat pipeline and fallback,
- knowledge retrieval and eval,
- documents, memory, context,
- interviews, meeting notes, talk ratio, retention,
- answer cache,
- audit, usage, privacy,
- shortcuts, settings defaults, provider settings,
- antigravity service/session/models,
- OCR locator,
- renderer components (`App`, `OverlayApp`, `ModelPicker`),
- real integration tests for local agents guarded by environment.

Several “real” tests (OpenCode, Claude Code, local agent launcher, Groq live) are skipped or conditional when the corresponding tool/key is absent. The 8 skipped tests are expected in this environment.

### 20.2 Rust tests

21 tests in `crates/klyro-core/src/provider/tests.rs` and related modules: protocol serialization, provider selection, streaming chunks, CLI parsing, OpenCode behaviour.

### 20.3 Smoke test

`scripts/smoke.cjs` boots the built Electron app under Xvfb, asserts both windows render, the preload bridge exists, and the renderer logged no errors or CSP violations. This is a meaningful end-to-end check, not just a unit-test wrapper.

### 20.4 Gaps

- No tests for the remote HUD, calendar sync, humanizer, audio mixer platform paths, or diarization accuracy beyond unit-level math.
- No end-to-end test for capture exclusion on real Windows/macOS.
- No performance benchmarks for the 2-second fallback or speculative STT.
- No fuzzing of the ICS parser or provider error bodies.
- No test that the airgap shield actually blocks all egress paths (some code uses direct `fetch`/`https` outside `request.ts`).

---

## 21. Platform support

| Capability | Windows | Linux | macOS |
|---|---|---|---|
| App release | NSIS installer | AppImage, deb | dmg config, **not supported** |
| Overlay | yes | yes | yes (code) |
| Global shortcuts | yes | yes (X11; Wayland limits) | yes |
| Capture exclusion | `WDA_EXCLUDEFROMCAPTURE` | **no per-window API** | `sharingType = .none` |
| System audio loopback | `getDisplayMedia` | PulseAudio/PipeWire monitor | **no**; mic fallback |
| Local Whisper | bundled | bundled | bundled |
| Local OCR | bundled | bundled | bundled |
| Humanizer | PowerShell SendKeys | `xdotool` | AppleScript |
| Daemon | yes | yes | yes (code) |
| Tray hide / taskbar hide | yes | yes | yes (Dock) |

Linux caveats:

- X11 is the practical target; native Wayland restricts global shortcuts and window manipulation.
- Whole-screen shares still capture the overlay.
- Loopback depends on the desktop exposing a monitor source.

macOS caveats:

- Accessibility permission is needed for synthetic input.
- No system-audio loopback via the current mixer.
- No signed/notarized release pipeline.

---

## 22. Risks, limitations, and ethical/legal considerations

This section is deliberately direct. The code is capable, but several features create real-world harm potential that a report should not bury.

### 22.1 Deception and assessment integrity

- **Humanized typing** exists to make generated text indistinguishable from human typing and explicitly to bypass anti-paste detection.
- **Ghost mode, zero-focus, decoy Notepad, notch teleprompter, panic killswitch, and capture-border suppression** are designed to keep the assistant unseen during calls, interviews, or proctored sessions.
- **Private mode** is defensible for protecting sensitive notes during a share, but the same mechanism can hide unauthorized assistance.

Using these features in employment interviews, exams, or client calls without disclosure may violate contracts, platform terms, proctoring rules, or law. The project should state this plainly in its README and require explicit acknowledgement before enabling stealth features. A generic “meeting assistant” framing does not communicate the risk.

### 22.2 Data exposure

- Remote HUD on `0.0.0.0` with no auth is an immediate confidentiality risk.
- Cross-provider fallback sends prompts/screenshots to a provider the user did not choose.
- Calendar feed URLs are bearer secrets stored in plaintext.
- Cloudflare DoH centralises hostname visibility.
- The daemon’s shared token and loopback listener are only as safe as the local user account.

### 22.3 Accuracy and overclaiming

- “Dense semantic vector search” is a hand-built 64-dimension projection, not a neural embedding.
- “Estimated spend” uses fixed token assumptions when counts are missing and model-independent pricing.
- “Speaker diarization” is spectral clustering over an 8-band FFT, not a speaker-embedding model.
- “CRM insights” and “MEDDPIC” output are model-generated text with no verification.
- “Every provider is in the daemon” is false.
- “MCP integration” is definitions only.

### 22.4 Product and maintenance risks

- Two runtimes mean two implementations of provider streaming; drift is already visible (Anthropic/Gemini missing in Rust).
- The working tree contains a large unreleased feature bundle with security-sensitive code (remote HUD, DoH, capture flags) and no release gate yet.
- Documentation drift is severe enough that a new contributor cannot trust the README.
- Orphan types (`Workflow*`, `WorkspaceView` routes) create a false impression of features.
- The app depends on external binaries (`pdftotext`, `unzip`, `xdotool`, `osascript`, CLIs) whose absence changes behaviour.

### 22.5 Legal/compliance questions to resolve

- Consent to record in two-party-consent jurisdictions.
- Whether capture-exclusion and indicator suppression violate platform policies.
- Whether storing calendar feed URLs and meeting transcripts meets GDPR/CCPA obligations.
- Whether “ephemeral” is truly ephemeral across crash dumps, swap, and OS logs.
- Whether bundling a 31 MB Whisper model and OCR models has license obligations (models are downloaded/bundled; licenses should be documented).

---

## 23. Documentation vs. code — contradictions

### 23.1 `README.md`

| README claim | Reality |
|---|---|
| Architecture lists `automation`, `agent`, `project`, `code`, `meetings`, `workflows` domains | None of those directories exist. |
| “Desktop agent” section with screen captioning, click/type loop, approvals, history | No implementation. |
| “Studio” with coding mode, project indexing, diff actions | No implementation. |
| “Workflows” with four built-in workflows | Only orphan types. |
| “Integrations — connect GitHub with a personal access token” | No GitHub code. |
| “Settings → Providers” / “Settings → Data & privacy” | UI routes are “Models & Agents” and “Privacy & Data.” |
| Cross-platform Windows/macOS/Linux | macOS is not a supported release target. |
| “production-hardened” | True for the committed core; the working tree adds unreviewed security-sensitive code. |

### 23.2 `docs/FEATURE_MATRIX.md`

| Matrix claim | Reality |
|---|---|
| Part 5: chat workspace ⬜ deliberately excluded | There is no chat workspace, so this is directionally true, but the overlay does have history. |
| Part 5: desktop agent ⬜ | Consistent with code, but README contradicts it. |
| Part 5: Meetings/Studio ⬜ | False: Meetings & Interviews is a major shipped surface. |
| Part 5: GitHub ⬜ | Consistent with code, but README advertises it. |
| Part 5: MCP client ⬜ | Consistent with code; the UI stores definitions. |
| Part 4: “Every provider is in the daemon” | False for Anthropic and Gemini. |
| Part 2: “Meetings & CRM Notes ✅” | True, and more detailed than the matrix’s later section suggests. |
| Part 2 shell list | Omits Integrations & MCP, which is in the UI. |
| Missing | Calendar sync, remote HUD, ghost/zero-focus/panic/decoy, humanizer, RSVP, hybrid retrieval, usage spend, dual audio, diarization — all WIP. |

### 23.3 `docs/DAEMON.md`

- Accurately documents the protocol and lifecycle.
- Overstates provider coverage (“Every provider Klyro has, in Rust”).
- Does not mention the missing cancellation message or the single shared token.
- Describes scripts (`check-agents-through-daemon.cjs`) that should be verified before being cited as a gate.

### 23.4 `CHANGELOG.md`

- The 0.9.24 entry is unusually honest: it explicitly says the MCP client is not implemented.
- It accurately describes the packaging fixes and OCR/Whisper changes.
- It does not mention the uncommitted stealth/calendar/remote-HUD work, which is correct because it is unreleased.

---

## 24. Overall assessment

### 24.1 Strengths

1. **Real product depth.** The overlay, multi-provider streaming, local OCR/STT, knowledge base, interview history, and CRM notes are substantial and integrated, not mockups.
2. **Strong local-first story.** Bundled Whisper and OCR, atomic local storage, encrypted secrets, ephemeral sessions, retention controls, and a daemon that keeps the hot path native.
3. **Good engineering hygiene in the committed core.** Zod-validated IPC, origin policy, CSP, provider error taxonomy, retry rules, idle timeouts, atomic writes, quarantine-on-corruption, and a meaningful test suite.
4. **Honest failure modes.** OCR says when it found nothing; capture exclusion says Linux cannot do it; provider errors name the provider and endpoint; the changelog admits MCP is not implemented.
5. **Unusual breadth of provider support.** Cloud APIs, local Ollama, local coding agents, and Antigravity behind one contract.

### 24.2 Weaknesses

1. **Documentation is not trustworthy.** README and FEATURE_MATRIX describe a removed product vision; a reader cannot tell what is real without reading code.
2. **The working tree is a large, unreviewed bundle** with security-sensitive networking and stealth features.
3. **Remote HUD is unsafe as written.**
4. **Cross-provider fallback is a privacy surprise.**
5. **Stealth/anti-detection features carry ethical and legal risk** and are not disclosed in the product framing.
6. **Several “smart” features are heuristics presented as stronger techniques** (vector search, diarization, spend).
7. **Two provider implementations drift** (Rust lacks Anthropic/Gemini).
8. **macOS is claimed but not shipped.**

### 24.3 If the goal is a releasable 1.0

Priority order:

1. **Fix or gate the remote HUD** (loopback by default, pairing token, explicit warning).
2. **Make fallback opt-in and visible before the request**, with a per-provider allowlist.
3. **Reconcile README/FEATURE_MATRIX with the code**, deleting the desktop-agent/Studio/workflow/GitHub claims or marking them roadmap.
4. **Encrypt the calendar feed URL** and add a host allowlist.
5. **Add a stealth-feature disclosure and consent screen**, and document lawful use.
6. **Decide whether capture-border suppression belongs in the product.**
7. **Add Anthropic/Gemini to the daemon or correct the docs.**
8. **Label estimated metrics as estimates** (spend, diarization, semantic search).
9. **Add tests for the new WIP surfaces** before merging.
10. **Ship a signed macOS build or stop claiming macOS support.**

---

## Appendix A — IPC channel inventory (grouped)

The contract has ~105 channels. Grouped by area:

- **App**: `app:info`, `app:quit`
- **Settings**: `settings:get`, `settings:update`, `settings:changed`
- **Providers**: `provider:list`, `provider:setKey`, `provider:clearKey`, `provider:test`, `provider:models`, `provider:detectModels`
- **Chat**: `chat:send`, `chat:abort`, `chat:stream`
- **Conversations**: `conversation:list/get/create/rename/delete/search`
- **Capture/audio/OCR**: `capture:sources`, `capture:grab`, `audio:transcribe`, `audio:prewarm`, `ocr:extract`
- **Permissions/security**: `permissions:check`, `security:status`, `privacy:probeOverlay`, `screen:listDisplays`
- **Data**: `data:summary`, `data:clear`, `storage:sweep`, `diagnostics:list`, `diagnostics:clear`
- **Memory**: `memory:list/add/update/delete/clear`
- **Documents**: `document:list/import/delete/clear`
- **Knowledge**: `knowledge:search`
- **Windows**: `window:hideOverlay`, `window:minimizeOverlay`, `window:toggleOverlay`, `window:snapToNotch`, `window:setGhostMode`, `window:setZeroFocus`, `window:panicKillswitch`, `overlay:resize`, `window:privateModeStatus`, `overlay:setRecordingSticky`, `overlay:catalogue`
- **Humanizer/HUD/network**: `humanize:type`, `remoteHud:start/stop/status`, `network:setAirgap`
- **MCP**: `mcp:servers/addServer/removeServer/toggleServer/testServer`
- **Integrations**: `integrations:get/update/sendSlack/sendCrm`
- **Audit/usage**: `audit:list/clear`, `usage:rows/clear`
- **Antigravity**: `antigravity:status/startService/connect/disconnect`
- **Interviews**: `interviews:list/get/start/addQuestion/addTranscript/update/updateQuestion/toggleBookmark/keep/remove/clear/facets/summarize/generateCrmNotes/exportMarkdown`
- **Local agents**: `local-agents:detect/startOpenCode/connectOpenCode/openCodePickModel/openCodeInstalled/clis`
- **Calendar (WIP)**: `calendar:getStatus/setFeedUrl/sync/getUpcoming/dismiss/toggleAutoDetect`

---

## Appendix B — Data files and where they live

| Path | Owner | Notes |
|---|---|---|
| `<userData>/settings.json` | `settings.ts` | defaults + migrations |
| `<userData>/secrets.json` | `security/secrets.ts` | OS-encrypted; plaintext opt-in |
| `<userData>/conversations.json` | `conversations.ts` | chat history |
| `<userData>/interviews.json` | `interviews.ts` | stored sessions |
| `<userData>/memory.json` | `memory.ts` | facts |
| `<userData>/documents.json` | `documents.ts` | imported text + metadata |
| `<userData>/audit.json` | `audit.ts` | append-only |
| `<userData>/usage.json` | `usage.ts` | counts/tokens/spend |
| `<userData>/integrations.json` | `integrations.ts` | non-secret integration config |
| `<userData>/calendar.json` | `calendar.ts` | ICS URL + cached events (WIP) |
| `<userData>/answer-cache` | `answer-cache.ts` | replay cache (internal format) |
| `~/.config/klyro/klyro-core.json` | Rust daemon | port, token, pid, version; `0600` |
| `resources/models/whisper/*.bin` | packaging | bundled STT |
| `resources/models/ocr/*.onnx` | packaging | bundled OCR |

---

## Appendix C — Reproduction commands

```bash
# From the repository root
npm run typecheck
npm test -- --reporter=dot

# Rust daemon
cd crates/klyro-core
cargo test

# Build and smoke
npm run build
npm run smoke

# Package (Linux example)
npm run pack:linux
npm run check:package
```

---

## Appendix D — Glossary

| Term | Meaning in Klyro |
|---|---|
| **Overlay** | The frameless, always-on-top quick-ask window. |
| **Control panel** | The main Electron window with seven routes. |
| **Daemon / `klyro-core`** | Rust process owning the overlay’s hot path. |
| **Fast model** | Optional faster model used for overlay queries. |
| **Private mode** | Capture exclusion for the overlay. |
| **Ephemeral session** | Interview held only in memory, never written to disk. |
| **Answer cache** | Replay of an identical question + screenshot. |
| **BM25** | Lexical ranking function used for memory/document retrieval. |
| **RRF** | Reciprocal Rank Fusion, used to combine BM25 and vector ranks. |
| **MEDDPIC** | Enterprise sales qualification framework used in note templates. |
| **MCP** | Model Context Protocol; stored as definitions only, not implemented. |
| **BYOK** | Bring your own key; Klyro has no subscription or proxy. |

---

*End of report.*
