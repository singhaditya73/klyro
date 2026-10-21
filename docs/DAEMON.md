# The Klyro daemon (`klyro-core`)

The daemon is the always-on process that owns the hot path: the hotkey, the
capture, the provider call, the answer. The Electron app becomes its control
panel; the overlay becomes its client.

## Why

The overlay has to feel instant. An Electron app cannot: it carries a
browser runtime, a main process, a renderer and a GPU process, and it is
measured on this machine at **851 MB across 10 processes** and over a second
from launch to a usable window.

The daemon is one static binary:

| | Electron app | `klyro-core` |
| --- | --- | --- |
| Start to listening | ~1 s | **2.3 ms** |
| Memory | 851 MB (10 processes) | **4.3 MB** (one process) |
| Binary | ~250 MB of runtime | 2.6 MB, no runtime |

That is the difference between "instant" and "instant-ish" when someone
presses a key in the middle of an interview.

## The protocol

A local socket: a Unix socket on macOS and Linux, a named pipe on Windows. The
socket is created with mode `0600`, so only the user can talk to it.

One JSON object per line, in both directions. The daemon speaks first.

```jsonc
// daemon → app, on connect
{ "kind": "hello", "version": "0.1.0", "pid": 1234, "socket": "/home/you/.config/klyro/klyro-core.sock" }

// app → daemon: the providers it may use, keys included
{ "kind": "configure", "providers": [
    { "id": "ollama", "base_url": "http://127.0.0.1:11434/v1", "model": "qwen3", "api_key": null }
]}

// app → daemon: what can this provider serve?
{ "kind": "models", "provider": "ollama" }
// daemon → app
{ "kind": "models", "models": [ { "id": "qwen3", "name": "Qwen 3", "provider": "ollama" } ] }

// app → daemon: ask a question
{ "kind": "ask", "provider": "ollama", "model": "qwen3",
  "base_url": "http://127.0.0.1:11434/v1", "api_key": null,
  "prompt": "What is on my screen?", "images": [ { "data_url": "data:image/png;base64,…", "mime": "image/png" } ] }

// daemon → app: the answer, as it arrives
{ "kind": "delta", "text": "A tool used" }
{ "kind": "delta", "text": " primarily" }
{ "kind": "done", "ms": 412 }

// daemon → app: something went wrong, in words worth showing
{ "kind": "error", "message": "Could not reach the provider: connection refused" }
```

### Where the keys live

The daemon never reads the encrypted secret store — that is Electron's
`safeStorage`, and only Electron can decrypt it. The app holds the keys and
hands them to the daemon over the socket, in memory, when it configures it.

That means the daemon can outlive the app: the app can quit and the daemon
keeps answering, with the keys it was given. It also means the keys are never
written to a second file.

## What is implemented

- The socket, the protocol, the `hello` handshake.
- The OpenAI-shaped provider family: OpenAI, Groq, any OpenAI-compatible
  server, and Ollama through its own endpoint. The catalogue comes from
  `/models`; the answer streams as server-sent events.
- Images travel as data URLs, the way they already do in the app.

## What comes next

- The local agents, each with its own protocol: **OpenCode** (HTTP),
  **Claude Code** and **Codex** (a CLI), **Antigravity** (Connect-RPC). The
  app already speaks all four; the daemon is where those clients move.
- The capture: screen, window, and the system-audio loopback the meeting
  assist records.
- The overlay itself, as a native window, so opening it costs a window and
  not a renderer.
- The hotkey, so the overlay is up before the keystroke has finished.

## Building and running it

```sh
cd crates/klyro-core
cargo build --release
./target/release/klyro-core
```

It listens on `$KLYRO_STATE_DIR/klyro-core.sock`, or
`~/.config/klyro/klyro-core.sock` by default. `RUST_LOG=debug` turns on the
logs.

`scripts/check-daemon.mjs` drives it end to end: it says hello, lists a
provider's models and asks a question.
