# Changelog

All notable changes to Klyro are recorded here. Versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.9.19] — 2026-10-22

The model selector, fixed: it shows a name instead of an internal id, and it
fits inside the overlay.

### Fixed
- **The overlay's model menu was clipped by the overlay itself.** The window is
  small and the menu hung below the chip, so the search box and the options
  were cut off. The menu now takes the room the window actually has: it opens
  upwards when there is more room above, it is never taller than the window,
  and the list scrolls inside it, so the search box and every option stay
  reachable. In the overlay the window grows for as long as the menu is open
  and gives the room back when it closes.
- **The model showed as an internal id.** `MODEL_PLACEHOLDER_M50` is what
  Antigravity's catalogue calls a model; the name is "Claude Opus 4.6". When a
  provider is not listing its models — an IDE closed, a server stopped — the
  control now shows the name the model had last time it was listed, and the
  provider's name when it has none: "Antigravity · M50" instead of
  `MODEL_PLACEHOLDER_M50`. The ids themselves are untouched.
- **A page could look empty when one thing failed to load.** Home, Models &
  Agents, Settings, Privacy & Data, Knowledge and Interviews now load each
  part on its own, and say which part could not be read. An empty list is
  never mistaken for "nothing is connected".
- **A window that throws no longer goes blank.** The interface is wrapped in
  an error boundary: it says what went wrong and offers a reload.
- **A preload that is a build behind no longer takes the window down.** The
  bridge calls the renderer needs from a newer build are optional now.

## [0.9.18] — 2026-10-22

The interface, rebuilt: a compact overlay that fits its content, a control
panel with a real map, and pages that say what is actually true.

### Changed
- **The overlay is sized by its content.** Idle, it is a small box with the
  brand, the model, the question and the tools. Ask something and it grows to
  hold the answer, up to a limit, after which the answer scrolls inside the
  window. The window never grows without end.
- **The overlay shows what was asked.** The question stays above the answer, the
  time to first token sits under it with the model and the total, and a
  replayed answer is labelled as a replay. Copy and retry are one click away,
  and a provider failure is shown as an error rather than as silence.
- **The tools are one row of icon buttons** — screen, talk, record, listen —
  with the recording state, the audio source and the keyboard hint said
  plainly, so nobody has to guess whether the microphone is hot.
- **The control panel has a map.** A sidebar with Home, Models & Agents,
  Knowledge, Interviews and, under Manage, Settings and Privacy & Data. The
  route is in the URL, so a page can be linked to.
- **Home is a dashboard, not a placeholder.** It opens the overlay, says which
  model is in use and whether it answers, lists the providers that are
  connected, counts what Klyro knows, and shows recent sessions only when
  history is on.
- **Models & Agents is one page for everything.** Hosted providers, local model
  servers and coding agents, each with its real state, its models, a
  connection test and the actions that apply to it. A key or an endpoint is one
  click away instead of ten open forms.
- **Knowledge and Interviews are pages.** Knowledge lists memories and
  documents as rows, with search over both. Interviews is a split view: the
  sessions on the left, the session on the right.
- **Settings are grouped** — Assistant, Desktop, Screen & Audio, Knowledge &
  Memory, History & Retention, Providers & Agents, Usage & Diagnostics — and
  Privacy & Data is its own page with the measured capture check, what is
  stored, and one click to clear each thing.
- **The state of a provider is measured.** The local ones are asked directly,
  so “running” means the server answered, not that a port looked open.
- **A change anywhere shows up everywhere.** The theme, the model and the
  overlay's own settings follow a change made in another window at once.

### Added
- **One accent colour**, used only for the current thing: the active
  destination, the primary action.
- **Recent models in the picker** — the model used a minute ago is offered
  first.
- **Local or hosted, in the picker.** Every provider says where the question
  goes, and the overlay says whether the model in use can read a picture.

### Fixed
- **The sidebar drawer on a narrow window** slid only half way and stayed in
  the way of the content. It is now a drawer that opens and closes, and the
  menu button appears only when it is needed.
