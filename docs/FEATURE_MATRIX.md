# Klyro — Feature Matrix & Plan

Status legend: **✅ done** · **🟡 partial** · **⬜ planned**

## Part 1 — Core assistant capabilities

| Feature | Status | Notes |
| --- | --- | --- |
| 1.1 Floating assistant window | ✅ | Frameless always-on-top overlay window; **user-controlled opacity (20–100%, 0.3.3)** via window-level transparency; explicit drag handles (top bar + Klyro wordmark), interactive controls excluded from dragging. **0.6.0: it appears the way a native panel does** — the window is created at launch (so the hotkey pays only for the animation), it fades in with an ease-out curve while the content settles behind it, it fades out instead of vanishing, and the window background matches the glass surface so there is no colour flash |
| 1.2 Global shortcut to show/hide | ✅ | Default `Ctrl/Cmd+Shift+Space` (configurable) |
| 1.2c Keep the overlay out of a share | ✅ | Three supported routes: (1) **Private mode** excludes the window from captures and live shares on Windows/macOS; (2) **Overlay screen** (0.3.9) puts the overlay on a second display you are not sharing — the shared framebuffer simply does not contain it; (3) **privacy check** (0.3.7) measures the exclusion on your own machine. Linux capture now prefers a compositor-native tool (grim / GNOME Shell D-Bus / ImageMagick) so the xdg-desktop-portal dialog never appears on your screen mid-meeting |
| 1.2b Capture exclusion, verified | ✅ | **Private mode** excludes the overlay from screen captures and live screen shares on Windows and macOS (`WDA_EXCLUDEFROMCAPTURE` / `NSWindow.sharingType = .none`) — the same supported APIs password managers use. **0.3.7: a privacy check measures it on your machine** — two captures, one with the overlay up and one without, compared pixel by pixel — and reports the number instead of claiming it. macOS permission is requested at launch so the system prompt never appears mid-meeting. Linux/X11 has no per-window exclusion API; the check says so plainly |
| 1.3 Text questions | ✅ | Streaming chat |
| 1.4 Voice input | 🟡 | Record → transcribe via OpenAI-compatible `/audio/transcriptions`; local Whisper supported |
| 1.5 Contextual follow-ups | ✅ | Full conversation history sent to the provider |
| 1.6 Stays accessible over other apps | ✅ | Overlay window |
| 1.7 Window controls / keyboard nav | 🟡 | Escape closes panels, dialogs take focus, visible focus rings; full arrow-key navigation still open |
| 2.1 Permission-gated screen capture | ✅ | `desktopCapturer` + explicit source picker. **Klyro hides itself while capturing (0.3.5)** so a full-screen shot shows your work, not the app asking about it; Klyro's own windows are filtered out of the source list |
| 2.2 Ask about screen / region | 🟡 | One flow: chat → "Ask about my screen" (or the Screen shortcut) opens the source picker, the capture attaches to your message, and the answer lands in the same conversation. The separate "Screen Assistant" page was cut in 0.3.5 as a duplicate of this. **Also in the quick-ask overlay (0.3.6)**: "Capture screen" attaches what is on screen to the next question — the point where you are already in another app. **Instant capture (0.3.7)**: one click captures the display below the overlay (Klyro hides itself for the shot) and attaches it; a Settings switch turns the source picker off/on, and the OS permission state is shown honestly. Region crop planned |
| 2.3 Understand text/code/UI | ✅ | Vision models (provider-dependent) |
| 2.4 Conversation context across turns | ✅ | Persisted history |
| 3.1 Microphone capture with consent | ✅ | `getUserMedia` + visible recording state |
| 3.2 Live transcription | 🟡 | Push-to-talk transcription; **conversation mode (0.6.0)**: the microphone stays open, voice activity detection starts and ends your utterance, and Klyro answers when you stop speaking — with the screen attached, so the answer is about what you are looking at while you say it. **Speak again mid-answer and the answer is cut off**: you interrupted, and the new words are the question |
| 3.3—3.4 Real-time suggestions | 🟡 | Overlay "Listen" mode: 20s chunked transcription of meeting audio, question heuristic, auto-answers shown in the overlay (rate-limited on free Groq tiers) |
| 4.1 Meeting transcripts / summaries | ✅ | Chunked recording → transcript → summary + action items; overlay listen/record assist; post-meeting action agent with output ledger |
| 5.1 Saved + searchable history | ✅ | Local JSON store + search |
| 5.2 Custom instructions / preferences | ✅ | System prompt + response style |
| 6.1 Provider abstraction | ✅ | OpenAI-compatible, Anthropic, Gemini, Ollama, and **OpenCode** (0.7.0) |
| 6.1b Borrow what you already run | ✅ | **0.7.0: "Local models & agents"** — Klyro probes the services already running on the machine and offers one-click connect, with **no API key**: OpenCode (a local `opencode serve`, which answers with *your* OpenCode account, its free models and its limits), Ollama, LM Studio, LiteLLM, vLLM, and local bridges to other IDEs' subscriptions. The OpenCode provider speaks the server's published HTTP API (v1 and v2 generations), so a password-protected server works too |
| 6.2 Configurable endpoints | ✅ | Per-provider Base URL + model |
| 6.3 Secure API keys | ✅ | Encrypted at rest via Electron `safeStorage` |
| 6.4 Error handling / timeouts | ✅ | Errors surfaced per message; a stalled stream fails after 90s of silence instead of hanging |

