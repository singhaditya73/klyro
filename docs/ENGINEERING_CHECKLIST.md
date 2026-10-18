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
| A | A1 strict versioned action schema + post-action verification | ✅ verified |
| A | A2 bounded failure recovery with backoff | ✅ verified |
| A | A3 task lifecycle, limits, pause/resume, crash recovery | ✅ verified |
| A | A4 central main-process risk policy + approval revalidation | ✅ verified |
| A | A5 capability probe, Wayland/X11 + per-backend diagnostics | ✅ verified |
| A | A6 mocked-backend integration tests | ✅ verified |
| B | B1 IPC boundary validation hardening | ✅ verified |
| B | B2 honest secure-storage fallback + redaction | ✅ verified |
| B | B3 prompt-injection labeling + adversarial fixtures | ✅ verified |
| B | B4 privacy/retention controls + indexing exclusions | ✅ verified |
| C | C1 retrieval evaluation suite | ✅ verified |
| C | C2 retrieval improvements + source citations | ✅ verified |
| C | C3 hybrid embedding retrieval | ⬜ deferred (eval did not justify it — see Metrics) |
| C | C4 memory quality (conflicts, provenance, corrections) | ✅ verified |
| D | D1 versioned workflow model + validation | ✅ verified |
| D | D2 durable execution lifecycle | ✅ verified |
| D | D3 typed reusable workflow tools | ✅ verified |
| D | D4 multi-step evaluation with mocked services | ✅ verified |
| E | E1 incremental indexing + exclusions + safe paths | ✅ verified |
| E | E2 line-range citations + diff/apply with approval + revert | ✅ verified |
| F | F1 meeting chunk dedup/retry + structured extraction | ✅ verified |
| G | G1 common integration contract | ✅ verified |
| G | G2 Google Calendar / Email / Slack / Drive | ⛔ blocked on OAuth credentials |
| H | H1 provider error categories, retry, rate-limit handling | ✅ verified |
| H | H2 model routing guardrails | ✅ verified |
| I | I1 storage hardening, pagination, temp cleanup | ✅ verified |
| J | J1 release verification docs + signing/updates notes | ⬜ not started |
| J | J2 opt-in crash/diagnostics reporting | ⬜ not started |
| J | J3 documentation refresh | ⬜ not started |

Status column reflects **verified in this program**, not intent. Only mark ✅ after tests/commands actually passed on this machine.

## Phase log

### Phase C — retrieval evaluation, citations, memory quality (`e989343`)

- `src/main/knowledge/eval.ts`: harness computing recall@k, MRR, injected-context characters and per-query latency over a labelled fixture corpus.
- `src/main/knowledge/retrieval-eval.test.ts`: asserts recall@5 ≥ 0.9 and MRR ≥ 0.7 on keyword queries; asserts the paraphrase family currently scores 0 (the measured justification for deferring C3).
- `chunkDocument` now reports byte offsets and source line numbers; `documents.ts` stores chunk offsets (`{text,start,end,line}`) and migrates legacy `string[]` chunks on read.
- `KnowledgeHit` gained `line`/`path`; document recall/search label hits `name:line`; `context.ts` and `code.ts` cite them; `CodeAssistResult.citations` is surfaced in the Studio panel.
- `memory.ts`: `origin` provenance, polarity-based conflict detection (`conflicts()`), auto-extracted facts can no longer contradict known facts, hedged/speculative statements are never persisted, extraction skipped for trivial exchanges.
- Tests: 163 passing, typecheck clean, build clean.

### Phase D — durable workflow engine (this commit)

- `workflow-spec.ts` (pure): schema version, `validateWorkflow` (per-kind required fields, bounded retries/timeouts, unique output keys, no forward/unknown `{{steps.x}}` references), `resolveSteps` (stable ids, defaults, unique outputs), `normalizeWorkflow` (upgrade legacy definitions on read), `describeStep`.
- `workflows.ts`: tool registry keyed by step kind — `prompt`, `githubIssues`, `githubCreateIssue` (flagged consequential), `projectSearch`, `knowledge`, `meetingSummary`; per-step timeout (default 120 s) and bounded retries with backoff; `onFailure: stop | continue`; durable run records (`WorkflowRun`, per-step status/attempts/timestamps) persisted to `workflows.json` and capped at 50; cancelled runs mark pending steps `skipped`; runs left `running` by a crash are marked `interrupted` on startup; `runs()` and `cancel(runId)` exposed over IPC.
- Built-ins upgraded to v2 and given real ids/outputs; new `builtin:meeting-follow-ups`; `builtin:explain-area` now grounds itself in the indexed project.
- `src/main/util/with-timeout.ts` (+ tests): rejects on deadline and asks the work to abort.
- UI (no redesign): "Stop run", truthful run status in the result, and a compact "Recent runs" list.
- Tests: 187 passing, typecheck clean, build clean.

### Phase E — safe modification + incremental indexing (this commit)

