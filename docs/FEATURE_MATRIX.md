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
| 7. Autonomous desktop agent | ⬜ | Highest priority (Stage B) |
| 8. Persistent personal memory | ⬜ | Stage C |
| 9. Integrations (GitHub, Drive, …) | ⬜ | Stage C |
| 10. AI coding mode | ⬜ | Stage D |
| 11. Reusable skills / workflows | ⬜ | Stage D |
| 12. Document & research intelligence | ⬜ | Stage C |
| 13. Productivity / task management | ⬜ | Stage D |
| 14. Trust, security, reliability | 🟡 | Isolation, origin-checked IPC, encrypted keys, visible capture state |

## Delivery stages

- **Stage A (in progress):** desktop shell, global shortcut, chat, screen
  understanding, voice input, history, provider config. ← current
- **Stage B:** reliable computer-use automation (input control, verification,
  permissions, cancellation, recovery).
- **Stage C:** personal memory, local document understanding, first integrations.
- **Stage D:** coding mode, meeting intelligence, reusable workflows.
- **Stage E:** performance, security hardening, accessibility, packaging, release.

## Known limitations

- Voice transcription requires an OpenAI-compatible provider (or local Whisper).
- Screen capture uses thumbnails (fine for vision models; high-DPI capture planned).
- Automation, memory, and integrations are not yet implemented (Stages B–D).
- Global shortcut registration fails silently if the OS already reserves it.