## Part 2 — Differentiating features

| Feature | Status | Notes |
| --- | --- | --- |
| 7. Autonomous desktop agent | 🟡 | Observe → plan → act loop with per-action confirmation, cancellation, and persisted task history. Requires a system input backend (see below). |
| 8. Persistent personal memory | ✅ | Local store, BM25 recall injected into every prompt, pinning, near-duplicate suppression, optional automatic fact extraction |
| 9. Integrations (GitHub, Drive, …) | 🟡 | GitHub done (account, repos, issues, create issue). **MCP connector done**: bring-your-own local stdio MCP servers — list tools, invoke tools, every call audited. **Tool-calling in chat done (0.3.2)**: opt-in — chat can call MCP tools through an approval-gated loop (Allow/Deny per call, max 5 tool rounds, audited). Drive/others planned |
| 10. AI coding mode | ⬜ | Deliberately cut in 0.3.1: "work on code" belongs to the desktop agent (which any editor/index can feed via MCP). No coding surface of its own |
| 11. Reusable skills / workflows | ✅ | Named multi-step workflows, 3 built-ins (standup, notes-to-actions, diff review), custom creation, runs land in a real conversation — one surface (Workflows view), deduplicated |
| 12. Document & research intelligence | 🟡 | Local document import (text, code, HTML, PDF via `pdftotext`, Office via `unzip`) + BM25 grounding. **"Ask about this" (0.3.2)**: ground one chat message in the full text of a pinned document. Web research planned |
| 13. Productivity / task management | 🟡 | Meeting action items, workflow runs, and the **post-meeting action agent**: proposes issues from action items, user approves, Klyro executes, outcomes land in a per-meeting output ledger |
| 14. Trust, security, reliability | 🟡 | Sandboxed renderer with context isolation, origin-validated IPC, encrypted keys, encrypted-at-rest secrets, navigation guards, locked-down CSP, microphone-only permission policy, idle-timeout on model streams, and a **local audit log** (agent actions, MCP tool calls, meeting outputs — exportable as JSON, clearable, never sent anywhere) |
| 15. Speed (consumer path) | ✅ | **Turbo mode (0.4.0)**: the quick-ask overlay answers with the provider's *fast model* (set per provider), a short answer budget, and an **instant replay** cache — the same question about an unchanged screen comes back instantly, labelled as a replay. The overlay reports **time-to-first-token** ("0.84s") under every answer, and the number is also written to the audit log |
| 16. Usage & cost honesty | ✅ | Local per-provider request ledger (Settings → Provider usage): requests, tool calls, failures. **RMS silence gate (0.3.2)**: listen mode skips transcription on silence-only chunks, so quiet meeting minutes cost zero provider calls |

## Desktop agent (Stage B)

The agent captures the primary display, asks the active (vision-capable) model for
the **single next action** as strict JSON, and executes it by synthesising input.
Every loop iteration re-captures the screen, so each decision is made against the
observed result of the previous action.

**Input backends** — Klyro shells out to platform tools and reports honestly when
none is present:

| Platform | Backend | Install |
| --- | --- | --- |
| Linux (X11 / XWayland) | `xdotool` | `sudo dnf install -y xdotool` |
| Linux (native Wayland) | `ydotool` (+ `ydotoold` daemon) | `sudo dnf install -y ydotool` |
| Linux (typing only) | `wtype` | `sudo dnf install -y wtype` |
| macOS | `osascript`; `cliclick` for the mouse | `brew install cliclick` |
| Windows | PowerShell `SendKeys` + `user32` | built in |

Safety: state-changing actions (clicks, typing, Enter/modified keys, or anything the
model flags) pause for an explicit **Approve / Decline** by default
(`agentConfirmConsequential`), the run is cancellable at any point, coordinates are
mapped from screenshot space back to screen space, and completed runs are stored in
`agent-tasks.json`.

## Knowledge (Stage C)

