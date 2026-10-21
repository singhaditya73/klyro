# Klyro — what this product is, and what stays in it

**Klyro is a meeting and interview assistant.** One job: you press a key, ask a
question about what is on your screen or what was just said, and you get an
answer without leaving the app you are in — and without the other people in
the call seeing it.

This document is the decision record for that focus. It says what is kept, what
is removed, and why. It was written after reading the whole codebase, not from
memory.

## The shape of the thing

```
        ┌──────────────────────────┐
hotkey →│  overlay (the product)   │→ answer, streamed
        │  always-on-top, private  │
        └──────────────────────────┘
                    │
        ┌──────────────────────────┐
        │  the engines             │
        │  screen · audio · models │
        └──────────────────────────┘
                    │
        ┌──────────────────────────┐
        │  control panel (the app) │
        │  providers · privacy ·   │
        │  usage · audit            │
        └──────────────────────────┘
```

The overlay is the product. The main window is not a workspace any more — it
is the control panel: which models you can use, what is stored, what has been
sent to the cloud. The tray and the global hotkey are the only ways most
users will ever touch it.

## Kept — because the product needs it

| Area | Why it stays |
| --- | --- |
| **Overlay** (`OverlayApp.tsx`, `windows.ts`, `shortcuts.ts`) | The product. Hotkey → question → answer, with screen context, talk mode, listen mode, private mode. |
| **Screen capture** (`screenshot.ts`) | Screen context, the self-hiding capture, and the privacy probe that measures whether the overlay really is excluded from captures. |
| **Audio / transcription** (`audio.ts`, `lib/listen.ts`) | "What did they just say?", and answers that use the meeting as context. Audio is transcribed in memory and never written to disk. |
| **All ten providers** (`providers/*`) | The promise: use the models and agents you already have access to, with their own authentication. OpenAI, Anthropic, Gemini, Groq, Ollama, any OpenAI-compatible server, **OpenCode**, **Claude Code**, **Codex**, **Antigravity**. |
| **Local agent plumbing** (`local-agents.ts`, `local-agent-launcher.ts`, `antigravity*.ts`) | One-click connect to a local OpenCode server, the agent CLIs, and Antigravity (connect once, then the IDE never has to be open). |
| **Model catalogue** (`provider-models.ts`) | The model picker: every provider is asked what it has. |
| **Chat pipeline** (`chat.ts`, `conversations.ts`, `answer-cache.ts`) | The overlay sends through it. The answer cache is what makes a repeated question instant. |
| **Settings** (`settings.ts`) | Provider slots, keys, the fast model, the hotkey, overlay opacity, capture behaviour. |
| **Credentials** (`security/secrets.ts`) | OS-encrypted, never re-read into the page, plaintext refused unless explicitly allowed. |
| **Privacy** (`privacy.ts`) | What is stored, what is cleared, and whether the active provider is local or remote. |
| **Usage + audit** (`usage.ts`, `audit.ts`) | Per-provider request counts, and an append-only local log of what happened. |
| **Windows, tray, shortcuts, permissions, maintenance, diagnostics** | The shell around the overlay. |

## Removed — because it is not this product

| Removed | Why |
| --- | --- |
| **The chat workspace** (Home, Chat, Sidebar, Composer, MessageBubble, `useChat`) | A conversation app is a different product. The overlay already has its own input, its own streaming and its own history. |
| **The desktop agent** (`agent*.ts`, `automation.ts`, `AgentPanel`, `useAgent`, `lib/agent`) | It drives the mouse and keyboard. Nothing in "answer my question during a meeting" needs that, and it is a large attack surface on a machine that is also holding a meeting. |
| **Workflows** (`workflows*.ts`, `WorkflowsView`) | A batch feature for the workspace, not the overlay. |
| **Meetings / Studio** (`meetings.ts`, `actions*.ts`, `StudioPanel`) | Record-then-summarise-later is a different product from "answer me now". (The surface was already unreachable in the shipped UI.) |
| **GitHub integration** (`integrations/*`) | Filing issues is a workspace action, not an overlay action. |
| **Knowledge base** (`memory.ts`, `documents.ts`, `context.ts`, `knowledge/*`, `KnowledgePanel`) | **Kept.** The assistant's own knowledge is what makes an answer worth hearing: a student's resume, their projects, the documents they were sent. A grounded answer in a meeting is the whole point. (An earlier draft of this document removed it — that was wrong.) |
| **MCP client + import** (`mcp.ts`, `mcp-import.ts`, `McpSection`) | A tool protocol, useful where an agent acts on a codebase. The overlay answers questions; it does not act. **This moves to the IDE product** — the client, the import and the "run a tool" UI come back there. |

