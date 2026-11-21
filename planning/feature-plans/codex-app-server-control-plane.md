# Codex app-server control plane

Mission **coo:1325**, spike objective **coo:1325.gqfy**. This document records the spike that
verified the Codex app-server protocol, and the plan for a `controlPlane`-shape Codex adapter.
Overlord-launched Codex objectives will run through a long-lived app server instead of the
interactive `codex <prompt>` launch in `cli/src/launch.ts` `buildAgentCommand`. User-started Codex
sessions keep the hooks adapter.

It is a planning document only. It changes no runtime behavior.

**Contract impact: none** for this objective. No interface, invariant, security property, data
meaning or behavior changes. The later objectives carry their own declarations; the projected ones
are in [§10](#10-contract-impact-projected-for-later-objectives).

## 1. Summary

- **The app server is a good controlPlane target, and tier 3 (Conversational) is reachable.** On
  a live 0.170.0 server, these all work as documented:
  - command and patch approvals arrive as server-to-client requests;
  - patch approvals carry pre-mutation diffs;
  - `turn/steer` adds input to a running turn;
  - `turn/interrupt` stops a turn;
  - several clients can share one thread, and the first answer to an approval wins.
- **The question that decided the shape is settled.** The taxonomy's open item 2
  (`connector-harness-taxonomy.md` §3.3, §7 item 2) asked whether the app server allows only one
  subscriber per thread. It does not. An Overlord client and the Codex TUI subscribed to the same
  thread, and either one could answer an approval (§3.5). That makes Codex an OpenCode-shaped
  connector, not a Claude-shaped one.
- **Recommended transport:** a private, per-session app server per Overlord session, reached over a
  Unix socket (`--listen unix://PATH`). The socket speaks WebSocket. It is owner-only (mode 0600 in
  a 0700 directory) and needs no token. Loopback `ws://` with a capability-token file is the
  fallback where a Unix socket is unavailable. Never listen on a non-loopback address.
- **Taking over from a terminal works.** `codex --remote unix://… resume <threadId>` attaches the
  TUI to a thread Overlord is driving, and pending approvals are replayed to it. A person can
  watch, answer or type.
- **Three findings change the later objectives:**
  1. Launch must mint a session channel with a credential for this mode. The adapter needs one to
     post events, and ADR 0065 records that launch mints none today. That needs an ADR and a minor
     contract change.
  2. Overlord's own Codex plugin hooks fire inside app-server threads. A guard is needed to stop
     double capture.
  3. `thread/start` writes `trust_level = "trusted"` for each new worktree into the user's
     `~/.codex/config.toml`.

## 2. Method and environment

| What | Detail |
| --- | --- |
| Live server | `codex-cli 0.170.0` (Homebrew), macOS, ChatGPT auth. Run with stdio, with `--listen unix://./a.sock`, and with `--listen ws://127.0.0.1:<port> --ws-auth capability-token --ws-token-file`. |
| Probe client | A Node JSON-RPC client in the session scratchpad. It ran a driver and an observer as two clients, and the TUI ran in a detached `tmux` session. Throwaway git repo; probe threads were archived afterwards. |
| Schema | `codex app-server generate-ts --experimental` and `generate-json-schema --experimental` at 0.170.0: 963 TS files, ~180 client methods, 11 server requests and ~90 notifications. |
| Source and docs | `openai/codex` at tag `rust-v0.171.0`, read with `gh api`. Release notes 0.168–0.171. The official docs moved from `developers.openai.com/codex/app-server` to `learn.chatgpt.com/docs/app-server`. |
| Not run | The 0.171.0 binary. Installing it into a scratch prefix was blocked in this session, so the 0.171-only items (`codex exec --remote`, `modelProvider/default/set`) are verified from source and release notes only. |

Evidence labels used below:
- **LIVE**: observed on the running 0.170 server.
- **SCHEMA**: from the generated 0.170 bindings.
- **SRC**: from the 0.171 source.
- **DOCS**: from the official docs.

Redacted wire excerpts are in the [appendix](#appendix-wire-excerpts-redacted).

## 3. Answers to the spike questions

### 3.1 Transport and auth

- **Transports.** `codex app-server --listen` accepts these values (`--help`, SRC
  `app-server-transport/src/transport/mod.rs:99-123`):
  - `stdio://` (the default; JSON Lines);
  - `unix://` (the default control socket, `~/.codex/app-server-control/app-server-control.sock`);
  - `unix://PATH`;
  - `ws://IP:PORT`;
  - `off`.

  There is no `wss://` listener, so remote TLS needs a reverse proxy.
- **The Unix socket speaks WebSocket over an HTTP upgrade, not raw JSONL.** **LIVE:** raw JSONL on
  the socket got no reply. `curl --unix-socket … -H 'Upgrade: websocket'` returned
  `101 Switching Protocols` with `x-codex-websocket-max-unfragmented-message-bytes: 16777216`. A
  `ws` client over the socket (`ws+unix://`) then worked: one JSON-RPC message per text frame.
- **Socket path length.** **LIVE:** for a long path, Codex creates the real socket as
  `/private/tmp/codex-daemon-<uid>/<sha256>` (socket mode 0600, directory mode 0700) and puts a
  symlink at the requested path.
  - Node's `connect()` on the long symlink path failed with `EINVAL`, because macOS limits
    `sun_path` to 104 bytes.
  - A client must connect to the resolved short target, or choose a short path to begin with.
- **`codex app-server proxy --sock PATH`** relays stdio to the socket. It replaced
  `codex-stdio-to-uds` in 0.171 (SRC #62163). It did not answer in this 0.170 probe; the probe used
  WebSocket directly instead.
- **Auth on a Unix socket:** filesystem permissions only (owner-only, verified above). Anyone
  running as the same user can connect, exactly as with the TUI.
- **Auth on WebSocket:** `--ws-auth capability-token` (`--ws-token-file` or `--ws-token-sha256`) or
  `--ws-auth signed-bearer-token` (an HS256 JWT with issuer, audience and skew settings). The
  client sends `Authorization: Bearer …` on the upgrade. **LIVE** on loopback with a token file:

  | Request | Result |
  | --- | --- |
  | `/healthz` | 200 |
  | Upgrade with no token | 401 |
  | Upgrade with a wrong token | 401 |
  | Right token plus any `Origin` header | 403 (blocks browsers) |
  | Right token from the probe client | initialize succeeded |
  | `--listen ws://0.0.0.0:…` with no auth | Refused at startup: "refusing to start non-loopback websocket listener … without auth" |

- **Token lifetime (SRC `websocket-auth/src/lib.rs:286`):** a token is checked only at upgrade;
  expiry and revocation are not enforced on an open socket.
- **Unauthenticated loopback is allowed.** Loopback `ws://` without auth is accepted, so any local
  process could connect. The docs call the WebSocket transport "experimental and unsupported".
- **Safest binding for Overlord:** a dedicated `unix://` socket in an Overlord-owned 0700 directory
  with a short path, for example `~/.ovld/cx/<8-char id>.sock`. Use loopback `ws://` plus a 0600
  capability-token file only where Unix sockets are unavailable. Never use the user's shared daemon
  socket, and never use a non-loopback listener.

### 3.2 Thread and turn lifecycle

- **Methods (SCHEMA):** `thread/start`, `thread/resume`, `thread/fork`, `turn/start`, `turn/steer`,
  `turn/interrupt`. Also `thread/read`, `thread/list`, `thread/loaded/list`, `thread/archive`,
  `thread/unsubscribe` and `thread/turns/list`.
- **Handshake (LIVE):** `initialize` → response → `initialized` notification.
- **Thread object (LIVE):** `thread/start` returns `thread` with these fields: `id` (UUIDv7),
  `sessionId`, `parentThreadId`, `forkedFromId`, `status`, `source`, `cliVersion`, `originator`,
  `canAcceptDirectInput`. It also returns the effective `model`, `approvalPolicy`,
  `approvalsReviewer`, `sandbox` and `reasoningEffort`.
- **Mid-turn input — `inject.midTurn` is possible.** `turn/steer` with
  `{threadId, input, expectedTurnId}` was accepted while a command was running and waiting for
  approval (**LIVE**).
  - The steering text appeared as a `userMessage` item inside the same turn.
  - The agent acted on it: it added the requested line to the file.
  - A wrong `expectedTurnId` fails: `-32600 "expected active turn id … but found …"`.
  - Steering with no active turn fails: `-32600 "no active turn to steer"`.
  - Between turns, use `turn/start`.
- **`turn/start` during an active turn** also appends input. Its field docs say "Ignored when this
  request steers an already-active turn" (SCHEMA/SRC). Overlord should use `turn/steer` for the
  precondition check.
- **Interrupt (LIVE):** `turn/interrupt {threadId, turnId}` → `{}`.
  - It then emits `turn/completed` with `status: "interrupted"`.
  - It works while an approval is pending: the server sent `serverRequest/resolved` for the pending
    approval at the same moment.
- **Resume (LIVE):** `thread/resume` re-joins a running thread or loads a stored one.
  - Ephemeral threads cannot be resumed by a second client: "no rollout found".
  - A persistent thread cannot be resumed until its rollout exists, which is after the first turn
    starts; a resume about 500 ms after `turn/started` succeeded.
  - Overlord must use persistent threads, and retry resume and terminal attach until the rollout
    exists.
- **Fork (LIVE):** `thread/fork {threadId, excludeTurns: true}` created a new thread. Its
  `thread/turns/list` returned the source thread's turn.

### 3.3 Approvals and questions

- **Server-to-client requests (SCHEMA):**
  - `item/commandExecution/requestApproval`
  - `item/fileChange/requestApproval`
  - `item/permissions/requestApproval`
  - `item/tool/requestUserInput` (experimental)
  - `mcpServer/elicitation/request`
  - `item/tool/call` (dynamic tools)

  Legacy v1 `execCommandApproval` and `applyPatchApproval` remain.
- **Command approvals (LIVE).** Params are `kind` (`command`, `humanCommand` or `writeStdin`),
  `threadId`, `turnId`, `itemId`, `command`, `cwd`, `commandActions`,
  `proposedExecpolicyAmendment` and `availableDecisions`.
  - The answer is `{decision}`. Possible decisions are `accept`, `acceptForSession`,
    `acceptWithExecpolicyAmendment`, `applyNetworkPolicyAmendment`, `decline` and `cancel`.
  - **`availableDecisions` can omit `decline`.** Under `approvalPolicy: "untrusted"` it was
    `["accept", {acceptWithExecpolicyAmendment…}, "cancel"]`. The deny mapping must read
    `availableDecisions`.
- **Patch approvals and pre-mutation evidence (LIVE).** `item/fileChange/requestApproval` carries
  only `threadId`, `turnId`, `itemId`, `reason` and `grantRoot`; it has no diff. The diff comes
  first in the `item/started` notification for the same `itemId`: a `fileChange` item with
  `changes: [{path, kind: add|delete|update(move_path), diff}]`.
  - So pre-mutation evidence is available, and the adapter must join the two by `itemId`.
  - After the approval, `item/completed` (with `status`) and `turn/diff/updated` (the aggregated
    unified diff for the turn) follow.
  - Patch approvals were requested under `untrusted` for writes inside the workspace too.
- **Questions.** `item/tool/requestUserInput` carries
  `{questions: [{id, header, question, isOther, isSecret, options}], isBlocking}`. The answer is
  `{answers: {<id>: {answers: [...]}}}`.
  - It is experimental and needs `experimentalApi: true`. This model did not raise one in the
    probe (SCHEMA only).
  - `mcpServer/elicitation/request` carries MCP form and url elicitations; MCP tool approvals go
    through it.
- **Approvals only reach the client when `approvalsReviewer` is `user`.** **LIVE:** this user's
  config sets `approvals_reviewer = "auto_review"`, and a `thread/start` without an explicit
  reviewer inherited it. Under `auto_review` or `guardian_subagent`, a Codex subagent decides
  instead of the client. Overlord must always send `approvalsReviewer: "user"`.
- **`humanCommand` approvals (SRC)** go only to clients that sent
  `requiredHumanApproval: true` + `experimentalApi`. With none, the command is rejected. Overlord
  v1 does not declare this capability, so such commands fail closed.
- **Answering while a TUI is attached (`terminal.concurrentAnswer`):**
  - **Client to client (LIVE):** a second probe client subscribed with `thread/resume`. It received
    the same approval requests and answered first. The server broadcast
    `serverRequest/resolved {threadId, requestId}` to both clients. The driver's later answer was
    ignored silently, with no error.
  - **TUI takeover (LIVE):** the probe held a command approval open. A TUI started with
    `codex --remote unix://… resume <threadId>` showed the pending prompt ("Would you like to run
    the following command? … `echo held-by-overlord`"). Pressing `y` in the TUI resolved it, and
    the probe saw `serverRequest/resolved` followed by the command completing.
  - SRC confirms this: requests fan out to subscribers, the first responder consumes the request
    (`outgoing_message.rs:428-500,697`), and pending requests are replayed to a client that
    resubscribes (`:565`).

### 3.4 The event stream

Mapping of LIVE notifications to Overlord capabilities. Every notification carries a top-level
`emittedAtMs`.

| Overlord capability | Codex notification(s) | Notes |
| --- | --- | --- |
| `observe.prompt` | `item/completed` with `item.type == "userMessage"` | Includes steering messages, so injected text is observable as delivered. |
| `observe.toolCall` | `item/started` with `commandExecution`, `fileChange`, `mcpToolCall`, `dynamicToolCall`, `webSearch` or `collabAgentToolCall` | The command item has `command`, `cwd` and `commandActions` (parsed read/search/etc.). |
| `observe.toolResult` | `item/completed` for the same types | `status`, `exitCode`, `durationMs` and `aggregatedOutput`. Output must not reach the normalized envelope (redaction rule). |
| `observe.fileEdit` | `fileChange` `item/started` (pre, with diff), `item/completed` (post, with status), `turn/diff/updated` | Paths come from `changes[].path`. Edits made from the shell have no path; they are classified as shell activity, as the hooks adapter does today. |
| `observe.sessionLifecycle` | `thread/started`, `turn/started`, `turn/completed` (`completed`, `interrupted` or `failed`), `thread/status/changed` (`idle`, `active` + `waitingOnApproval`/`waitingOnUserInput`, `systemError`), `thread/closed`, `thread/archived` | `waitingOnApproval` gives a native "blocked" signal. |
| (status, diagnostics) | `mcpServer/startupStatus/updated`, `configWarning`, `warning`, `error`, `hook/started` and `hook/completed`, `model/rerouted` | `hook/*` exposes which plugin hooks ran (see §6). |

Streaming and structured output (for the Scribe-style consumers in coo:1108):
- **Streaming (LIVE):** `item/agentMessage/delta` is `{threadId, turnId, itemId, delta}`, where
  `delta` is a text fragment. The `item/completed` for the same `itemId` carries the full `text` and
  a `phase` (`commentary` or `final_answer`).
- **Structured output (SCHEMA):** `turn/start.outputSchema` (JSON Schema) constrains the final
  assistant message. The result arrives as that turn's `final_answer` `agentMessage.text`. This
  was not exercised live.

Noise to filter or opt out of: `item/agentMessage/delta`, `item/reasoning/*Delta`,
`item/commandExecution/outputDelta`, `thread/tokenUsage/updated`, `account/rateLimits/updated`,
`turn/moderationMetadata`. Use `initialize.capabilities.optOutNotificationMethods` to stop them at
the source.

### 3.5 Can the TUI attach to a shared server?

Yes (**LIVE** on 0.170): `codex --remote unix://<socket>` started a TUI against the probe's server,
and `codex --remote unix://<socket> resume <threadId>` joined a thread Overlord was driving,
including its pending approval (§3.3).
- Accepted remote forms: `ws://`, `wss://`, `unix://` and `unix://PATH`.
- `--remote-auth-token-env <VAR>` names an environment variable that holds the bearer token, so
  the token stays out of argv. A token is allowed only on `wss://` or loopback `ws://` (SRC).
- 0.171 adds `codex exec --remote <ADDR>` (SRC #61707). It starts or resumes a noninteractive
  session on an existing server with the server's own config, and rejects agent config overrides
  and active threads.

### 3.6 Child threads, root session ID and paging across forks

- **Thread fields (SCHEMA, LIVE):**
  - `sessionId` is "shared by threads that belong to the same session tree". For a root thread it
    equals `id`.
  - `parentThreadId` is set only for subagents.
  - `forkedFromId` is set for forks.
  - `agentNickname` and `agentRole`.
  - `source`, which can be `{subagent: {thread_spawn: {parent_thread_id, depth, agent_path,
    agent_nickname, agent_role}}}`.
- **Subagent items:** `collabAgentToolCall` (`spawnAgent`, `sendInput`, `wait`, with sender and
  receiver thread ids) and `subAgentActivity`.
- **Listing children (SRC):** `thread/list` filters by `parentThreadId` and, experimentally, by
  `ancestorThreadId`.
- **Root session ID inheritance** (0.168 #59000, forks in 0.171 #61945) is an in-process host API,
  not a JSON-RPC field. On the wire it shows only as the shared `Thread.sessionId`. Use `sessionId`
  as the tree key.
- **History paging:**
  - `thread/turns/list {threadId, cursor, limit, sortDirection, itemsView}` → `{data, nextCursor,
    backwardsCursor}` works on persistent threads (LIVE). On a fork it returns inherited source
    turns.
  - Ephemeral threads reject it: "ephemeral threads do not support thread/turns/list".
  - `thread/items/list` returns `-32601 "thread/items/list is not supported yet"` on 0.170 (LIVE).
  - The 0.169 store-level ordinal paging across fork segments is not exposed on the wire; 0.171
    passes `None` (SRC `thread_processor.rs:3669`).

### 3.7 `model/list`, provider discovery and `account/read`

All shapes below are **LIVE**.
- **`model/list {modelProvider?, cursor?, limit?, includeHidden?}`** → `{data: Model[], nextCursor}`.
  - `Model` fields: `id`, `model`, `displayName`, `description`, `hidden`, `isDefault`,
    `supportedReasoningEfforts[{reasoningEffort, description}]`, `defaultReasoningEffort`,
    `inputModalities`, `serviceTiers`, `defaultServiceTier`, `upgrade`/`upgradeInfo`.
  - This installation lists 4 or more models, with efforts `low` through `max` plus `ultra`. That
    is more than `cli/src/agent-catalog-defaults.ts` assumes.
  - An unknown provider returns `-32600` with `data.type = "modelProviderNotConfigured"` (SRC).
- **`modelProvider/list {}`** → `{data: [{id, name, canEdit, baseUrl, settings}], defaultProviderId,
  canChangeDefault}`. `modelProvider/default/set` is new in 0.171 (SRC).
- **`account/read {refreshToken?}`** → `{account, userId, requiresOpenaiAuth, workspaceRouting}`.
  - `account` is null or one of `{type: "chatgpt", email, planType, workspaceName}`,
    `{type: "apiKey"}`, `{type: "amazonBedrock", …}` or `{type: "gcp"}`.
  - Live, it returned the email, the ChatGPT user id and the ChatGPT account id. These are
    personal identifiers and must stay local.
- These need no long-lived server. A short-lived `codex app-server` over stdio answered them in
  about 1 s.

### 3.8 Folder trust, MCP and plugins

- **Implicit trust on `thread/start` (LIVE).** A `thread/start` with a `cwd` in an untrusted git
  repo and a writable sandbox wrote this into the user's `~/.codex/config.toml`:

  ```toml
  [projects."<repo>"]
  trust_level = "trusted"
  ```

  SRC `thread_processor.rs:1514-1575` gives the rule. Trust is granted only when all of these hold:
  - a `cwd` was passed;
  - no trust level is saved for the project;
  - the directory has a git, `.codex` or root marker;
  - the effective permissions can write the cwd.

  A read-only sandbox, or an explicitly untrusted project, gets no implicit trust.
- **Effect for Overlord.** Fresh worktrees load their project config, MCP and hooks under
  workspace-write without `--trust`. Each new worktree path then stays in the user's config.
- **0.169 `--trust`** applies to `codex exec` and `codex review`, not to app-server threads. Headless
  exec keeps project config and MCP disabled in an untrusted directory unless `--trust` is passed,
  and `--trust` does not override an explicit "untrusted".
- **Plugins, MCP and hooks load from the user config as in the TUI (LIVE):**
  - `plugin/installed` listed `overlord@overlord-local` 0.3.75.
  - `hooks/list` showed its `postToolUse` and `userPromptSubmit` hooks as `trustStatus: "trusted"`.
  - `hook/started` and `hook/completed` fired for both inside app-server turns.
  - `mcpServer/startupStatus/updated` reported every configured MCP server.
- **The installed Overlord MCP failed to start:** "handshaking with MCP server failed: connection
  closed: initialize response". The installed 0.3.75 shim only speaks `Content-Length` framing,
  while the Codex MCP client sends newline-delimited JSON. The repo's
  `connectors/core/scripts/overlord-mcp.mjs` already detects the framing, so re-running
  `ovld agent-setup codex` fixes it.
  - This is not app-server-specific, but the app-server reports it as a typed status that Overlord
    can surface.
- **Per-thread config.** `thread/start.config` takes override maps. `config/read`,
  `config/value/write` and `config/batchWrite` (with `expectedVersion`) edit the user config.
- **`disabledPluginIds` cannot turn off Overlord's hooks per thread yet.** It is stored but "does
  not yet filter plugin capabilities" (SCHEMA doc comment).

### 3.9 Versioning and stability

- **No protocol version field.** The `initialize` response is `{userAgent, codexHome,
  platformFamily, platformOs}`. **LIVE** `userAgent` is
  `"<clientInfo.name>/<codex version> (<os>; <arch>) <terminal> (<clientInfo.name>; <clientInfo.version>)"`,
  for example `overlord_spike/0.170.0 (Mac OS …; arm64) …`. Parse the server version from the token
  after the first `/`, and confirm it with `codex --version` before spawning.
  - `Thread.cliVersion` also records the version that created each thread.
  - `codex app-server daemon version` reports CLI and daemon versions for the shared daemon only.
- **Experimental gating (LIVE):** with `experimentalApi: false`, both of these were refused —
  `mock/experimentalMethod` ("requires experimentalApi capability") and the field
  `thread/start.permissions` ("thread/start.permissions requires experimentalApi capability").
  Bindings generated without `--experimental` contain only the stable surface.
- **Stability.** `codex app-server` is itself labelled `[experimental]`. 0.168–0.171 shipped within
  about three weeks, each with app-server changes, and later releases fixed earlier behavior:
  approval cancellation scoping, interrupt reply ordering, late completions cancelling newer
  approvals. Plan for weekly churn.

## 4. Comparison with the opencode controlPlane adapter

The opencode adapter (`connectors/adapters/opencode/`, runtime in `cli/src/agent-session/sidecar.ts`)
is the template for the shape. It is also a warning.

| Aspect | opencode (today) | Codex app-server (plan) |
| --- | --- | --- |
| Transport | HTTP + SSE to `127.0.0.1:<port>`, Bearer password | WebSocket over an owner-only Unix socket; JSON-RPC 2.0 without the `jsonrpc` field |
| Who starts the server | Nobody: the sidecar only connects to an existing port, and the password it generates never reaches opencode | The Overlord supervisor spawns the server and owns its lifecycle |
| Decisions | Polls `GET /requests/:id`, then `POST /permission/:id/reply` | Answers the pending JSON-RPC request id; `serverRequest/resolved` reports when another client answered first |
| Pre-mutation evidence | None (`post-only`) | `fileChange` `item/started` diff before the approval (`paired`) |
| Inject | `prompt_async` | `turn/steer` (mid-turn, with precondition) or `turn/start` (boundary/next) |
| Interrupt | Not implemented | `turn/interrupt` |
| Questions | `question.asked` never answered | `item/tool/requestUserInput` (experimental) and MCP elicitation |
| Evidence | Mostly source-guard fixtures; nothing run against a real server | Recorded native frames from a live server; normalized-event fixtures plus a live smoke test |
| Launch wiring | None; launch mints no channel, so the sidecar's scope check refuses to start | Launch mints a channel credential for this mode (§7) |

Reuse from opencode:
- the generic `ovld agent-session sidecar --agent <adapter>` dispatch (`index.ts`, "a sixth harness
  must add zero subcommands");
- the channel client (`client.ts`), with its silent-failure and 401-clears-credential behavior;
- `reconcileState` on reconnect;
- `resolved-elsewhere` reporting;
- the `prompt_async` style of reporting inbox outcomes (`/inputs/:id/emitted|acknowledged|failed`).

Do not inherit: the unstarted server, the unverified wire values, and fixtures that only grep source.

## 5. Adapter architecture

### 5.1 Adapter identity

The new adapter gets its own directory, **`connectors/adapters/codex-app-server/`**, with adapter
key `codex-app-server` and agent identifier `codex`.
- The descriptor schema requires the adapter key to equal the directory name, and one descriptor
  has one `integrationShape`.
- `agent_session_channels` already stores `agent_identifier` and `adapter_key` separately, so a
  Codex session channel says which surface it is on.
- The hooks adapter stays at `connectors/adapters/codex/` (`callback`).

### 5.2 Runtime components (`cli/src/agent-session/codex-app-server/`)

| Module | Responsibility |
| --- | --- |
| `transport.ts` | Connects over WebSocket on a Unix socket (resolving the short socket target), or loopback `ws://` with a bearer token read from a 0600 file, or stdio for one-shot queries. Frames JSON-RPC. Reconnects with backoff (reusing `RECONNECT_DELAYS_MS`) and handles `-32001` overload. |
| `rpc.ts` | Request/response correlation, the server-request registry (id → pending request), and notification fan-out. Answers unknown server requests with a safe refusal so Codex never hangs. |
| `server.ts` | Spawns the private app server (`codex app-server --listen unix://… -c …`) with a sanitized env, runs the `/readyz` and `initialize` health checks, checks the version, stops the server, and reports crashes. |
| `session.ts` | Thread binding: `thread/start` with launch settings, then the first `turn/start` with the objective prompt. Persistent threads. Records `thread.id` and `sessionId` as the native session alias. Opts out of delta notifications. |
| `events.ts` | Turns each notification into a transport-supplied `nativeEventName` of the form `method` or `method:item.type` (for example `item/completed:commandExecution`). Runs the codec, computes a content-derived `producerEventId` (`threadId:turnId:itemId:phase`), and pushes to the channel. |
| `decisions.ts` | Turns approval and question requests into channel requests (`POST /requests`), shows a bounded card (command, cwd, actions, file paths plus diff summary for patches), waits for resolution, and maps the answer to a Codex decision using `availableDecisions`. Reports `resolved-elsewhere` on `serverRequest/resolved`. |
| `inject.ts` | Claims inbox inputs. If a turn is active, calls `turn/steer` with `expectedTurnId` (`delivered`). Otherwise calls `turn/start` (`delivered`, or `queued_turn_boundary` if a race loses the precondition). Records failures with codes. |
| `capture.ts` | Feeds `fileChange` paths, with outcome from `item/completed.status`, into the existing `ovld protocol capture-change` path as `declared_edit` evidence, so changed-file recording matches the hooks adapter. |

### 5.3 Codecs

- **`codec/codex-app-server.codec.yaml`:** native event normalization, keyed by the synthesized
  event names above. It needs no `eventNamePath`, because controlPlane is exempt
  (`generate-harness-capabilities.mjs:719-727`).
  - `nativeSessionPaths`: `params.threadId` and `params.thread.id`.
  - Mappings: `item/completed:userMessage` → `prompt.submitted`; `item/started:commandExecution` →
    `tool.started`; `item/completed:commandExecution` → `tool.completed`; `item/started:fileChange`
    and `item/completed:fileChange` → `file.edited` (pre/post); `turn/started` and `turn/completed`
    → turn lifecycle; `thread/started` and `thread/closed` → `session.started` and
    `session.ended`.
  - The adapter objective confirms the exact normalized event names against
    `packages/core/service/agent-session/pure/codec.ts`.
- **Decision mapping.** No decision codec is needed; controlPlane is exempt from the decision-codec
  rule (`:326-340`). The mapping is a pure, tested function, `codexDecisionFor(request, answer)`:
  - allow → `accept`;
  - deny → `decline` if it is in `availableDecisions`, otherwise `cancel`;
  - never `acceptForSession` or the policy amendments while `answer.persistentAllow` is hidden by
    policy.
- **Redaction.** `aggregatedOutput`, file `diff` bodies, `agentMessage.text` and reasoning are
  never copied into normalized envelopes. Fixtures assert this with `mustNotContain`. Diffs reach
  the approval card only through the bounded, redacted request-card path that decision codecs use.

### 5.4 Capability targets per matrix row

| Row | Target | Evidence or reason |
| --- | --- | --- |
| `observe.prompt` | supported | `userMessage` item; normalized-event fixture |
| `observe.toolCall` | supported | `item/started` command/MCP/fileChange |
| `observe.toolResult` | supported | `item/completed` with status/exitCode |
| `observe.fileEdit` | supported | `fileChange` items; `mutationHooks: paired` (pre diff before approval, post status) with a mutation-window fixture |
| `observe.sessionLifecycle` | supported | `turn/*`, `thread/*`, `thread/status/changed` |
| `decide.shell` | supported | `item/commandExecution/requestApproval` |
| `decide.fileWrite` | supported | `item/fileChange/requestApproval` joined to the pre-diff |
| `decide.mcp` | unverified → supported if a fixture proves it | MCP approvals arrive as `mcpServer/elicitation/request`; not raised in the probe |
| `decide.anyTool` | unsupported | Codex gates by sandbox and approval policy, not per tool. Web search, dynamic tools and in-sandbox reads are never routed to the client. Evidence: the approval policy enum and §3.3. |
| `decide.universal` | unsupported | The app server has no pre-tool hook for every tool; that lives on the hooks surface |
| `answer.structuredQuestion` | supported if a recorded `requestUserInput` frame passes; otherwise unverified | Experimental; needs `experimentalApi` |
| `answer.persistentAllow` | not-implemented (hidden by policy, as for opencode) | `acceptForSession` and execpolicy amendments exist |
| `inject.midTurn` | supported | `turn/steer` (LIVE) |
| `inject.turnBoundary` | supported | `turn/start` when idle |
| `inject.nextTurn` | supported | `turn/start` after `turn/completed` |
| `terminal.concurrentAnswer` | supported | First answer wins plus `serverRequest/resolved` (LIVE, TUI and second client) |
| `terminal.statusSurface` | not-implemented, tracked as coo:1325.fx4f | — |

- **Derived tier: 3 (Conversational).** Binding is supported through the channel env plus the
  thread id. The decision hold is implicit for controlPlane, at least one `decide.*` is supported,
  and at least one `inject.*` is supported.
- **Fixture rule.** Every `supported` claim needs an executable fixture built from a recorded
  frame: `normalized-event` for observe, `mutation-window` for fileEdit. Decide and inject need a
  small fake-server `script-io` fixture that replays recorded frames and asserts the exact
  JSON-RPC reply bytes. A `source-guard` alone is not enough.
- **Interrupt** has no capability row. See §10 and §11: the adapter objective decides whether to
  propose one.

## 6. Coexistence with the hooks adapter

- **The two surfaces load together.** The Overlord Codex plugin's `UserPromptSubmit` and
  `PostToolUse` hooks fire inside app-server threads (LIVE `hook/started`). Their scope comes from
  `OVERLORD_OBJECTIVE_ID` in the process env (`capture-change-hook.sh`), so an app server started
  with the objective env would capture every edit twice: once from the hook, once from the
  adapter.
- **Observed during the spike, not just predicted.** The probe app server was started from this
  objective's attached shell, so it inherited `OVERLORD_OBJECTIVE_ID`. The plugin's `PostToolUse`
  hook then recorded the probe repo's `notes.md` (an `apply_patch` in a throwaway repo) as a
  `declared_edit` of coo:1325.gqfy (`ovld protocol changes`).
  - A shared or long-lived server would attribute every thread's edits to whichever objective
    started it.
  - So the server env must never carry objective scope: either the guard below, or no
    `OVERLORD_OBJECTIVE_ID` in the server env at all, with the adapter providing scope per thread.
- **Guard.** The supervisor starts the app server with `OVERLORD_CODEX_SURFACE=app-server`, and
  every Codex hook script exits 0 early when it is set. This is a connector change with a
  `script-io` fixture.
  - Per-thread `disabledPluginIds` is the clean answer once Codex makes it filter plugin
    capabilities, but it does not today.
- **Decision race.** The `two-integration-surfaces-could-disagree` hazard
  (`connectors/adapters/codex/harness-capabilities.yaml`) is closed by construction:
  - in app-server mode only the adapter answers;
  - the hooks adapter claims no `decide.*` today;
  - the guard keeps that true if it ever does.

  Record this on both descriptors.
- **User-started sessions** (`codex`, Codex desktop, the shared daemon) keep the hooks adapter.
  Overlord never connects to the user's shared daemon socket
  (`~/.codex/app-server-control/app-server-control.sock`) or to remote control.
- **Mode reporting.** Doctor reports the mode per session: the channel `adapter_key` is
  `codex-app-server` or `codex`.
- **Plugin health.** In app-server mode the plugin is still useful: its MCP gives the agent
  `ovld protocol` tools. Launch preflight checks `mcpServerStatus/list` for `overlord`, and reports
  a failed start, such as the stale 0.3.75 shim in §3.8, as a session warning that tells the user
  to rerun `ovld agent-setup codex`.

## 7. Security model

1. **Listening surface.**
   - One private app server per Overlord session, on `unix://` in `~/.ovld/cx/` (0700, short
     path). Codex creates the socket 0600.
   - No TCP. The `ws://127.0.0.1` fallback requires `--ws-auth capability-token --ws-token-file`
     with a 0600 file of 32 random bytes; the token is never in argv. The supervisor deletes the
     file and socket on exit.
   - Refuse to start if the directory is not owner-only.
2. **Remote control stays off.** Never run `remote-control` or `daemon enable-remote-control`. Check
   `remoteControl/status/changed` after `initialize` and stop the server if it is not `disabled`.
3. **Approval routing is Overlord's.**
   - Every thread is started with `approvalsReviewer: "user"` and an explicit `approvalPolicy` and
     sandbox from launch settings. The user's `auto_review` default must never apply silently.
   - Who may answer is decided by the existing request RBAC on the channel request routes; the
     adapter only applies decisions it reads back through the channel credential.
   - A same-UID local process can also answer through the socket, just like the TUI. This is
     accepted and documented.
4. **Policy auto-answers.** Policy may auto-answer only `kind: "command"` approvals. It never
   answers `humanCommand` (which is not declared, so it fails closed), `writeStdin`, permission
   escalations (`item/permissions/requestApproval`) or `grantRoot`; those always go to a person.
5. **Secrets.**
   - The channel credential reaches the supervisor through the existing owner-only credential file
     (`writeChannelCredential`), never argv.
   - The app server's env is an allowlist. It drops `OVERLORD_USER_TOKEN` and channel tokens,
     because commands inherit the server's env.
   - Codex auth stays in `CODEX_HOME`, and `account/read` identifiers never leave the machine.
6. **Folder trust.** Implicit trust on `thread/start` is accepted as equivalent to `--trust` for
   Overlord worktrees in workspace-write. Overlord records each trust entry it causes and removes
   it on worktree cleanup with `config/batchWrite` and `expectedVersion`. It never overrides an
   explicit `untrusted`.
7. **Process cleanup.** The server runs in its own process group under the supervisor. When the
   session ends, the supervisor archives the thread when the objective is done, interrupts any
   live turn, and terminates the server. Orphaned servers are found by pid file.

## 8. Version pinning

- `harness.versionRange: ">=0.170.0"`, `verifiedVersion: 0.170.0`. The verification objective
  raises it to the tested version.
- **Before spawning:** run `codex --version`. Below the range, launch refuses app-server mode with
  a clear message (or falls back to hooks if the setting allows). After `initialize`, parse
  `userAgent` and compare.
- **Pinned surface:** commit bindings generated by `codex app-server generate-ts` at the verified
  version, covering only the methods and fields the adapter uses.
  - A test pins that list.
  - `experimentalApi: true` is sent, but the adapter may use only a whitelisted set of experimental
    members, at first just `item/tool/requestUserInput`.
  - Unknown notifications are ignored, and unknown server requests get a safe refusal.
- **Drift check:** `yarn connectors:check` re-runs fixtures from recorded frames. A
  `codex-app-server` doctor check reports the server version against `verifiedVersion`.
- **Frame re-recording:** a dev script records fresh frames from a live server, so each Codex bump
  is a recording and diff, not a hand-edit.

## 9. Launch and runner integration

1. **Setting.** A Codex launch mode, `hooks` (default) or `appServer`, in agent launch settings.
   It is default-off until coo:1325.tg2w passes.
2. **Launch** (`buildLaunchPlan` / `launchAgent` in `cli/src/launch.ts`): in `appServer` mode,
   - mint a session channel with credential (§10);
   - start the supervisor (`ovld agent-session sidecar --agent codex-app-server`) detached;
   - the supervisor spawns the server and starts the thread (cwd = worktree,
     `developerInstructions` from the context file, `model`/`effort`, sandbox, approval policy,
     reviewer `user`), then sends the objective prompt as the first `turn/start`;
   - the visible terminal (Latch or direct) runs `codex --remote unix://<sock> resume <threadId>`
     once the rollout exists, retrying while resume reports "no rollout found".
3. **Runner launches** use the same supervisor with no terminal. `codex exec --remote` (0.171) is
   not needed, because the supervisor already speaks the protocol. A person who wants to watch
   attaches with the `ovld` command from step 5.
4. **Lifecycle.**
   - The supervisor health-checks with `/readyz` (ws) or a periodic `thread/read`.
   - If the server crashes, it restarts it and `thread/resume`s the thread; pending approvals are
     replayed and reconciled against open channel requests.
   - If the supervisor crashes, the server is stopped through the process group.
   - Mission or objective end stops both.
   - When the user closes the TUI, the session keeps running, because the server and supervisor
     own it.
5. **Terminal attach.** A new `ovld` command, for example `ovld session attach <session>`, opens
   `codex --remote … resume <threadId>` for a running app-server session on this machine.
6. **One-shot queries** (coo:1325.2dp2) use a short-lived `codex app-server` over stdio and need no
   running server.

## 10. Contract impact (projected for later objectives)

**This objective:** none.

**Adapter (scn0):** minor, plus an ADR.
- Launch-time channel minting with credential for controlPlane launches amends ADR 0065 decision 1
  ("Launch still mints no channel"). This is the authority problem the opencode sidecar also has.
- If interrupt becomes a channel input kind or a capability id (for example `control.interrupt`),
  that adds to `agentSession.capabilityIds` and the descriptor schema. Under
  `contract/CONTRACT.md` §5, a new capability id requires a version bump.
- The new adapter's conformance manifest and descriptor are "new connector shipped" changes, which
  need no contract update on their own.

**Launch integration (ke1y):** minor. It adds the launch-mode setting to the agent config schema
and the API and CLI surfaces, and the new `ovld` attach command (`protocol-commands.yaml` only if
it is a protocol command).

**Later objectives:** models (2dp2) is minor only if the agent-catalog API shape changes. Child
threads (nagv) is minor if session events gain parent/child thread fields.

## 11. Work split across coo:1325

| Objective | Scope as planned | Adjustments from the spike |
| --- | --- | --- |
| **scn0** adapter | Client, codecs, decisions, inject, interrupt, concurrentAnswer, descriptor, fixtures | **Add:** launch-time channel credential minting (ADR amending 0065), because without it the adapter cannot post anything; the Codex hook-script guard (§6); the `availableDecisions`-aware deny mapping; the `approvalsReviewer: "user"` invariant. **Transport:** WebSocket over UDS with stdio for tests. Fixtures come from recorded frames (the appendix shapes). Decide whether interrupt needs a capability id. Wire `resolveInjectPath` for `codex-app-server` → `turn/steer`/`turn/start`. |
| **ke1y** launch | Server lifecycle, launch path, security, trust, terminal visibility, coexistence, settings | **Per-session server**, not reuse per execution target. Server env is per objective and must exclude secrets; one crash affects one session. Reuse is a later optimization. **Terminal visibility is confirmed:** implement `codex --remote … resume` attach. `codex exec --remote` is optional. **Trust:** handle implicit trust writes and clean them up (§7.6), not `--trust`. **Add:** a preflight for the Overlord MCP status. |
| **nagv** child threads | Attribute child and forked threads; history import | Use `Thread.sessionId` as the tree key, plus `parentThreadId`, `forkedFromId` and `source.subagent.thread_spawn`. Root-session inheritance is not a wire field. Fork ordinal paging is not exposed, so use `thread/turns/list` (persistent threads only). `thread/items/list` is unsupported on 0.170. |
| **2dp2** live models | `model/list`, providers, effort; fallback | Use a one-shot stdio app server; no shared server is needed. The catalog's effort list must accept `max` and `ultra` as returned. `account/read` returns email and account ids: keep them local and use at most `planType`. |
| **fx4f** status line | `terminal.statusSurface` | Unchanged. In app-server mode the status shows in the TUI attached with `--remote`, which reads the user's config. |
| **tg2w** verify | Security review, end to end, docs, default recommendation | **Add checks:** socket and directory modes; no TCP listener; remote control disabled; `approvalsReviewer` forced to `user`; trust entries cleaned up; `humanCommand` fails closed; no double capture with the plugin installed; a stale plugin MCP surfaced; resume and attach after rollout; an approval answered in the TUI shows `resolved-elsewhere` in Overlord. |

## 12. Risks and open questions

- **Experimental surface.** The command and WebSocket transport are labelled experimental, and
  behavior changed in every release examined. Mitigated by pinning, recorded fixtures and a
  version gate.
- **`item/tool/requestUserInput` was not observed live.** It needs a recorded frame before
  `answer.structuredQuestion` is claimed.
- **`decide.mcp` through elicitation** was not exercised.
- **Windows.** Whether `unix://` works there is unverified, and Codex hooks are already documented
  as unavailable on Windows. App-server mode is macOS and Linux only until tested.
- **`codex app-server proxy`** did not relay in this 0.170 probe. It is not needed by the plan.
- **Trust entry accumulation** in the user's Codex config, if cleanup fails. Mitigated by recording
  each entry and by doctor.

## Appendix: wire excerpts (redacted)

These frames are from 0.170.0. Paths are replaced with `<repo>`; ids are real UUIDv7 values from
the throwaway probe threads.

**Command approval request (server → client):**
```json
{"method":"item/commandExecution/requestApproval","id":0,"params":{"kind":"command","threadId":"01a1fa95-37f5-7f52-8405-83ea25249d50","turnId":"01a1fa95-38e4-7ce2-a032-5fcbdb01d40a","itemId":"exec-07c64bed-…","startedAtMs":1795205453262,"environmentId":"local","command":"/bin/zsh -lc \"ls -la && sleep 8 && …\"","cwd":"<repo>","commandActions":[{"type":"unknown","command":"ls -la && sleep 8 && …"}],"proposedExecpolicyAmendment":["/bin/zsh","-lc","…"],"availableDecisions":["accept",{"acceptWithExecpolicyAmendment":{"execpolicy_amendment":["/bin/zsh","-lc","…"]}},"cancel"]}}
```

**Pre-mutation evidence, then the patch approval for the same `itemId`:**
```json
{"method":"item/started","params":{"item":{"type":"fileChange","id":"exec-1a4df0ff-…","changes":[{"path":"<repo>/notes.md","kind":{"type":"add"},"diff":"inside\n"}],"status":"inProgress"},"threadId":"01a1fa96-7d09-…","turnId":"01a1fa96-7d4d-…"},"emittedAtMs":1795205535283}
{"method":"item/fileChange/requestApproval","id":3,"params":{"threadId":"01a1fa96-7d09-…","turnId":"01a1fa96-7d4d-…","itemId":"exec-1a4df0ff-…","startedAtMs":1795205535284,"reason":null,"grantRoot":null}}
```

**Steering mid-turn, and its preconditions:**
```text
→ {"id":4,"method":"turn/steer","params":{"threadId":"…","expectedTurnId":"01a1fa95-38e4-…","input":[{"type":"text","text":"Also add a second line \"bye\" to hello.txt.","text_elements":[]}]}}
← {"id":4,"result":{"turnId":"01a1fa95-38e4-…"}}
← {"error":{"code":-32600,"message":"expected active turn id `00000000-…` but found `01a1fa95-38e4-…`"},"id":5}
← {"error":{"code":-32600,"message":"no active turn to steer"},"id":8}
```

**Interrupt while an approval is pending:**
```text
→ {"id":7,"method":"turn/interrupt","params":{"threadId":"…","turnId":"01a1fa95-a0c2-…"}}
← {"id":7,"result":{}}
← turn/completed {"turn":{"id":"01a1fa95-a0c2-…","status":"interrupted","durationMs":4381,…}}
← serverRequest/resolved {"threadId":"…","requestId":2}
```

**Concurrent answer.** The observer answered first, and the driver's late answer was ignored:
```text
observer → {"id":9,"result":{"decision":"accept"}}       (t=5805)
both     ← serverRequest/resolved {"requestId":9}
driver   → {"id":9,"result":{"decision":"accept"}}       (t=8773, no effect, no error)
```

**TUI takeover.** `codex --remote unix://<sock> resume <threadId>` showed the held approval
("Would you like to run the following command? … `$ echo held-by-overlord`"). Pressing `y` in the
TUI made the Overlord-side client receive `serverRequest/resolved {"requestId":12}`, and the turn
completed.

**Plugin hooks running inside an app-server turn:**
```json
{"method":"hook/started","params":{"run":{"eventName":"userPromptSubmit","handlerType":"command","source":"plugin","sourcePath":"~/.codex/plugins/cache/overlord-local/overlord/0.3.75/.codex-plugin/hooks.json","status":"running"}}}
```

## Outcome of the launch objective (coo:1325.ke1y)

Built as planned in §9 with these decisions (ADR 0092, contract 179.7.0):

- **Setting:** agent launch config `harnessMode` (`hooks` | `appServer`) per user and machine,
  plus `OVERLORD_CODEX_APP_SERVER=1` in the launching process or as a project launch env var.
  Fallback to the terminal launch, with a warning, when Codex is missing or below 0.170.0, there
  is no objective, or minting fails.
- **Channel:** `POST /api/objectives/{id}/session-channels` mints a `control_plane` channel for
  `codex-app-server` only; attach binds it by objective.
- **Lifecycle:** per-session server; crash respawn (≤3) with one continuation turn; the heartbeat
  response carries `objectiveState`/`deliveryState`, and the supervisor stops on a complete or
  deleted objective, or 15 minutes idle after delivery; orphans are reaped at supervisor start and
  by `ovld doctor`.
- **Trust:** the entry `thread/start` adds is detected (before/after snapshot) and removed by a
  guarded line-level edit after the server stops, not by `config/batchWrite`.
- **Terminal:** `ovld agent-session attach` runs `codex --remote unix://… resume <thread>`.
  `codex exec --remote` is not used.
- **Not built:** the Overlord MCP startup preflight (§6 "Plugin health") and per-target server
  reuse.

Verified live on 0.170.0 against a scratch Local backend: mint → attach binding → events →
delivery → objective complete → self-stop; SIGKILL of the server → respawn, resume and
continuation → delivery; TUI attach showing history; a command approval answered in the TUI
closing the Overlord card as resolved elsewhere; SIGTERM stop; trust entry removed every time.
The live run also found that protocol session keys reached event summaries; core redaction now
masks `sess_…`.

## Outcome of the child-thread objective (coo:1325.nagv)

**Contract impact: none.** Child attribution uses the existing `subagentId` / `correlationId`
envelope fields and the free-form request `details`; no capability id, route, field, vocabulary
or data meaning changed. The descriptor changes are connector capability and hazard updates.

Verified live on 0.170.0 (two probes, one through the recorder's new scenario `c`):

- The server attaches every connection to every thread it creates (`try_attach_thread_listener`),
  so a subagent's notifications **and approvals** reach the Overlord connection with the child's
  `threadId`. There is no `thread/started` for a spawned child; the parent's `subAgentActivity`
  item (`kind: started`, `agentThreadId`, `agentPath`) arrives first.
- `thread/read` on a child returns the root's `sessionId` (root-session inheritance),
  `parentThreadId` and `forkedFromId` both set to the parent, and `source.subAgent.thread_spawn`.
  `thread/list` reports the child's own id as `sessionId`, so `sessionId` is trusted only from
  `thread/read`. A child turn's `rootTurnId` is the parent turn.
- `thread/fork` gets a new `sessionId` on 0.170 and its `thread/turns/list` starts with the
  source's turns (same turn and item ids). History item ids equal the live ones.

Built (`cli/src/agent-session/codex-app-server/threads.ts`, `history.ts`):

- **Thread tree.** Root, subagents (from `subAgentActivity` / `spawnAgent` items, or `thread/read`
  lineage) and forks (`thread/started` with `forkedFromId`). Child events carry
  `subagentId` = child and `correlationId` = root; their edits reach change capture; their cards
  carry `details.subagent`. Foreign threads are dropped and their approvals left alone. Stopping
  the session interrupts running child turns.
- **History import** after every resume (sidecar only; a supervisor option so recorded fixtures
  stay exact): `thread/turns/list` oldest first with full items, `thread/list {parentThreadId}`
  for subagents, terminal items only, inherited fork turns skipped. Live and imported events have
  equal ids (checked on the live run), so the server drops duplicates.
- **Hooks adapter.** In 0.170 a subagent's hook payload carries the root `session_id` plus
  `agent_id` / `agent_type`; the codec records `agent_id` as `subagentId`. A 0.170 `/fork` still
  gets its own session id.

Not built: discovering a fork made while Overlord was disconnected; registering the
`SubagentStart` / `SubagentStop` hooks.


## Outcome of the verification objective (coo:1325.tg2w)

**Contract impact: minor** (179.10.0, ADR 0094). Answering control-plane requests from Overlord
adds the `control_plane` delivery mode, the `channel_ended` and `not_session_owner` reasons, and
owner-only approval answers on `POST /api/agent-requests/{id}/resolve`. The rest of this
objective changed connector runtime, descriptors and docs only.

**Security review.** Saved as [`security-audits/2026-11-21.md`](../../security-audits/2026-11-21.md).
There were no Critical or High findings.
- Fixed:
  - a supervisor killed with SIGKILL no longer leaves the server running (a watchdog ends it);
  - a re-asked approval no longer inherits an earlier answer;
  - no thread starts unless remote control reports `disabled`;
  - the supervisor connects only to an owner-only socket;
  - the supervisor environment carries no user token;
  - trust cleanup preserves a symlinked config;
  - completed diffs are dropped.
- Accepted and documented: commands the agent runs, as the person's OS user, can reach the
  person's `ovld` login; and a narrow orphan-reaper pid check.

**End-to-end checklist.** Run live on 2026-11-20 with Codex 0.171.0 (npm `@openai/codex`) on
macOS, against a scratch Local backend serving the built web app. The web app was driven by
Playwright, the Codex TUI ran in tmux, and the person's real `~/.codex` (ChatGPT login,
`approvals_reviewer = "auto_review"`) was used.

| Step | Result | Evidence |
| --- | --- | --- |
| Launch an objective in app-server mode | Pass | `ovld launch codex --objective-id gen:1.w61j` → supervisor, private socket, channel `control_plane`/`codex-app-server`, online; TUI attached with `ovld agent-session attach` |
| Observe events | Pass | 39 channel events for run 1: session/turn lifecycle, `tool.called`/`tool.completed`, `file.edited`, prompts. All 12 summaries with `--session-key` were redacted |
| Answer a command approval and a patch approval from the web app while a terminal is attached | Pass | Run 2 (`gen:2.pmae`, `--flag=--ask-for-approval=untrusted`): 4 command and 1 patch "Approval needed" cards answered with **Allow once** in the web app, TUI attached. Each was resolved by the launching member as `{"optionId":"allow"}`, and the supervisor reported each applied (`emitted`). The card then read "Delivered to the agent." Cards reaching Overlord despite `auto_review` show the forced `user` reviewer held through the TUI's `resume` |
| Send a mid-turn follow-up | Pass (from the TUI) | Typed during `sleep 40`; it arrived in the running turn as `prompt.submitted` (seq 33) and the agent acted on it. Overlord's own input route is still closed for every agent (410) |
| Interrupt a turn and resume | Pass (from the TUI) | Esc → `turn/completed` with `{"detail":"interrupted"}` (seq 39); a new turn from the TUI resumed and delivered |
| Attribute child-thread work | Pass | A subagent's start, turn, `notes/child.txt` edit and end were recorded with `subagentId` (seq 22–27), and its edit is on the delivery |
| Deliver and confirm change evidence | Pass | Run 1 delivery evidence: `calc.py`, `notes/child.txt` (`declared_edit`). Run 2: `calc.py`. Objectives `complete`; channels `ended` (`codex_app_server_objective_ended`) |
| Cleanup | Pass | No supervisor, server or watchdog left; `~/.ovld/cx/` empty; `~/.codex/config.toml` byte-identical before and after (trust entry removed) |
| Hooks adapter regression | Pass | `gen:1.entz` in hooks mode: interactive `codex <prompt>`, attach, PostToolUse capture of `calc.py` (`direct_path_observed`), delivery, no channel minted |

Notes from the run:
- **A direct `ovld launch` takes Codex flags only from `--flag`**; the saved launch flags apply to
  runner launches. With the default `on-request` + `workspace-write`, in-workspace work raised no
  approvals (run 1). This is documented.
- **The agent's own `ovld` calls** ran without approvals in these runs. One delivery attempt
  failed with "Could not reach Overlord backend" inside the sandbox, and the retry after resuming
  succeeded.
- **The hooks-mode TUI needed a model change.** On this machine, Codex 0.171's interactive TUI ran
  turns on an older shared daemon release (0.159.2) that rejected the configured model, so a
  model was chosen for that session only. This is Codex environment behavior, not Overlord's.
- **Not run live:** the runner-claim path, a server crash and respawn (covered in coo:1325.ke1y),
  MCP elicitation and `requestUserInput`, and Linux.

**Recommendation on the default: keep app-server mode opt-in for now.** It now works end to end
on 0.171.0, including web approvals, and is the better mode for headless runner launches. Flip
the default for Overlord-launched Codex objectives only after all of these:
1. Overlord can send follow-ups, steer and interrupt (the session-input route is still 410, so
   today those need the TUI);
2. the mobile app answers `control_plane` cards (they are read-only there today);
3. the runner-claim path has passed one live run;
4. the next Codex release has been re-recorded with `scripts/codex-app-server-record.mts`, since
   the app server is experimental and changed in every release from 0.168 to 0.171.

The trust caveat and the same-user exposure are the same as running Codex in a terminal, so they
do not block the change. When the default flips, it should apply per workspace, with the hooks
fallback kept.