- `src/main/util/diff.ts` (+ tests): dependency-free line diff (LCS with a coarse fallback for very large inputs), hunk grouping with context, unified-diff text. A trailing newline counts as a real change, so the "did anything change?" guard is honest.
- `patches.ts` (+ tests): propose → review → apply → revert. Nothing is written until approval; a diff is only applied when the file still matches the hash it was built from; a backup copy is taken first and revert restores it (reverting a newly created file deletes it). Paths are confined to the indexed project root and credential files are refused outright.
- `project.ts`: indexing is now incremental — files whose size and mtime match the last scan keep their chunks, changed files are re-read, and files that vanished are dropped. `ProjectStatus.lastScan` reports added/updated/reused/removed.
- `retrieval.ts`/`documents.ts`: chunks carry an end line; citations render as `file.ts:12-40` via `knowledge/locations.ts`.
- UI (no redesign): the indexed-project section shows what the last scan did, and the code tab gains "Edit a project file" with a diff preview plus Apply / Discard / Revert.
- Tests: 207 passing, typecheck clean, build clean, smoke OK.

### Phase F — meeting & transcription reliability (this commit)

- `knowledge/transcript.ts` (+ tests): pure chunk-assembly rules — silence/artefact
  detection (`[BLANK_AUDIO]`, `(inaudible)`, `[Music]`, a lone "you"), word-level
  boundary de-duplication (≥3 repeated words are stripped, so a cut boundary does
  not repeat the previous chunk), exact-repeat rejection (a retried chunk is never
  appended twice), and whitespace/bullet normalisation.
- `meetings.ts`: the main process now owns the in-progress transcript
  (`appendTranscript`, `markTranscriptGap`), persists it as it grows, and exposes it
  for recovery after a crash (`liveTranscript`, `discardLiveTranscript`). Saving a
  meeting re-cleans the segments and clears the draft, so a stored meeting never
  contains a duplicated or artefact segment.
- Retry: a failed chunk is retried once by the renderer; if it still fails the
  transcript records an explicit gap marker and the UI says so, rather than losing
  audio silently.
- Action items: `parseMeetingSummary` accepts `actions`/`actionItems`/`action_items`/
  `followUps`, tolerates a string payload, strips bullets/quotes, truncates, and
  de-duplicates (max 20).
- Temp audio: transcription builds a `Blob`/`FormData` in memory — verified there is
  no temp file for audio anywhere in `src/main` — and the patch writer now removes
  its `.klyro-tmp` file if the rename fails.
- Tests: 223 passing, typecheck clean, build clean, smoke OK.

### Phase H — provider robustness (this commit)

- `providers/errors.ts` (+ tests): one taxonomy for why a call failed (`auth`,
  `quota`, `rate_limit`, `timeout`, `network`, `server`, `bad_request`,
  `not_found`, `cancelled`, `unsupported`, `unknown`) with a `retryable` flag and
  the server's `Retry-After` hint. Messages name the provider and say what to fix
  ("OpenAI rejected the API key (401). Check the key in Settings."). Provider text
  is redacted before it is shown or logged, so a key echoed in an error body can
  never reach the UI or the log.
- `providers/retry.ts` (+ tests): bounded exponential backoff with jitter that
  retries only what could improve. A short `Retry-After` is honoured; an
  unreasonably long one is reported instead of parking the user. Waits are
  abort-aware.
- `providers/request.ts` (+ tests): the single place every adapter makes its
  request. Retries therefore cover only request establishment — never a stream the
  user has already seen — and the "test connection" buttons report the same
  classified detail a real call would.
