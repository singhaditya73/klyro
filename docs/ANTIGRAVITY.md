# Antigravity — how Klyro talks to it

Reverse-engineered from the IDE that is installed on this machine
(`/opt/antigravity-ide`, the `antigravity` extension's language server).
Everything below was **observed live**, not inferred from documentation.

## What Antigravity is made of

- An Electron/VS Code fork: `antigravity-ide`.
- One extension, `extensions/antigravity`, whose JavaScript bundle
  (`dist/extension.js`) contains the client side of the protocol.
- A native **language server**: `extensions/antigravity/bin/language_server_linux_x64`
  (a stripped Go binary, ~156 MB) that does the real work.

## The connection

The extension spawns the language server itself, and hands it a **one-time
CSRF token** on the command line. Observed process arguments:

```
language_server_linux_x64
  --enable_lsp
  --csrf_token <uuid>
  --extension_server_port <port>
  --extension_server_csrf_token <uuid>
  --app_data_dir antigravity-ide
  --subclient_type ide
  --cloud_code_endpoint https://cloudcode-pa.googleapis.com
```

The server listens on **several localhost ports** (one of them serves HTTPS
with a self-signed certificate; the plain-HTTP one speaks Connect-RPC).

### The request

```http
POST http://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/<Method>
Content-Type: application/json
connect-protocol-version: 1
x-codeium-csrf-token: <the --csrf_token value>

{ "metadata": { "ideName": "antigravity", "extensionName": "antigravity",
                "ideVersion": "unknown", "locale": "en" } }
```

A wrong token is answered with `401 {"code":"unauthenticated","message":"invalid CSRF token"}`.

### What works, verified

| Method | Result |
| --- | --- |
| `GetUserStatus` | 200 — account, plan (`Pro`), quota, teams tier |
| `GetAvailableModels` | 200 — 22 models with live `quotaInfo.remainingFraction` (Claude Opus 4.6, Claude Sonnet 4.6, Gemini 3.5, …) |
| `GetCascadeModelConfigs` | 200 |
| `GetModelStatuses` | 200 |
| `StartCascade` | 200 → `{ "cascadeId": "…" }` |
| `SendUserCascadeMessage` | 200 (accepts `cascadeId` + `message`) |
| `GetCascadeTrajectory` / `GetCascadeTrajectorySteps` | 200 — the trajectory with every step |

### The agent call, and the one thing still open

```jsonc
// StartCascade
{ "metadata": { … },
  "source": "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
  "trajectoryType": "CORTEX_TRAJECTORY_TYPE_CASCADE",
  "requestedModel": "MODEL_GOOGLE_GEMINI_2_5_FLASH" }   // an enum, not a message

// SendUserCascadeMessage
{ "metadata": { … }, "cascadeId": "…", "message": "…" }
```

The trajectory comes back with steps; a finished answer is a text step.

**Open:** the executor rejects the request with *"failed to construct executor:
neither PlanModel nor RequestedModel specified"*. The message and the
trajectory plumbing are right — the model has to be handed to the executor in
the shape it expects (`CascadeConfig.planModel` / `requestedModel`, where
`Model` is a message with `modelId`, `displayName`, `description`), and the IDE
resolves that from its own model picker rather than from the request. Finding
the exact shape is the next step; everything else is mapped.

## Running the service without the IDE (0.9.1)

The IDE is only the *client* of the agent service. Klyro can run the service
itself:

- It spawns the same `language_server_*` binary the IDE spawns, with its own
  CSRF token, and writes the **initial metadata protobuf** the server reads
  from stdin. Without it the server dies with *"Failed to read initial metadata
  from stdin"*; with a JSON body it dies with *"cannot parse invalid
  wire-format data"*. The field numbers come from the message's own descriptor
  in the binary (`Metadata`, `exa.language_server_pb`):

  | Field | Number | Field | Number |
  | --- | --- | --- | --- |
  | extension_path | 1 | device_fingerprint | 24 |
  | ide_version | 2 | trigger_id | 25 |
  | locale | 4 | api_key | 26 |
  | ide_name | 8 | disable_telemetry | 27 |
  | session_id | 9 | user_tier_id | 29 |
  | extension_name | 12 | ls_timestamp | 16 |

  `src/main/domains/antigravity-service.ts` builds that message and starts the
  server; the encoder is covered by a unit test.

- **Verified live**: the headless server boots, binds its ports and answers
  Connect-RPC. Klyro's own status call finds it and reports it as *"the service
  Klyro started"*.

- **The one thing still missing** is the *sidecar*: the IDE's own extension
  server (`--extension_server_port`, `--extension_server_csrf_token`) is where
  the language server gets the account session and the cascade model config.
  A headless server with no sidecar answers with

  ```
  500 {"code":"unknown","message":"GetCascadeModelConfigData() is nil"}
  ```

  — the account, plan and model catalogue are therefore not available to a
  Klyro-started service on its own. Closing that gap means Klyro also
  answering the extension-server calls the language server makes at startup
  (`GetCascadeModelConfigData`, `GetSecretValue`, …), seeded from a one-time
  snapshot taken while the IDE is running. That is the remaining piece of work,
  and it is now precisely specified.

## The port changes on every start

The language server picks a new port (and a new token) every time it starts, so
Klyro never trusts a cached endpoint: every call re-discovers the running
servers, probes their ports in parallel, and drops a connection that has gone
stale. Restarting Antigravity therefore needs no action from the user.

## How Klyro uses it today

`src/main/domains/antigravity.ts` does exactly the discovery above: find the
language server process, read its token, find the port that answers, and read
the account, plan, quota and model catalogue. Integrations shows:

> **Antigravity — Connected — Pro plan**
> Read directly from the Antigravity agent on this machine — 22 models, no key
> and no bridge. Endpoint 127.0.0.1:34839.

No key, no bridge, no scraping of private files: the token is handed to us by
the same machine that runs the IDE.

## Notes for whoever continues this

- The port changes on every IDE start, and so does the token — never cache
  either across restarts.
- The server is Go; the proto descriptors are embedded in the binary, so the
  message shapes can be read out of the strings (`exa.language_server_pb.*Request`
  plus the `Get<Field>` reflection methods).
- `dist/languageServer/cert.pem` in the extension is the certificate the HTTPS
  port uses.
- The bridge projects (`ag-local-bridge` on :11435, `agy2api` on :8000) do
  the same thing for third-party tools; Klyro now detects them too, but the
  direct route above is cleaner and needs nothing installed.