Everything is local: memories, documents, and the ranking index never leave the
device except as part of the prompt you send to your chosen provider.

- **Memory** — a `memory.json` store with tags, pinning, and edits. Before each
  turn the top-K memories for your question are retrieved with **BM25** and added
  to the system prompt. Near-duplicates are suppressed with Jaccard similarity
  (≥ 0.82). Optional *automatic extraction* asks the model to distil durable facts
  from an exchange (default off; never stores secrets).
- **Documents** — import text, Markdown, code, CSV/JSON, HTML, and PDF/Office
  files. Text is extracted (`pdftotext` for PDFs, `unzip` + markup stripping for
  docx/pptx/xlsx/odt), chunked on paragraph boundaries with overlap, and ranked
  the same way. Re-importing a path replaces the previous copy.
- **Grounding** — retrieved memories and excerpts are injected as a clearly
  delimited data block with instructions to treat it as reference, not
  instructions. The chat bubble shows how many memories/excerpts grounded the
  answer.
- **MCP** — the protocol client is the official `@modelcontextprotocol/sdk`
  (0.4.1), so handshake, framing, capability negotiation and timeouts behave
  exactly as the specification says. Klyro lists a server's **tools**,
  **resources** and **prompts**, can read a resource, and calls tools through
  an approval-gated loop. The agent loop, the approval gates and the audit
  trail around it remain ours.
- **Integrations** — GitHub via a personal access token held in the encrypted
  secret store: identify the account, list repositories and open issues
  (PRs flagged), and create issues. Repository identifiers are validated before
  any request leaves the machine.

## Studio (Stage D)

