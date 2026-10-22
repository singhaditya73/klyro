# Klyro — Feature Matrix

Status legend: **✅ done** · **🟡 partial** · **⬜ planned**

> Klyro is a **meeting and interview assistant**. One key opens an overlay on
> top of whatever you are doing; you ask a question about the screen or the
> conversation, and the answer comes back in place — invisible to the people
> you are talking to. It uses the models and agents **you already have**.
>
> The product, and what was deliberately kept and removed, is written down in
> [`docs/PRODUCT-SCOPE.md`](docs/PRODUCT-SCOPE.md).

## Part 1 — The overlay (the product)

| Feature | Status | Notes |
| --- | --- | --- |
| Opens on one key | ✅ | `Ctrl/Cmd+Shift+Space` (configurable). The window is created at launch, so the hotkey pays only for the animation — it fades in like a native panel, and it fades out instead of vanishing. |
| Stays over other apps | ✅ | Frameless, always-on-top overlay with 20–100% opacity and explicit drag handles. |
| Asks a question | ✅ | Type and press Enter. The answer streams in place, with the time-to-first-token under it. |
| **Hears a question and answers it** | ✅ | **0.9.10:** the listen mode records in small slices, watches the room's level, and treats the pause that ends a question as the end of it — so the question is transcribed on its own and answered at once (~2 s, not up to 20 s). Silence is never transcribed, so a quiet meeting costs nothing. |
| Records one question in real time | ✅ | *Record question*: press once when the question starts, once when it ends; Klyro transcribes and answers it. |
| Talks to you | ✅ | *Talk*: the microphone stays open, voice activity detection starts and ends your utterance, and Klyro answers when you stop — with the screen attached. Speak again mid-answer and the answer is cut off: you interrupted. |
| Asks about the screen | ✅ | *Capture screen*: one click takes what is below the overlay (Klyro hides itself for the shot) and attaches it to the next question. A source picker is available when instant capture is off. |
| Hears the meeting | ✅ | System audio (Windows loopback, Linux monitor device, macOS mic fallback) or the microphone. The transcript runs in the overlay. |
| Switches the model mid-meeting | ✅ | The chip next to the input lists the models of **every provider you have connected**, grouped by provider and searchable; picking one switches Klyro to that provider and remembers the choice. Connecting a provider in the control panel shows up here at once — no restart. |
| Keeps out of a share | ✅ | Three routes: **private mode** (excludes the window from captures and live shares on Windows and macOS — the same APIs password managers use), the **overlay screen** (put it on a display you are not sharing), and the **privacy check** (two real captures, compared pixel by pixel, so the number is measured rather than claimed). |
| Instant replay | ✅ | The same question about an unchanged screen comes back instantly, labelled as a replay. |
| Closing | ✅ | Escape closes it when idle. |

## Part 2 — The control panel

| Feature | Status | Notes |
| --- | --- | --- |
| Models & agents | ✅ | Every model and agent you already have, with their own sign-in: OpenAI, Anthropic, Gemini, Groq, Ollama, any OpenAI-compatible server, **OpenCode**, **Claude Code**, **Codex**, **Antigravity**. One click to connect a local server; Klyro reads the password it printed and keeps it encrypted. |
| Antigravity, with the IDE closed | ✅ | Connect once while the IDE is open; Klyro saves the account session and afterwards starts Antigravity's own agent service itself. Verified end to end with the IDE fully closed: the Pro plan, the account, 15 chat models, an answer from Claude Opus 4.6 — through the app and through the Rust daemon. The catalogue also lists internal `MODEL_CHAT_*` aliases (they answer 404) and `tab_*` autocomplete models (they take no conversation); Klyro offers only the ones that answer. |
| A model picker for every provider | ✅ | Filled from the provider itself: Antigravity's catalogue (with the remaining quota on each entry), the OpenCode server, Ollama, the `/models` endpoint of OpenAI, Anthropic, Gemini, Groq and any OpenAI-compatible server, and the ids the Claude Code and Codex CLIs accept. A model that is not advertised can still be typed in. |
| What Klyro knows | ✅ | Memories and documents (text, Markdown, code, CSV, JSON, HTML, PDF, Office), recalled with BM25 and injected into every answer — a resume, a project description, a document you were sent. Optional automatic fact extraction; near-duplicate suppression. |
| Interviews | ✅ | **0.9.11:** every recorded interview, kept on this machine — company, role, date, duration, the questions, the transcript, the answers, your notes and a summary Klyro writes. Search, filter by company or role, bookmark, and see how far you got. One click deletes a session, or all of them. |
| Session context memory | ✅ | **0.9.11:** the decisions and the terms said in a meeting are remembered for the rest of it, and the answers that follow know about them. |
| Answers that fit the question | ✅ | **0.9.11:** a question is read as technical, behavioural, project or general, and the answer is shaped to match. |
| Assistant behaviour | ✅ | System prompt, response style, theme. |
| Desktop | ✅ | Launch at login, the quick-ask shortcut, overlay opacity, instant capture on/off, which display the overlay lives on, the privacy check, and the instant-replay switch. |
| Security & data | ✅ | Credential storage (OS keychain), what is stored and how to clear it, storage on this device, and opt-in crash reports (off by default, local only). |
| Usage and audit | ✅ | Per-provider request counts, and an append-only local log of what happened — exportable as JSON, clearable, never sent anywhere. |
| Permissions | ✅ | Microphone-only permission policy; the screen-permission state is shown honestly. |

