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
| 3.3—3.4 Real-time suggestions | ⬜ | Planned (Stage D) |
| 4.1 Meeting transcripts / summaries | ⬜ | Planned (Stage D) |
| 5.1 Saved + searchable history | ✅ | Local JSON store + search |
| 5.2 Custom instructions / preferences | ✅ | System prompt + response style |
| 6.1 Provider abstraction | ✅ | OpenAI-compatible, Anthropic, Gemini, Ollama |
| 6.2 Configurable endpoints | ✅ | Per-provider Base URL + model |
| 6.3 Secure API keys | ✅ | Encrypted at rest via Electron `safeStorage` |
| 6.4 Error handling / timeouts | 🟡 | Errors surfaced; explicit timeouts planned |

## Part 2 — Differentiating features

| Feature | Status | Notes |
| --- | --- | --- |
| 7. Autonomous desktop agent | 🟡 | Observe → plan → act loop with per-action confirmation, cancellation, and persisted task history. Requires a system input backend (see below). |
| 8. Persistent personal memory | ⬜ | Stage C |
| 9. Integrations (GitHub, Drive, …) | ⬜ | Stage C |
| 10. AI coding mode | ⬜ | Stage D |
| 11. Reusable skills / workflows | ⬜ | Stage D |
| 12. Document & research intelligence | ⬜ | Stage C |
| 13. Productivity / task management | ⬜ | Stage D |
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

## Delivery stages

- **Stage A (done):** desktop shell, global shortcut, chat, screen
  understanding, voice input, history, provider config.
- **Stage B (in progress):** reliable computer-use automation (input control,
  verification, permissions, cancellation, recovery). ← current
- **Stage C:** personal memory, local document understanding, first integrations.
- **Stage D:** coding mode, meeting intelligence, reusable workflows.
- **Stage E:** performance, security hardening, accessibility, packaging, release.

## Known limitations

- Voice transcription requires an OpenAI-compatible provider (or local Whisper).
- Desktop automation requires a system input backend (`xdotool` / `ydotool` /
  `wtype` on Linux, `cliclick`/Accessibility on macOS, PowerShell on Windows).
  Klyro detects this at runtime and shows the exact install command.
- The agent plans one action per screenshot and re-observes after acting; it does
  not yet run a separate verifier pass or learn from failures across runs.
- Automation is limited to the primary display.
- Global shortcut registration fails silently if the OS already reserves it.