**Meetings mode** — record a meeting (or use the overlay's live assist), transcribe
in chunks, save, summarise, and act on the output: the post-meeting action agent
turns action items into reviewed GitHub issues and records the outcome in a
per-meeting ledger. *(Coding mode was cut in 0.3.1 — file work now flows through
the desktop agent rather than a parallel surface.)*

**Meeting intelligence** — record from the microphone; audio is transcribed in
~15 second chunks and timestamped live. Saving stores the transcript locally and
never uploads it anywhere except for transcription. **Summarize** turns a
transcript into a short summary plus extracted action items (parsed from JSON,
with a bullet-list fallback when a model ignores the format).

**Workflows** — named, multi-step sequences that run inside a real conversation,
so you can keep asking follow-ups afterwards. Steps are either a **prompt**
(`{{input}}` and `{{prev}}` placeholders) or a **GitHub** fetch, and each step's
output feeds the next. Three built-ins ship: *Standup from GitHub issues*,
*Turn notes into action items*, and *Review a diff*.

## First run (0.5.0)

A first-time user does not read feature lists — they need to *see* the product
work. The welcome tour is three steps and about twenty seconds:

1. **Welcome** — what Klyro is, the hotkey (shown as a human-readable
   accelerator), and the three things that matter. If no model is configured
   yet, it says so plainly and offers to add a key, with a link to the
   provider list.
2. **Try it** — the tour captures the screen, asks a suggested question about
   it, and shows the answer with the real latency badge. The question is
   editable, with one-tap suggestions.
3. **Done** — the tour closes and the app is ready.

It never blocks: skip at any point, and Settings has *Show the welcome tour
again* for anyone who wants it later.

## Design system (0.3.4–0.3.5)

The interface is built from a single token set rather than per-page CSS:

- **Type** — bundled Inter Variable for the interface and JetBrains Mono for code
  (no dependence on whatever fonts a machine happens to have).
- **Colour** — one graphite palette, plus a *real* light theme: `system`, `dark`
  and `light` now paint an actual light palette instead of an inverted dark one.
  The theme is applied to `<html>`, so the whole app flips in a single paint.
- **Surfaces** — a five-step elevation scale (base → secondary → raised →
  active → elevated) with layered shadows and hairline borders.
- **Controls** — switches instead of raw checkboxes, custom radios, a styled
  range slider, focus rings on every interactive element, and consistent
  hover/press motion (120–280 ms, and none of it when the OS asks for reduced
  motion).
- **Responsive shell** — the sidebar is a persistent rail on wide windows and a
  drawer below 980 px; the window now opens at 1280 × 820.
- **Review tooling** — `scripts/shots.cjs` boots the built app and captures
  every surface (home, chat, workflows, integrations, panels, overlay, light
  theme) so design changes can be judged on the real pixels, not by imagination.
  `scripts/shot-rail.cjs` measures the collapsed sidebar for overflow.

## Fixes found while reviewing the pixels (0.3.5)

- **Text fields lost the caret after every character.** The panel hook
  re-focused the panel whenever the app re-rendered (panels are handed a new
  `onClose` function each time), so the agent's goal box threw the caret out
  after one keystroke. The close callback now lives in a ref, and there is a
  regression test that fails on the old behaviour.
- **The Screen Assistant page was a duplicate** of the composer's share-screen
  button, and its answer appeared in a different view than the capture. It is
  now one flow inside Chat: capture attaches to the message, answer lands in
  the same conversation. The "Screen" shortcut opens chat with the picker ready.
- **Klyro captured itself.** A full-screen capture included Klyro's own window;
  Klyro now hides for the moment of the capture, and its own windows are
  filtered out of the source picker.
- **The collapsed rail overflowed**: button labels were still rendered in the
  68 px column. Labels are hidden, the workspace icons sit under the brand, and
  the rail is now checked for overflow automatically.
- **The source picker pushed the layout** and could fall off the bottom of the
  window; it is now a compact popover above the composer.
- **Empty conversations sat at the top** of a large empty canvas; the empty
  state is centred and offers "Ask about my screen" directly.
- **Monospace leaked onto buttons** next to the API-key field; the mono font is
  now confined to the key itself.

## Hardening, packaging & release (Stage E)

**Security.** Beyond the Stage A baseline (sandboxed renderer, `contextIsolation`,
origin-validated IPC, encrypted keys), a window may now *only* display Klyro's own
renderer: navigation elsewhere is refused, real links are handed to the user's
browser, embedded webviews cannot attach, and the permission policy grants
microphone capture to Klyro's origin and nothing else. The production CSP is
`default-src 'none'` with `object-src`, `base-uri`, `form-action` and
`frame-ancestors` all disabled.

**Accessibility.** Dialog semantics (`role="dialog"`, `aria-modal`) with focus moved
into the panel on open, Escape to dismiss every panel, a live region for the chat
transcript, labelled icon-only buttons, tab roles with `aria-selected`, visible
focus rings, and `prefers-reduced-motion` support.

**Performance.** The panels are code-split and load on first open, which also defers
their data fetching, cutting the startup bundle from 656 kB to 594 kB (the rest
lands in four chunks of 7–25 kB). The packaged asar keeps only runtime files:
6.76 MB → 3.19 MB, with dependency licences retained.

**Reliability.** Every model call is wrapped in an idle-timeout guard: 90 seconds
of silence fails the request with a clear message instead of an endless spinner.

**Packaging.** `npm run pack:linux` / `pack:win` produce unpacked builds;
`npm run dist:linux` produces an **AppImage** and a **deb** (verified metadata,
dependencies, desktop entry, icons and `StartupWMClass`), and `dist:win` produces
the **NSIS** installer. `npm run smoke` boots the built app and asserts both windows
render, the preload bridge is present, and the renderer logged no errors.

## Delivery stages

- **Stage A (done):** desktop shell, global shortcut, chat, screen
  understanding, voice input, history, provider config.
- **Stage B (done):** reliable computer-use automation (input control,
  verification, permissions, cancellation, recovery).
- **Stage C (done):** personal memory, local document understanding, first
  integrations.
- **Stage D (done):** meeting intelligence, reusable workflows; coding mode later cut (see 0.3.1).
- **Stage E (done):** performance, security hardening, accessibility, packaging,
  release automation.

## Known limitations

- Voice transcription requires an OpenAI-compatible provider (or local Whisper).
- Desktop automation requires a system input backend (`xdotool` / `ydotool` /
  `wtype` on Linux, `cliclick`/Accessibility on macOS, PowerShell on Windows).
  Klyro detects this at runtime and shows the exact install command.
- The agent plans one action per screenshot and re-observes after acting; it does
  not yet run a separate verifier pass or learn from failures across runs.
- Automation is limited to the primary display.
- PDF import needs `pdftotext` (poppler-utils) and Office import needs `unzip`;
  Klyro reports this per file rather than failing silently.
- Retrieval is lexical (BM25) — no embeddings yet, so paraphrases can be missed.
- Code citations are file-level; the index does not yet carry line ranges.
- Meeting transcription cuts at ~15 second boundaries, so a word spanning a cut
  can be lost; there is no live in-call overlay.
- GitHub is the only integration so far.
- Global shortcut registration fails silently if the OS already reserves it.
- Windows installers must be built on Windows: electron-builder needs Wine to run
  NSIS from Linux. The Linux build can still produce `release/win-unpacked` (a real
  `Klyro.exe` with correct version resources and icon) for inspection.
- macOS is not a supported release target; the `dmg` target exists but is untested.
- The smoke check needs a display; on CI it runs under `xvfb-run`.
- Code signing and notarisation are not configured — Windows SmartScreen and
  Linux users will see an unsigned build.