- All four adapters (`openai`, `anthropic`, `gemini`, `ollama`) go through it and
  classify mid-stream failures too (a dropped connection becomes "Could not reach
  …", not a raw `TypeError`).
- `providers/routing.ts` (+ tests): resolves provider/model/key/endpoint in one
  place with shipped-default fallback, refuses a hosted provider with no key, keeps
  transcription on Whisper-capable providers, and fails fast (`assertVisionCapable`)
  when the agent's model cannot read images. Used by chat, code, memory, meetings,
  workflows, the agent and transcription.
- `chat.ts` (+ new tests): a stalled stream is now reported as a timeout instead of
  being mistaken for the user pressing Stop; a partial answer keeps the reason it
  was cut off; the Stop control is registered before the first event, so an
  immediate stop is never ignored.
- `agent.ts`: retry decisions come from the taxonomy (a bad key fails once instead
  of burning three model calls), and a stalled planner call fails the *call* — with
  a request-scoped abort — so the run retries instead of hanging forever.
- `util/idle-timeout.ts`: the stall error is delivered before the request is
  aborted, because the abort itself can otherwise win the race (+ regression test).
- UI (no redesign): the provider card warns when the active model cannot run the
  agent.
- Tests: 287 passing, typecheck clean, build clean, smoke OK.

### Metrics (measured, not estimated)
| Measurement | Value | Where |
| --- | --- | --- |
| Keyword-query retrieval recall@5 | ≥ 0.9 (asserted) | `retrieval-eval.test.ts` |
| Keyword-query MRR | ≥ 0.7 (asserted) | `retrieval-eval.test.ts` |
| Paraphrase-query recall@5 | 0 — the measured reason embeddings/hybrid search were not added | `retrieval-eval.test.ts` |
| Injected context per answer | < 400 chars avg on the fixture corpus | `retrieval-eval.test.ts` |
| Retrieval latency | < 25 ms/query on the fixture corpus | `retrieval-eval.test.ts` |
| Provider retry policy | 3 attempts (2 retries), 400 ms base, 4 s cap, `Retry-After` honoured when ≤ cap | `retry.test.ts`, `request.test.ts` |
| Conversation page size | 80 messages (grows via "Load earlier") | `chat.ts`, `useChat.ts` |
| Context window | 40 turns max, 4 most recent images | `chat.ts` |
| Test suite | 299 tests / 34 files passing | `npm test` |

### Phase I — storage hardening, pagination, temp cleanup (this commit)

- `json-store.ts`: unreadable data files are **quarantined** (renamed with a
  `.corrupt-` timestamp suffix) instead of being silently overwritten, so the
  user keeps a recoverable copy. A stray `.tmp` file left by a crashed write is
  detected and removed at startup.
- `storage.ts` + `maintenance.ts`: `measureStorage()` reports data size, file
  count, and patch-backup size. `sweepStorage()` runs once at startup and can be
  triggered from Settings → "Clean up"; it removes unfinished `.tmp` writes and
  any patch backups no applied patch can still revert to.
- Settings panel shows **storage breakdown** (data + edit backups) and the result
  of the last sweep, plus a notice for any quarantined files.
- Conversation history is now **paged** (`getConversation(id, { limit })`) — the
  newest 80 messages load by default, with a "Load earlier" button to grow the
  window. The renderer requests only what it needs, so opening a 5 000-message
  chat stays fast. The model context is also capped (40 newest turns, 4 most
  recent images), preventing unbounded cost growth.
- `patch-backups` directory is swept for orphans; quarantined files are listed
  but never deleted.
- Tests: `json-store.test.ts` (quarantine, temp cleanup, sweep) + existing suite.
  295 tests / 33 files passing, typecheck clean, build clean, smoke OK.

### Phase G1 — common integration contract (this commit)

- `integrations/contract.ts`: every integration implements one client shape —
  a descriptor (`id`, `label`, `auth: 'token' | 'oauth'`, `summary`), a cheap
  `status()` (no network), and `selfTest()` (a fast, read-only call that proves
  the credential works and never leaks it).
- `integrations/registry.ts` (+ tests): the single registry the IPC layer talks
  to. `integrationStatuses()` merges connection state with the last self-test
  result; `testIntegration(id)` runs a self-test and converts any throw into a
  failed result instead of rejecting; unknown ids fail fast.
- `github.ts` implements the contract: `/user` self-test ("Token works —
  connected as @login" / the classified failure).
- Bridge gains `integrationTest`; the Integrations view gets a **Test
  connection** button and shows the last test outcome. Planned providers are
  labelled "OAuth app required" (G2 remains blocked on OAuth credentials).
- Tests: 299 / 34 files passing, typecheck clean, build clean, smoke OK.

## UI redesign addendum (interleaved scope, functionally verified)

The premium graphite/charcoal redesign (graphite surfaces, Lucide icons, Klyro
logo assets, 7-workspace navigation with lazy-loaded panels) is tracked here
even though a visual redesign was not part of the original program.

Runtime verification (clicking every sidebar item in the built app via CDP):

| Sidebar item | Verified behaviour |
| --- | --- |
| Agent | `.agent-panel` side panel opens (lazy chunk loads) |
| Memory | Knowledge `.modal__panel` opens |
| Settings | Settings `.modal__panel` opens (also via Ctrl+,) |
| Workflows | Workspace view swaps to `WorkflowsView` |
| Integrations | Workspace view swaps to `IntegrationsView` |
| Chat / Home | Workspace view swaps |

Fixes that made the panels open:
- `App.tsx` previously called `togglePanel(panel)` **then** `closeAllPanels()`,
  instantly closing the panel the user just opened. Panel opening is now
  "close others first, then open" (`openPanel` helper).
- `AgentPanel`/`KnowledgePanel` are overlay/side panels by design
  (`app--agent` third grid column, `.modal` dialog); they must not be rendered
  as inline workspace children. The duplicated inline renders were removed;
  the overlay `<Suspense>` boundary is their single render site.
- Raw `\uXXXX` escape sequences in JSX text/attributes across redesigned
  components now render their real glyphs (JSX does not process escapes).
- Typecheck restored clean (literal `{{input}}` JSX expressions and unused
  imports in `WorkflowsView`/`StudioPanel`).

Still not externally verifiable here: panel visuals on real screens with
system fonts, and Wayland screen capture (blocked on `xdg-desktop-portal`).

## Commands

```bash
npm run typecheck
npm test
npm run build
npm run smoke        # needs a display; CI uses xvfb-run
```
