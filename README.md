# Klyro

> **Your AI. Your entire computer.**
> *Understand. Remember. Act.*

Klyro is a cross-platform (Windows / macOS / Linux) desktop AI assistant. It can
see your screen, hear your audio, remember your context, connect your tools, and
perform real tasks across applications — with your explicit permission at every
step.

This is an **independent implementation**. No proprietary third-party source code
or assets are used.

## Status

Early development. See `docs/FEATURE_MATRIX.md` for what is implemented,
partial, or planned.

## Architecture

```
src/
  main/            Electron main process (Node)
    domains/       Feature domains: windows, settings, chat, screen,
                   shortcuts, tray, permissions, conversations, automation, agent
    providers/     Model provider abstraction (OpenAI-compatible, Anthropic,
                   Gemini, Ollama/local)
    store/         Atomic JSON persistence
    security/      Encrypted secret storage (Electron safeStorage)
  preload/         contextBridge API (no Node in the renderer)
  renderer/        React + TypeScript UI
  shared/          Types + IPC contract shared by main/preload/renderer
```

Security posture: `contextIsolation` on, `nodeIntegration` off, sandboxed
renderer, origin-validated IPC, and API keys stored encrypted at rest — never in
the frontend bundle.

## Getting started

```bash
npm install
npm run dev          # launch in development
npm run typecheck    # type-check main + renderer
npm test             # unit tests
npm run build        # production build
npm run dist         # package for the current OS
```

### AI providers

Klyro is provider-agnostic. Open **Settings → Providers**, choose a provider,
paste your API key (stored encrypted locally), and pick a model:

- **OpenAI-compatible** (OpenAI, Azure, OpenRouter, LM Studio, …)
- **Anthropic** (Claude)
- **Google Gemini**
- **Local** (Ollama at `http://localhost:11434`) — no cloud key required

### Desktop agent

Klyro can carry out multi-step tasks on your computer: it captions the current
screen, asks a vision-capable model for the single next action, executes it, and
re-observes. Open the **Agent** panel, describe a goal, and press *Run task*.

State-changing actions (clicks, typing, Enter or modified keys) pause for
**Approve / Decline** by default; the run can be stopped at any time and every
completed task is saved to your local history.

Driving the mouse and keyboard needs a system input backend. Klyro detects what
is available and shows the command to install one:

| Platform | Backend |
| --- | --- |
| Linux (X11 / XWayland) | `xdotool` |
| Linux (native Wayland) | `ydotool` (+ `ydotoold`) |
| Linux (typing only) | `wtype` |
| macOS | `osascript` + `cliclick` (mouse), Accessibility permission |
| Windows | built in (PowerShell) |

## License

MIT © 2026 Aditya Singh
