# The Klyro daemon (`klyro-core`)

`klyro-core` is the part of Klyro that answers questions. It is a small Rust
process — a few megabytes, started in milliseconds — that speaks to the model
providers directly, so the overlay's answer does not wait on a browser runtime.
Electron stays the control panel: settings, history, the window itself.

## Why

The overlay is opened mid-meeting and must answer within a second or two. The
Electron main process is a fine control panel but an expensive hot path: it
carries a whole Chromium runtime on the side. The daemon owns only the work
between "the question is ready" and "the answer is complete".

## Transport

Loopback TCP, not a Unix socket: a named pipe would not survive the Windows
build, and a loopback socket works the same on all three platforms.

- The daemon listens on `127.0.0.1` on a port the OS chooses.
- It writes `$KLYRO_STATE_DIR/klyro-core.json` (mode `0600`) with `port`,
  `token`, `pid` and `version`.
- The app reads that file, connects to the port, and authenticates with the
  token as its first line. Without it the daemon closes the connection.

The token exists because a loopback port is reachable by every process on the
machine: the port alone must not be enough to spend the user's tokens.

## The protocol

One JSON object per line, in both directions. The daemon speaks first.

```jsonc
// daemon → app, on connect
{ "kind": "hello", "version": "0.1.0", "pid": 1234 }

// app → daemon: the token, before anything else
{ "kind": "auth", "token": "…" }

// app → daemon: the providers it may use, keys included
{ "kind": "configure", "providers": [
    { "id": "ollama", "base_url": "http://127.0.0.1:11434/v1", "model": "qwen3", "api_key": null }
]}

// app → daemon: what can this provider serve?
{ "kind": "models", "provider": "ollama" }
{ "kind": "models", "models": [ { "id": "qwen3", "name": "Qwen 3", "provider": "ollama" } ] }

// app → daemon: ask a question
{ "kind": "ask", "provider": "ollama", "model": "qwen3",
  "base_url": "http://127.0.0.1:11434/v1", "api_key": null,
  "prompt": "What is on my screen?",
  "images": [ { "data_url": "data:image/png;base64,…", "mime": "image/png" } ],
  "binary": "", "port": 0, "csrf": "" }

// daemon → app: the answer, as it arrives
{ "kind": "delta", "text": "A tool used" }
{ "kind": "delta", "text": " primarily" }
{ "kind": "done", "ms": 412 }

// daemon → app: something went wrong, in words worth showing
{ "kind": "error", "message": "Could not reach the provider: connection refused" }
```

`binary`, `port` and `csrf` are only used by the providers that need them:
the agent CLIs are programs (`binary`), Antigravity is a Connect-RPC service on
a port with a token (`port`, `csrf`).

### Where the keys live

The daemon never reads the encrypted secret store — that is Electron's
`safeStorage`, and only Electron can decrypt it. The app holds the keys and
hands them to the daemon over the socket, in memory, when it configures it.

That means the daemon can outlive the app: the app can quit and the daemon
keeps answering, with the keys it was given. It also means the keys are never
written to a second file.

## What is implemented

Every provider Klyro has, in Rust:

| Provider | Transport | Notes |
| --- | --- | --- |
| OpenAI, Groq, OpenAI-compatible | `POST /chat/completions`, SSE | the answer streams |
| Ollama | `POST /api/chat`, NDJSON | native API, `/v1` stripped |
| OpenCode | `POST /api/session`, prompt, then poll | the turn ends with an `idle` entry |
| Claude Code | `claude -p --output-format stream-json --verbose` | the user's own login |
| Codex | `codex exec <prompt>` | the user's own login |
| Antigravity | Connect-RPC `GetModelResponse` | the IDE's own language server |

The local agents keep their own semantics rather than being flattened into one
shape: OpenCode's turn is a session, the CLIs are processes, Antigravity is a
request with a CSRF token. What the daemon does not change is the answers —
the same binaries, the same endpoints, the same models.

When the daemon is absent or has stopped, the app answers the question itself
with the same clients, so a broken daemon degrades to a slower answer, not to
silence. When Antigravity's service is not reachable, the app answers it too:
it can say which window to open.

### The tests

`cargo test` speaks each protocol against a fake of the real thing:

- an OpenCode server that refuses a wrong HTTP method (the real one does) and
  reports a failed turn with its own reason;
- a Claude Code CLI that writes the same JSON lines as the real one, including
  the picture on stdin;
- a Codex CLI that answers on stdout;
- an Antigravity service that checks the Connect-RPC path, the CSRF header and
  the model in the body.

## What comes next

- The capture: screen, window, and the system-audio loopback the meeting
  assist records.
- The overlay itself, as a native window, so opening it costs a window and
  not a renderer.
- The hotkey, so the overlay is up before the keystroke has finished.
- Antigravity's own service, started by the daemon rather than the app, so the
  IDE need not run at all.

## Building and running it

```sh
cd crates/klyro-core
cargo build --release
./target/release/klyro-core
```

It writes `klyro-core.json` to `$KLYRO_STATE_DIR`, or `~/.config/klyro` by
default. `RUST_LOG=debug` turns on the logs.

`scripts/check-daemon.mjs` drives it end to end: it says hello, lists a
provider's models and asks a question.
`scripts/check-agents-through-daemon.cjs` asks OpenCode and Claude Code
through the app, so the daemon's local agents are exercised the way the
overlay uses them.
