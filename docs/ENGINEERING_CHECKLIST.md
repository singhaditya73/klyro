# Klyro — Engineering Completion Checklist

This document tracks the production-hardening program that runs after v0.2.0.
The UI/branding redesign is deliberately out of scope for this program.

## Baseline audit (before changes)

| Item | Value |
| --- | --- |
| Branch | `main` @ `ff08366` |
| Version | `0.2.0` |
| TypeScript files | 72 |
| Tests | 92 passing / 11 files |
| Typecheck | clean |
| Build | clean (renderer bundle 594.49 kB) |
| Package scripts | `typecheck`, `test`, `build`, `smoke`, `pack:*`, `dist:*`, `icons` |

### Baseline findings (verified by reading the code)

- **Agent (`domains/agent.ts`, `agent-plan.ts`, `automation.ts`)**
  - A successful input-backend call is recorded as `executed` with no check that
    the screen actually changed. Submitted ≠ executed ≠ observed ≠ complete.
  - `coerceAction` is lenient: it silently drops invalid fields and never rejects
    out-of-range coordinates, oversized text, or malformed key combos.
  - Risk is a single boolean heuristic (`isConsequential`) in `agent-plan.ts`,
    not a central, versioned, main-process-enforced policy.
  - No bounded recovery for backend failures, stale frames, or provider errors.
  - No task duration / model-call limits; cancellation relies on the `AbortController`
    being observed but progress state is not explicit.
  - No crash recovery: a task left running when the app exits stays `running` forever.
  - No pause/resume.
  - Capability detection only checks executable presence (`command -v`); it never
    verifies that a backend actually works and reports a single boolean `available`.
- **Security**
  - `secrets.ts` silently falls back to plaintext when `safeStorage` is unavailable;
    the renderer has no way to know or to opt out.
  - Several IPC handlers coerce with `String(...)` / `Boolean(...)` without a schema
    (`conversation*`, `github*`, `meetingDelete`, `knowledgeSearch`, `agentConfirm`).
  - Untrusted content (screenshots, docs, issues, transcripts) is not consistently
    labelled/delimited as data in every prompt path.
- **Retrieval** — BM25 only, no automated evaluation; citations are file-level.
- **Workflows** — steps have no IDs, no timeouts, no retry/failure policy, no named
  outputs, no persisted run state, and no pre-run validation.
- **Coding mode** — full re-index on every run (no incremental invalidation); no
  exclusions for `.env`/secrets; no line-range citations; no diff/apply.
- **Meetings** — chunk retries can duplicate segments; no structured fallback.
- **Providers** — errors are plain strings (no categories), no retry on transient
  failures or rate limits.
- **Storage** — atomic writes are good; no corruption quarantine/backup, no
  pagination for large conversation histories.

## Implementation order & status

Legend: ✅ done+tested · 🟡 implemented, not fully verified · ⛔ blocked (external) · ⬜ deferred

| Phase | Item | Status |
| --- | --- | --- |
| A | A1 strict versioned action schema + post-action verification | ✅ |
| A | A2 bounded failure recovery with backoff | ✅ |
| A | A3 task lifecycle, limits, pause/resume, crash recovery | ✅ |
| A | A4 central main-process risk policy + approval revalidation | ✅ |
| A | A5 capability probe, Wayland/X11 + per-backend diagnostics | ✅ |
| A | A6 mocked-backend integration tests | ✅ |
| B | B1 IPC boundary validation hardening | ✅ |
| B | B2 honest secure-storage fallback + redaction | ✅ |
| B | B3 prompt-injection labeling + adversarial fixtures | ✅ |
| B | B4 privacy/retention controls + indexing exclusions | ✅ |
| C | C1 retrieval evaluation suite | ✅ |
| C | C2 retrieval improvements + source citations | ✅ |
| C | C3 hybrid embedding retrieval | ⬜ deferred (eval did not justify it) |
| C | C4 memory quality (conflicts, provenance, corrections) | ✅ |
| D | D1 versioned workflow model + validation | ✅ |
| D | D2 durable execution lifecycle | ✅ |
| D | D3 typed reusable workflow tools | ✅ |
| D | D4 multi-step evaluation with mocked services | ✅ |
| E | E1 incremental indexing + exclusions + safe paths | ✅ |
| E | E2 line-range citations + diff/apply with approval + revert | ✅ |
| F | F1 meeting chunk dedup/retry + structured extraction | ✅ |
| G | G1 common integration contract | ✅ |
| G | G2 Google Calendar / Email / Slack / Drive | ⛔ blocked on OAuth credentials |
| H | H1 provider error categories, retry, rate-limit handling | ✅ |
| H | H2 model routing guardrails | ✅ |
| I | I1 storage hardening, pagination, temp cleanup | ✅ |
| J | J1 release verification docs + signing/updates notes | ✅ |
| J | J2 opt-in crash/diagnostics reporting | ✅ |
| J | J3 documentation refresh | ✅ |

## Commands

```bash
npm run typecheck
npm test
npm run build
npm run smoke        # needs a display; CI uses xvfb-run
```