Nothing in the removed list was broken, and nothing in the kept list was
touched. The removals are: surfaces the user cannot reach in a meeting, and
one subsystem (MCP) that is explicitly headed for the IDE product.

**What was removed, and what stayed, in one line each:**

- The desktop agent drove the mouse and keyboard — not needed to answer a
  question, and a large attack surface on a machine that is holding a
  meeting.
- Workflows are a batch feature for a workspace.
- The Meetings/Studio surface records a meeting and acts on it afterwards —
  a different product from "answer me now". *(It was already unreachable in
  the shipped UI.)*
- GitHub files issues; the overlay does not file things.
- MCP is a tool protocol for agents that act on code — it moves to the IDE
  product, and the chat tool loop goes with it.
- **The knowledge base stayed**: a resume, a project description, a document
  you were sent — the assistant grounds its answer in what it knows about
  you. That is the difference between a useful answer and a generic one.

## Improved — the work this product actually needs

The audit found the product already does the hard parts. What it does *not* do
is be fast, private and quiet enough for a live meeting.

### 1. Latency

- **Overlay startup** — the window is created at launch, so the hotkey only
  pays a fade. Keep it that way, and keep the daemon warm.
- **Context** — the chat pipeline sends up to 40 turns of history. An overlay
  question does not need a transcript; it needs the screen, the question and
  the last line or two. The overlay gets a short context.
- **Concise answers** — the overlay already caps the answer (400 tokens,
  lower temperature). Make the *default* style for the overlay "one or two
  sentences", not "Balanced".
- **Model selection** — the fast model is a separate slot from the main model.
  It should default to the fastest thing that can read a screenshot, and the
  picker should say how fast each option is.

### 2. Privacy

- **Configurable retention** — how long conversations, the usage ledger and
  the audit log are kept. A meeting assistant should be able to keep nothing.
- **Private sessions** — a session that is never written to disk: no
  conversation, no usage entry, no audit entry. Just the answer.
- **No secrets in logs** — the logger must never see a prompt, an answer, a
  transcript, a key or a captured frame. A screenshot is never logged, not even
  its size.
- **Clear capture controls** — what is captured, when, and what leaves the
  machine, shown in the control panel and in the overlay itself.
- **Honest cloud disclosure** — when the answer goes to a cloud provider, the
  overlay says so. A local model is preferred when the user picks one.

### 3. Reliability

- The overlay must never steal focus, never appear in a share, and never
  leave a process behind. The privacy check (a real capture, a pixel diff)
  stays a first-class feature, not a setting.

## What is not changing

The model and agent integrations stay exactly as they are — every provider,
every authentication path, every configuration. The overlay's own features
(hotkey, screen context, talk mode, listen mode, private mode, instant
replay, model picker) stay. This document describes a **trim**, not a
rewrite: the parts that go are the parts a person would never touch during a
meeting.

## The Rust question

The target is a Rust-based assistant: a small always-on process that owns the
hot path (hotkey → capture → provider → answer) and never makes Electron pay
for it. Electron's footprint is the thing standing between this product and
"instant".

The order that gets there without breaking anything:

1. **Trim** (this release) — one focused product, in the current app. Every
   provider, the overlay and the privacy controls survive; the unrelated
   features are gone. The surface that has to be ported is now small and
   known.
2. **The daemon** — a Rust binary that owns the hot path and speaks a small
   local protocol. The Electron app becomes its control panel.
3. **The native overlay** — the overlay window itself moves to the daemon, so
   opening it costs a native window, not a renderer.

The daemon is the same binary the IDE product will talk to, so the provider
clients, the model catalogue and the privacy primitives are written once.