## Part 3 — Privacy

| Feature | Status | Notes |
| --- | --- | --- |
| Keys encrypted at rest | ✅ | Electron `safeStorage` (OS keychain). Plaintext is refused unless you explicitly opt in. |
| The overlay is excluded from captures | ✅ | Windows and macOS. **Linux has no per-window exclusion API** — the privacy check says so plainly rather than pretending. |
| Measured, not claimed | ✅ | The privacy check takes two real captures and reports the changed pixels. |
| Nothing leaves the machine unless you say so | ✅ | A local model never sends anything. A cloud provider gets the question and the picture, and the app says which provider is in use and whether it is local. |
| Secrets never reach a log | ✅ | Prompts, answers, transcripts, keys and frames are not logged. |
| Data you can see and clear | ✅ | Counts per scope, one click to clear, a storage report and a clean-up. |
| Configurable retention | ✅ | **0.9.15:** one window covers what Klyro wrote in words — interview transcripts, the chat history and the audit log: 7, 30, 90 or 365 days, or until you delete it. Applied at startup and the moment the window changes. The usage ledger is counts only (no words, no timestamps) and is cleared on demand. |
| Private sessions | ✅ | **0.9.15:** an interview can be ephemeral. The questions, the answers, the transcript and the conversation behind them are held in memory — not in the history file, not in the answer cache, not in the memory extractor — and are gone when Klyro quits. Turn it on for every new session (Settings → History), and a session you decide was worth keeping can be written down deliberately with **Keep this one**. |

## Part 4 — The engines

| Feature | Status | Notes |
| --- | --- | --- |
| Provider abstraction | ✅ | Ten providers, one contract. |
| Pictures reach the model | ✅ | OpenCode (a file whose uri is the image — verified live: the model read a test picture and answered "Red"), Claude Code (stdin), Codex (`--image`), and the hosted providers. Antigravity's model call is a prompt and a model id with nowhere to put an image, so it says so plainly instead of answering as if the screen were blank. |
| The Rust daemon | ✅ | **0.9.9 → 0.9.12:** `klyro-core` owns the hot path — it starts in 2.3 ms and lives in 4.3 MB, where the Electron app is 851 MB across ten processes. It speaks a small JSON-line protocol over loopback with a token, and the app hands it the provider configuration (keys in memory; the daemon never touches the encrypted file). **Every provider is in it** — the OpenAI-shaped family, Ollama, and the local agents: **OpenCode** (its session API), **Claude Code** and **Codex** (their CLIs), **Antigravity** (Connect-RPC). When the daemon is not there, the app answers with the same clients, so a missing daemon costs speed, not the answer. |
| Error handling | ✅ | Failures are surfaced per message with advice; a stalled stream fails after 90 s instead of hanging; a local server that is not running is reported as that, not as a broken internet. |
| Latency | ✅ | The overlay reports time-to-first-token under every answer, and the answer cache makes a repeat instant. |

## Part 5 — Deliberately not here

| Feature | Status | Why |
| --- | --- | --- |
| The chat workspace | ⬜ | A conversation app is a different product; the overlay has its own input and history. |
| The desktop agent | ⬜ | Nothing in "answer my question now" needs a mouse and keyboard, and it is a large attack surface on a machine that is holding a meeting. |
| Workflows | ⬜ | A batch feature for a workspace. |
| The Meetings/Studio surface | ⬜ | Record-then-act-afterwards is not instant assistance. |
| The GitHub integration | ⬜ | Filing issues is a workspace action. |
| The MCP client | ⬜ | A tool protocol for agents that act on code — it moves to the IDE product. |
| An editor | ⬜ | That is the second product: a Rust IDE where the model is yours to choose and each task goes to the cheapest model that can do it. |