- **The theme did not follow a change made elsewhere**: it now does, without a
  restart.

## [0.9.17] — 2026-10-22

Connecting OpenCode checks that its model actually answers, and a silent turn
now says which model failed instead of leaving the reason a mystery.

### Fixed
- **OpenCode no longer saves a model that never answers.** Its catalogue lists
  models the server *knows about*, not models it can reach: a provider can be
  signed out or out of credit, and then the turn never starts — the server just
  stays quiet. Klyro used to save the first model marked free, so questions
  stalled with "the model said nothing". Connecting now asks one free model per
  provider a one-word question and saves the first that answers (verified live:
  it skipped a dead model and picked one that replied in about two seconds).
- **A stalled turn names the model and what happened.** If no answer message
  ever arrives, the error says OpenCode did not answer within about 18 seconds
  and names the model; if the turn ends with no text, it reports whether the
  model produced reasoning or tool parts, or nothing at all. The app and the
  Rust daemon share the wording.
- **A daemon left over from another build is replaced on launch.** `klyro-core`
  outlived app updates, so a Rust fix could wait forever for the old process to
  exit. The daemon now reports the app's version (kept in sync by the `npm
  version` hook) and a mismatch replaces it.
- **The Rust tests no longer fail intermittently with "Text file busy".** The
  fake agent CLIs are published by rename, so a parallel spawn cannot inherit a
  still-open write descriptor.

## [0.9.16] — 2026-10-22

The overlay's model chip lists every provider you have connected, including one
you connected a moment ago.

### Fixed
- **A provider connected in the control panel now shows up in the overlay.**
  The overlay window lives from launch, so it read the active provider once and
  kept it: connecting OpenCode (or Antigravity, Claude Code, Codex, a hosted
  key…) left the chip on Ollama until Klyro restarted. It re-reads the settings
  whenever it is shown, and again when the chip is opened.
- **The chip lists every connected provider, not just the one in use.** The
  models are grouped by provider and searchable across all of them; choosing
  one switches Klyro to that provider and remembers the model. The providers
  are asked in parallel, a provider that is down is left out with a note rather
  than an error, and the one in use is always shown — even when it is empty, so
  the reason is visible.
- **The model choice is actually saved.** The settings schema listed only
  `baseUrl` and `model`, and zod drops unknown keys, so the `fastModel` written
  by the overlay (and by Settings → Fast model) was silently discarded: the
  choice showed in the UI and the next launch used the old model. The schema
  now carries every provider field and has a regression test.

## [0.9.15] — 2026-10-22

The history can be kept for a while, or not at all — and Antigravity works with
the IDE closed.

### Added
- **A session that is never written down.** An interview can be ephemeral: the
  company, the questions, the answers, the transcript and the conversation
  behind them live in memory and nowhere else. Not in `interviews.json`, not in
  `conversations.json`, not in the answer cache, not in the memory extractor.
  It is gone when Klyro quits, and it never appears in history or in search. A
  conversation the overlay was already using is not emptied to achieve this:
  the session answers through a stand-in in memory and earlier messages stay
  where they were.
  Turn it on for every new session under **Settings → History → Don't keep new
  interviews**. If you change your mind about one that turned out to matter,
  **Keep this one** writes it down deliberately; it then says so like any other
  session.
- **A retention window for everything Klyro writes in words.** Interview
  transcripts, the chat history and the audit log share one setting — until you
  delete it, or 7 / 30 / 90 / 365 days. It is applied at startup, when a session
  begins, and the moment the setting changes; the data panel counts what is
  there, including the sessions that are held only in memory. The usage ledger
  has no words and no timestamps, so it stays a count and is cleared on demand.
- The data panel's "Meetings" row now names the thing it clears: **Interview
  sessions**, with the number held in memory beside it. Clearing it actually
  clears the interviews.

### Fixed
- **Antigravity, with the IDE fully closed, answers again.** The model
  catalogue the server hands over is not a list of chat models: it starts with
  internal `MODEL_CHAT_*` aliases that answer a model call with
  `404 NOT_FOUND`, and includes `tab_*` autocomplete models that take no
  conversation. Taking the first entry — which is what a picker does — looked
  like a broken connection. Klyro now offers only the models that answer, so
  the first entry is Claude Opus 4.6 (Thinking). Verified from a machine with no
  Antigravity process running: Klyro started its own service, reported the Pro
  plan, the account and 15 chat models, and answered in 4.3 s through the app
  and 5.8 s through the Rust daemon.
- **The answer cache no longer outlives its own promise.** It replays an answer
  for fifteen minutes, but the file kept the last fifty answers until the same
  question was asked again — possibly months later. What is older than the
  window is now swept at startup.
- **The launcher no longer adopts an OpenCode server it cannot sign in to.** If
  something already listens on 4096 and rejects the password Klyro has (or has
  none), every question became a 401. It now starts its own server on the next
  port instead, and it honours `OPENCODE_SERVER_PASSWORD` from the environment.
- **Antigravity's language server can no longer be stalled by its own log.**
  Its stderr pipe was never read, so a chatty boot could fill the buffer and
  stop the process. The tail is kept, and a failed start now logs it instead of
  reporting only that nothing happened.
- **The test suite is deterministic.** Two test files start an OpenCode server
  on the same port, and one of them put a fake `opencode` on `PATH`; run in
  parallel, both outcomes depended on which file the worker picked up first.
  Files now run one at a time, the fake binary leaves `PATH` when its file is
  done, and the live OpenCode check tries a few models before it gives up — a
  model that says nothing is a bad model, not a broken connection, and it no
  longer fails the suite.

### Changed
- `interviews.update` no longer accepts `ephemeral`: whether a session is
  written down is fixed when it starts. Deciding afterwards is its own action
  (`interviews.keep`).

## [0.9.14] — 2026-10-22

A slow model is waited for.

### Fixed
- **OpenCode was given three seconds of quiet and then given up on.** The
  daemon read a session ten times and, if nothing had appeared, reported that
  the model had said nothing — a slow provider, or the first turn after the
  server starts, looked like an empty answer. It now waits the way the app
  does: sixty reads, eighteen seconds, and the turn ends when the server says
  it has. The local model that takes ten seconds to clear its throat answers
  again.
- **`scripts/check-daemon.mjs` speaks the protocol the daemon speaks.** It was
  still connecting to the Unix socket that 0.9.9 replaced with loopback TCP, so
  the checker the docs point at could never pass. It now reads the state file,
  authenticates with the token, starts the daemon when nothing is answering,
  and picks the first model the provider serves when none is named.

### Added
- A test for the slow case: a fake OpenCode server that stays silent for twenty
  reads before answering, which is longer than the window that used to exist.

## [0.9.13] — 2026-10-22

Stealth is the default.

### Changed
- **The overlay is excluded from screen shares from the first launch.** Private
  mode — which keeps the overlay out of screen captures and shares on Windows
  and macOS — used to be off until you found the toggle. It is now on by
  default, because an overlay that turns up in a shared screen has done the
  opposite of its job. It is still a switch, and Linux/X11 still says plainly
  that it cannot do it: the platform has no per-window exclusion, so anything
  that captures the whole display keeps the overlay in it.
- **The overlay stays where it is when the meeting has focus**, which is what
  private mode already implied: the answer does not vanish because you clicked
  back into the call.

### Added
- A test over the defaults, so the stealth setting cannot be flipped back
  without a test saying so.

## [0.9.12] — 2026-10-22

Every provider in the daemon: the local agents join the hot path in Rust.

### Added
- **OpenCode in the daemon.** The session API, both generations: a session is
  created, the model is chosen, the prompt is queued, and the turn is read
  back until the server says it is over (`idle`). A failed turn is reported
  with the server's own reason, and a wrong HTTP method is refused rather than
  guessed at.
- **Claude Code and Codex in the daemon.** The CLIs are run as programs, with
  the user's own login: Claude Code as a JSON-line stream (pictures travel on
  stdin), Codex as `codex exec` with `--image` for a picture.
- **Antigravity in the daemon.** The Connect-RPC call to the IDE's own
  language server, with its CSRF token. The service stays the app's to start;
  the daemon places the call, so the model's answer no longer waits on the
  renderer.
- **Protocol-specific tests for each agent.** `cargo test` runs every client
  against a fake of the real thing: an OpenCode server that refuses a wrong
  method, a failed turn with its own reason, a Claude Code CLI fed a picture, a
  Codex CLI answering on stdout, and an Antigravity service that checks the
  path, the header and the model.

### Fixed
- **A local agent no longer needs a URL.** The route check demanded an
  endpoint for Claude Code and Codex, which are programs, not services — so a
  default install could not ask them anything. They now pass without one.
- **Antigravity falls back to the app when its service is not there**, so the
  message says which window to open instead of a generic "not set up".

## [0.9.11] — 2026-10-21

Interview history, a session that remembers, and answers that fit the question.

### Added
- **Interview history.** Every interview that was recorded is kept on this
  machine: the company, the role, the date, the duration, the questions, the
  transcript, the answers, your notes and a summary Klyro writes. Search it,
  filter it by company or role, bookmark what matters, and watch how far you
  got (answered so far, out of how many questions). One click deletes a
  session; one click deletes all of them. The panel is in the control panel,
  under *Interviews*.
- **Session context memory.** The decisions and the terms said during a
  meeting are remembered for the rest of it: "we decided to go with the local
  model" and "we call the gateway…" are kept, and the answers that follow
  know about them. The panel shows them under *Decisions & terms*.
- **Answers that fit the question.** A question is read as technical,
  behavioural, project or general, and the answer is shaped to match — precise
  for a technical question, situation-and-outcome for a behavioural one, your
  own role for a project one. It costs nothing: the kind is read off the
  words, not from a model call.
- **Latency regression tests.** The pipeline's own budget is now a number:
  a short question is heard within 1.5 s of the last word, a long pause is
  not charged to the answer, an interruption costs nothing, and a second
  question is heard as a second question. The tests live next to the code
  that has to keep them.

### Fixed
- **The daemon's answer never arrived.** The app asked the daemon and moved
  on before the answer came back, so a question answered by the daemon came
  back empty. The app now waits for the whole answer, and a failure from the
  daemon is reported as itself.
- The interview question and its answer are now written down whichever path
  answered them — the daemon, the app's own client, or an instant replay.

## [0.9.10] — 2026-10-21

The meeting is heard, and the question is answered the moment it ends.

### Fixed
- **A question in a meeting was not answered until the recording chunk
  ended — up to twenty seconds later.** The listen mode recorded in fixed
  20-second chunks, transcribed each one, and only then decided whether it
  held a question. A question that ended after two seconds was not even
  transcribed until twenty.

  It now listens for the *utterance*: the audio is recorded in small slices,
  the room's level is watched, and the pause that ends a question ends it.
  The question is transcribed on its own and answered at once.

  | | before | now |
  | --- | --- | --- |
  | a question that ends after 2 s is answered | up to 20 s later | ~2 s later |
  | what is transcribed | a 20-second chunk | just the question |
  | what a silent stretch costs | a transcription request | nothing |

  The silence gate still holds: a stretch of silence is never transcribed, so
  a quiet meeting costs nothing.

- A provider that cannot transcribe no longer repeats the same error for
  every question in the meeting: the listen mode stops and says so once.

## [0.9.9] — 2026-10-21

The daemon: the hot path leaves Electron.

### Added
- **`klyro-core`, a Rust daemon that owns the hot path.** The overlay's
  question no longer waits on a browser runtime: the app starts the daemon at
  launch and hands it the provider configuration, and the answer comes back
  through it.

  | | Electron app | `klyro-core` |
  | --- | --- | --- |
  | Start to listening | ~1 s | **2.3 ms** |
  | Memory | 851 MB (10 processes) | **4.3 MB** (one process) |
  | Binary | ~250 MB of runtime | 2.6 MB, no runtime |

  It speaks a small JSON-line protocol over a local socket (mode `0600`): it
  says hello, lists a provider's models, and answers a question, streaming the
  words back as they arrive. The OpenAI-shaped family (OpenAI, Groq, any
  OpenAI-compatible server) and Ollama are in it; the local agents join next,
  each with its own protocol. The keys never touch a second file: the daemon
  holds them in memory, handed over by the app, which is the only thing that
  can decrypt the OS keychain.

  If the daemon is not there — not built, or a platform it does not cover —
  the app carries on exactly as before.

### Fixed
- An Ollama base URL with the OpenAI-compatible `/v1` on the end no longer
  answers "not found"; the suffix comes off before Ollama's own routes.

## [0.9.8] — 2026-10-21

Klyro is now only the thing it is good at.

### Changed
- **Klyro is a meeting and interview assistant.** The overlay, the global
  hotkey, screen context, talk mode, listen mode, private mode, the model
  picker, every provider and every local agent stay. What went is everything
  that belongs to a different product:

  | Removed | Why |
  | --- | --- |
  | The chat workspace (Home, Chat, sidebar, composer) | A conversation app is a different product; the overlay already has its own input and history. |
  | The desktop agent (mouse and keyboard automation) | Nothing in "answer my question now" needs it, and it is a large attack surface on a machine that is holding a meeting. |
  | Workflows | A batch feature for a workspace. |
  | The Meetings/Studio surface | Record-then-act-afterwards is not instant assistance. (It was already unreachable in the shipped UI.) |
  | The GitHub integration | Filing issues is a workspace action. |
  | The MCP client and its import | A tool protocol for agents that act on code. It moves to the IDE product, and the chat tool loop goes with it. |

- **The knowledge base stays** — a resume, a project description, a document you
  were sent. The assistant grounds its answer in what it knows about you, and
  that is the difference between a useful answer and a generic one.
- **The main window is now the control panel**: the hotkey, the models and
  agents you can use, what Klyro knows, and the settings. The overlay is the
  product; this is what you configure it with.
- The renderer bundle went from 1,250 kB to 667 kB, and the stylesheet from
  77 kB to 48 kB. Less to start, less to keep safe.

### Kept, deliberately
Every model and agent integration is untouched: OpenAI, Anthropic, Gemini,
Groq, Ollama, any OpenAI-compatible server, **OpenCode**, **Claude Code**,
**Codex** and **Antigravity**, with their own authentication and their own
configurations.



## [0.9.7] — 2026-10-21

When it goes wrong, it says what went wrong.

### Fixed
- **Provider errors named the wrong provider.** The OpenAI-compatible adapter
  is shared by three Settings slots (OpenAI, Groq, OpenAI-compatible
  endpoint), but it hardcoded "openai" — so a Groq that could not be reached
  was reported as *"Could not reach OpenAI"*, sending the user to the wrong
  Settings card. Each slot now carries its own identity into every error.
- **Network failures showed "fetch failed" and nothing else.** `fetch` wraps
  the real reason (DNS failure, refused connection, rejected certificate) in a
  generic message that Klyro threw away. The reason is now shown, and the
  message names the endpoint that was contacted:
  *"Could not reach Groq at api.groq.com. … getaddrinfo ENOTFOUND
  api.groq.com"*.
- **Answers from a local OpenCode server were cut off.** The server lists a
  session newest first and splits one turn across several messages — a
  progress line, a tool call, then the answer. Klyro read the wrong end of
  that list, so a reply stopped at its first sentence, or came out empty when
  the first message held only a tool call. The whole turn is now read, in
  order, and the answer ends when the server says the turn is done.
- **A local answer that ended in silence left a blank bubble.** When the turn
  was over and the model had said nothing, Klyro stored an empty message: the
  chat showed nothing at all, and a silent model looked exactly like a broken
  one. A turn that says nothing — or that fails — now says what happened:
  *"OpenCode finished the turn without an answer"*, or the server's own
  reason when the turn failed.

## [0.9.6] — 2026-10-21

The picture reaches the model.

### Fixed
- **An attached image never made it to the model.** OpenCode, Claude Code and
  Codex all had a way to carry a picture — the server took it, the CLI took it,
  the CLI took a file — but Klyro sent the text only, so the model answered as
  if the screen were blank. Now:
  - **OpenCode** sends the picture with the question (as a file whose uri is
    the image itself). Verified live against a real server: the model read a
    test picture and answered "Red" for the red half.
  - **Claude Code** reads the picture from stdin as part of the message.
  - **Codex** gets the picture as a file, the way `codex exec --image` takes
    one.
- **Antigravity now says so instead of dropping the picture in silence.** Its
  model call is a prompt and a model id — there is nowhere to put an image —
  so the answer now opens with a clear note that the model saw only the text.
  A picture that vanishes without a word is worse than one that is refused.
- **A picture in your own message sat on the opposite side from your words.**
  Your words are aligned to the right; the picture was aligned to the left, so
  the two looked like separate messages. They are on the same side now.

## [0.9.5] — 2026-10-21

The question leaves the box the moment you press Send.

### Fixed
- **Your question stayed in the input box while the model was answering.**
  The composer cleared the field only after the whole answer had arrived, so
  the text you had just sent was on screen twice: once in the conversation
  and once in the box. The box is emptied the moment you press Send now; the
  question is already in the conversation, and the answer streams in below.
  If the question could not be sent at all, the text comes back.
- The same in the Knowledge panel: asking a document emptied the field only
  once the answer was done.

## [0.9.4] — 2026-10-21

Pick the model you want — in every provider.

### Added
- **A model picker for every provider.** Settings → Providers now has a real
  dropdown per provider instead of a text field, and it is filled from the
  provider itself: Antigravity's catalogue (with the remaining quota on each
  entry), the OpenCode server's models, Ollama's tags, the `/models` endpoint
  of OpenAI, Anthropic, Gemini, Groq and any OpenAI-compatible server, and the
  model ids the Claude Code and Codex CLIs accept. A model that is not
  advertised can still be typed in.
- **A model picker in the chat composer**, so you can switch model per
  question without going to Settings — the chip next to the Send button.
- **A model picker in the quick-ask overlay**, for the fast model it answers
  with.
- The Antigravity card in Integrations now lists its models as buttons: press
  the one you want and Klyro uses that model from then on.
- When a provider cannot be asked for its models, the picker says why — a
  rejected key, a missing key, a server that is not running — instead of
  showing an empty list.

### Fixed
- A slow answer from a provider you have already switched away from could
  replace the newer list with the old one. The picker now drops a late answer
  that no longer belongs to the provider on screen.

## [0.9.3] — 2026-10-21

Antigravity without the IDE: connect once, use it any day.

### Added
- **Antigravity, connected** — Integrations → Antigravity → *Connect* takes a
  snapshot of your Antigravity account session while the IDE is open. From
  then on Klyro starts Antigravity's own agent service itself and uses its
  models (Claude Opus 4.6, Sonnet 4.6, Gemini 3.5) **with the IDE never
  opened**. No API key, no copy-paste.
  - The session is stored in `~/.config/klyro/antigravity-session.json` (mode
    600) and can be removed again with *Disconnect*.
  - Verified live end to end with the Antigravity IDE fully closed: Pro plan,
    the account, 19 models, and a question answered by Claude Opus 4.6.
- The saved session is refreshed by the agent service itself, so it keeps
  working after the access token expires.

### Fixed
- Antigravity model calls went to `cloudcode-pa.googleapis.com`, which answers
  `429 RESOURCE_EXHAUSTED` even for an entitled account. The service now uses
  the same `daily-cloudcode-pa.googleapis.com` host the IDE uses.

## [0.2.2] — 2026-10-19

Groq first-class support plus provider-UX and workflow fixes.

### Added
- **Groq provider** with its own Settings card (label, encrypted key storage,
  connection test, editable model/base URL). Default model is the current
  production `openai/gpt-oss-120b`; speech-to-text uses `whisper-large-v3`.

### Fixed
- Provider "Test connection" spinner never stopped after a result: pending
  state and result state were the same field. Results now render as a proper
  success/error notice and the button re-enables.
- Saving an API key gave no visible confirmation (the draft is intentionally
  never read back). Cards now show an explicit "Key saved in the encrypted
  secret store" confirmation plus the persistent "Key saved" pill, disable
  "Save key" while the draft is empty, and explain the not-yet-saved state.
- A dead model name now says what to type instead: on a 404 the adapter asks
  the endpoint's own `/models` and appends the actually-available ids to the
  error ("Available models here: …").
- Speech-to-text sent `whisper-1` unconditionally; each compatible provider
  now carries the id it really serves (Groq needs `whisper-large-v3`), and
  Groq is accepted as a transcription provider.
- Clicking "New chat" while already on an empty conversation reused to pile
  up empty sessions; it now stays in the current fresh chat.
- Workspaces with reduced-width content columns (Workflows, Screen,
  Integrations) left dead space hugging the left edge on wide windows; the
  content column is centered now.

## [0.2.1] — 2026-10-19

Post-0.2.0 engineering completion program (details in `docs/ENGINEERING_CHECKLIST.md`)
and a full UI/UX polish pass.

### Fixed

- Sidebar panels (Agent, Memory, Settings) did not open after the redesign:
  panel opening now closes other panels first instead of open-then-close, the
  lazy Agent/Knowledge panels render at their single overlay site with a
  Suspense boundary, and raw `\uXXXX` escapes in JSX text render their real
  glyphs. Verified by a scripted click-through of every sidebar item in the
  running app.
- Chat empty-state logo loaded from a runtime URL that resolves in neither the
  renderer dev server nor the packaged app; it now imports the bundled mark
  (inlined by Vite) with a graceful fallback, and its dead "New chat" button
  actually starts a conversation.
- The collapsed sidebar referenced a size (64px) but the Workspaces navigation
  and Settings were wrapped in expanded-only blocks, so collapsing removed all
  navigation; collapsed mode is now a proper icon rail with title tooltips and
  aria-labels. The collapse/expand control itself was wired but never rendered.
- Home's composer was a second, divergent copy of the chat composer (text "X"
  remove button, inconsistent padding, late file-bottom import); it now reuses
  the shared `Composer` component with a hero variant and navigates to Chat on
  send, where the answer streams.
- Screen Assistant's Ask action streamed its answer into the Chat workspace
  without telling the user (the "Answer" section could never render); it now
  confirms and offers a direct link, and keeps the capture for follow-ups.
- Unstyled leftover classes still referenced by components (`.code-out`,
  `.provider__key/`, `.provider__actions`) now have shared definitions.
- Sidebar no longer clips its Settings footer on short windows: the chats list
  and the workspace rail shrink and scroll instead of overflowing.

### Added

- **Common integration contract (G1)** — one client shape (descriptor, cheap
  status, `selfTest()`) plus a registry; GitHub implements it with a live
  credential check, exposed as a "Test connection" button in the Integrations
  view.
- Design-system consolidation: motion duration/easing tokens, elevated-surface
  and overlay tokens, disabled/placeholder text tokens, `.section-label`,
  `.quick-action`, `.composer__hint`, standardized workspace-header pattern,
  and a subtle keyed workspace transition. Legible disabled states; message
  copy affordance appears on hover/focus without layout shift.
- Dialog accessibility: focus returns to the invoking control when a panel
  closes (close button, Escape, or opening another panel).
- Two-step destructive confirmation for "Clear all" (memories/documents) and
  sidebar chat deletion — nothing destructive executes on a single click.
- GitHub token form: show/hide toggle, honest connecting state, connection
  state pill; planned integrations marked "Planned · OAuth" with no fake
  connect buttons.
- **Opt-in crash reporting (J2)** — off by default; when enabled, redacted
  reports are stored locally (max 20) and viewable/clearable in Settings, and
  are only uploaded if `KLYRO_DIAGNOSTICS_URL` is explicitly configured.
- Packaging: `package.json` now carries `homepage`/`repository`, fixing the
  deb build; Linux AppImage + deb verified locally (see
  `docs/RELEASE_VERIFICATION.md`).

## [0.2.0] — 2026-10-18

Feature-complete for the planned A–E roadmap: shell, autonomous agent, memory and
knowledge, coding/meetings/workflows, and packaging.

### Added

- **Desktop agent (Stage B).** Observe → plan → act loop with a strict-JSON planner,
  one action per screenshot and re-observation after each action, a confirmation gate
  for consequential actions, cancellation, a step cap, and persisted task history.
  Input backends: `xdotool`/`ydotool`/`wtype` (Linux), `osascript` + `cliclick` (macOS),
  PowerShell + user32 (Windows), with a capability probe and exact install hints.
- **Knowledge (Stage C).** Local memory with tags, pinning, Jaccard duplicate
  suppression and optional fact extraction; document import for text, code, HTML, CSV,
  JSON, PDF (`pdftotext`) and Office (`unzip`); BM25 retrieval injected as a delimited
  data block so every provider benefits without tool-calling support; GitHub
  integration (account, repositories, issues, create issue).
- **Coding mode (Stage D).** Index a project folder into the knowledge store
  (dependency and build directories skipped) and run Explain / Find bugs / Write tests
  / Refactor / Document on a snippet, grounded in the most relevant indexed files.
- **Meetings (Stage D).** Chunked microphone capture, per-chunk transcription with live
  timestamps, local transcript storage, and summary + action-item extraction.
- **Workflows (Stage D).** Named multi-step workflows (`prompt` and `githubIssues`
  steps) with `{{input}}` / `{{prev}}` substitution, four built-ins, custom workflows,
  and per-step progress events. Runs land in a real conversation.
- **Packaging.** electron-builder configuration for Linux (AppImage, deb) and Windows
  (NSIS), generated application icons, and build scripts including unpacked
  `--dir` targets.
- **CI and releases.** Typecheck, unit tests, build and an end-to-end smoke check on
  every push; tagged builds publish Linux and Windows artifacts to a GitHub release.

### Changed

- Panels (agent, knowledge, studio, settings) are code-split and loaded on first open,
  which also defers their data fetching until then.
- Settings now shows a loading state and surfaces load failures instead of rendering
  nothing while it waits.

### Security

- Clients may only ever display Klyro's own renderer: navigation away is refused, web
  links open in the user's browser, webviews cannot attach, and the CSP now uses
  `default-src 'none'` with `object-src`, `base-uri`, `form-action` and `frame-ancestors`
  locked down.
- Permission requests are limited to microphone capture from Klyro's own renderer.

### Accessibility

- Visible focus rings, `prefers-reduced-motion` support, dialog semantics with
  `aria-modal`, labelled icon buttons, tab roles, a live region for the transcript, and
  Escape to dismiss every panel.

## [0.1.0] — 2026-10-18

- Initial shell: Electron + TypeScript + React, streaming chat, searchable local
  history, screen capture with a source picker, voice input and transcription,
  provider/model configuration with keys encrypted at rest, a frameless quick-ask
  overlay (`CommandOrControl+Shift+Space`), and a tray icon.

[0.2.0]: https://github.com/singhaditya73/klyro/releases/tag/v0.2.0
[0.1.0]: https://github.com/singhaditya73/klyro/releases/tag/v0.1.0
