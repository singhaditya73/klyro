# Klyro — Feature Matrix & Plan

Status legend: **✅ done** · **🟡 partial** · **⬜ planned**

## Part 1 — Core assistant capabilities

| Feature | Status | Notes |
| --- | --- | --- |
| 1.1 Floating assistant window | ✅ | Frameless always-on-top overlay window |
| 1.2 Global shortcut to show/hide | ✅ | Default `Ctrl/Cmd+Shift+Space` (configurable) |
| 1.3 Text questions | ✅ | Streaming chat |
| 1.4 Voice input | 🟡 | Record → transcribe via OpenAI-compatible `/audio/transcriptions`; local Whisper supported |
| 1.5 Contextual follow-ups | ✅ | Full conversation history sent to the provider |
| 1.6 Stays accessible over other apps | ✅ | Overlay window |
| 1.7 Window controls / keyboard nav | 🟡 | Basic; more polish planned |
| 2.1 Permission-gated screen capture | ✅ | `desktopCapturer` + explicit source picker |
| 2.2 Ask about screen / region | 🟡 | Full screen + window picker; region crop planned |
| 2.3 Understand text/code/UI | ✅ | Vision models (provider-dependent) |
| 2.4 Conversation context across turns | ✅ | Persisted history |
| 3.1 Microphone capture with consent | ✅ | `getUserMedia` + visible recording state |
| 3.2 Live transcription | 🟡 | Push-to-talk transcription; continuous streaming planned |
| 3.3—3.4 Real-time suggestions | ⬜ | Planned (Stage E) |
| 4.1 Meeting transcripts / summaries | 🟡 | Chunked recording → transcript → summary + action items. No live in-call overlay yet |
| 5.1 Saved + searchable history | ✅ | Local JSON store + search |
| 5.2 Custom instructions / preferences | ✅ | System prompt + response style || 6.1 Provider abstraction | ✅ | OpenAI-compatible, Anthropic, Gemini, Ollama |
| 6.2 Configurable endpoints | ✅ | Per-provider Base URL + model |
| 6.3 Secure API keys | ✅ | Encrypted at rest via Electron `safeStorage` |
| 6.4 Error handling / timeouts | 🟡 | Errors surfaced; explicit timeouts planned |

## Part 2 — Differentiating features

| Feature | Status | Notes |
| --- | --- | --- |
| 7. Autonomous desktop agent | 🟡 | Observe → plan → act loop with per-action confirmation, cancellation, and persisted task history. Requires a system input backend (see below). |
| 8. Persistent personal memory | ✅ | Local store, BM25 recall injected into every prompt, pinning, near-duplicate suppression, optional automatic fact extraction |
| 9. Integrations (GitHub, Drive, …) | 🟡 | GitHub done (account, repos, issues, create issue). Drive/others planned |
| 10. AI coding mode | 🟡 | Workspace indexing + grounded code actions (explain, bugs, tests, refactor, docs). No editor integration yet |
| 11. Reusable skills / workflows | ✅ | Named multi-step workflows (prompt + GitHub steps), 4 built-ins, custom creation, runs land in a real conversation |
| 12. Document & research intelligence | 🟡 | Local document import (text, code, HTML, PDF via `pdftotext`, Office via `unzip`) + BM25 grounding. Web research planned |
| 13. Productivity / task management | 🟡 | Meeting action items and workflow runs; no task board yet |
| 14. Trust, security, reliability | 🟡 | Isolation, origin-checked IPC, encrypted keys, visible capture state, explicit confirmation for state-changing actions |

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
- **Integrations** — GitHub via a personal access token held in the encrypted
  secret store: identify the account, list repositories and open issues
  (PRs flagged), and create issues. Repository identifiers are validated before
  any request leaves the machine.

## Studio (Stage D)

**Coding mode** — point Klyro at a project folder and it indexes the source tree
into the same store as your documents (`node_modules`, build output, lockfiles and
minified bundles are skipped; 512 KB per file, 1500 files, depth 12). Indexed
files then ground *all* answers — normal chat, code actions, and workflow prompts.
Paste a snippet or a diff and choose **Explain / Find bugs / Write tests /
Refactor / Document**; each answer is produced with the most relevant indexed
files attached as reference, so it can follow your conventions.

**Meeting intelligence** — record from the microphone; audio is transcribed in
~15 second chunks and timestamped live. Saving stores the transcript locally and
never uploads it anywhere except for transcription. **Summarize** turns a
transcript into a short summary plus extracted action items (parsed from JSON,
with a bullet-list fallback when a model ignores the format).

**Workflows** — named, multi-step sequences that run inside a real conversation,
so you can keep asking follow-ups afterwards. Steps are either a **prompt**
(`{{input}}` and `{{prev}}` placeholders) or a **GitHub** fetch, and each step's
output feeds the next. Four built-ins ship: *Standup from GitHub issues*, *Explain
an area of the codebase*, *Turn notes into action items*, and *Review a diff*.

## Delivery stages

- **Stage A (done):** desktop shell, global shortcut, chat, screen
  understanding, voice input, history, provider config.
- **Stage B (done):** reliable computer-use automation (input control,
  verification, permissions, cancellation, recovery).
- **Stage C (done):** personal memory, local document understanding, first
  integrations.
- **Stage D (in progress):** coding mode, meeting intelligence, reusable
  workflows. ← current
- **Stage E:** performance, security hardening, accessibility, packaging, release.

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
