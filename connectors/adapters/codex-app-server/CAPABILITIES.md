<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->

# Codex app server — Overlord agent-session capabilities

**Adapter** `codex-app-server` · **Codec** `codex-app-server` · **Integration shape** `controlPlane` · **Capability tier** 3 (Conversational)

**Harness version verified** `0.171.0` · **range** `>=0.170.0` · **scheme** `semver`

**Descriptor digest** `62fe3dc93ee7f64f6fb52d48e88e10679c9a32a92abc6b16ace29571284fcbf2`

> The tier is derived from passing fixtures, never authored. `unsupported` means the harness
> cannot do it — do not attempt it. `not-implemented` means it is buildable and unbuilt: that is
> your work. `unverified` means find out first. `supported` without a passing fixture is a CI
> failure, not a claim.

## Session binding

| Field | Value |
| --- | --- |
| Status | ✅ supported |
| Source | `env` |
| Field | `OVERLORD_SESSION_CHANNEL_ID` |
| Evidence | fixtures: `fixtures/replay-handshake.json` |

The supervisor is started by Overlord with the channel bootstrap in its own environment, so it holds the authority before the thread exists. It starts (or resumes) one persistent thread and records the thread id as the channel's native session alias with its first heartbeat. The thread id is correlation only: Codex's own `sessionId`, `threadId` and the socket path confer nothing.

The native session id is a **correlation alias only**. Authorization and mission scope come
from the verified channel/session credential; neither the working directory nor an unverified
native id is a binding authority.

## Decision hold

| Field | Value |
| --- | --- |
| Status | ✅ supported |
| Harness ceiling | none documented |
| Evidence | fixtures: `fixtures/replay-command-approval.json` |

Codex holds an approval as a pending JSON-RPC request until some subscribed client answers it, with no harness timeout. The adapter therefore holds nothing: it renews a waiter lease on the channel request while a person decides, and if it dies the lease lapses and the Codex request simply stays open for the terminal.

## Mutation-window evidence

| Field | Value |
| --- | --- |
| Classification | `paired` |
| Executable fixture | `fixtures/mutation-window-evidence.json` |

`item/started` carries the fileChange item (paths and diff) before the patch approval and before anything is written; `item/completed` carries the same item id and path with the final status. The diff is used only for the approval card's line counts and never leaves the machine.

The fixture proves a matching native pre/post window. Runtime window evidence must retain
the same session, call, workspace, tool, outcome, and direct-path semantics.

## Capabilities

| Capability | Status | Native | Evidence |
| --- | --- | --- | --- |
| `observe.prompt` | ✅ supported | `item/completed:userMessage` | fixtures: `fixtures/normalize-user-message.json`, `fixtures/normalize-steer-message.json`, `fixtures/replay-history-import.json` |
| `observe.toolCall` | ✅ supported | `item/started:commandExecution` | fixtures: `fixtures/normalize-command-started.json`, `fixtures/normalize-file-change-started.json` |
| `observe.toolResult` | ✅ supported | `item/completed:commandExecution` | fixtures: `fixtures/normalize-command-completed.json` |
| `observe.fileEdit` | ✅ supported | `item/completed:fileChange` | fixtures: `fixtures/normalize-file-change-completed.json`, `fixtures/normalize-file-change-declined.json`, `fixtures/mutation-window-evidence.json`, `fixtures/normalize-child-file-change.json`, `fixtures/replay-child-thread.json` |
| `observe.sessionLifecycle` | ✅ supported | `thread/started` | fixtures: `fixtures/normalize-thread-started.json`, `fixtures/normalize-turn-interrupted.json`, `fixtures/normalize-subagent-started.json`, `fixtures/normalize-fork-started.json` |
| `decide.shell` | ✅ supported | `item/commandExecution/requestApproval` | fixtures: `fixtures/replay-command-approval.json`, `fixtures/human-answers-control-plane-cards.json` |
| `decide.mcp` | ❓ unverified | `mcpServer/elicitation/request` | tracked as `coo-1325-codex-mcp-elicitation-frames` |
| `decide.fileWrite` | ✅ supported | `item/fileChange/requestApproval` | fixtures: `fixtures/replay-patch-approval.json`, `fixtures/replay-child-thread.json` |
| `decide.anyTool` | ⛔ unsupported | `approvalPolicy` | Codex gates by sandbox and approval policy, not per tool: web search, dynamic tools and in-sandbox reads are never routed to a client for approval, so there is no request to answer for an arbitrary tool. (evidence: `planning/feature-plans/codex-app-server-control-plane.md#33-approvals-and-questions`) |
| `decide.universal` | ⛔ unsupported | `approvalPolicy` | The app server has no pre-tool callback that every tool passes through; that exists only on the hooks surface, which does not run in this mode. (evidence: `planning/feature-plans/codex-app-server-control-plane.md#54-capability-targets-per-matrix-row`) |
| `answer.structuredQuestion` | ❓ unverified | `item/tool/requestUserInput` | tracked as `coo-1325-codex-request-user-input-frames` |
| `answer.persistentAllow` | 🚧 not-implemented | `acceptForSession` | tracked as `agent-session-phase-2` |
| `inject.midTurn` | ✅ supported | `turn/steer` | fixtures: `fixtures/replay-inject-steer.json` |
| `inject.turnBoundary` | ✅ supported | `turn/start` | fixtures: `fixtures/replay-inject-turn-boundary.json` |
| `inject.nextTurn` | ✅ supported | `turn/start` | fixtures: `fixtures/replay-inject-turn-boundary.json` |
| `terminal.concurrentAnswer` | ✅ supported | `serverRequest/resolved` | fixtures: `fixtures/replay-concurrent-answer.json` |
| `terminal.statusSurface` | ✅ supported | `statusline MCP provider (tui_extensions_statusline)` | fixtures: `fixtures/status-line-provider.json`, `fixtures/status-line-thread-index.json` |

### Capability notes

- **`observe.prompt`** — Overlord's own steering input also arrives as a userMessage item, which is how an injected instruction is observed as received.
- **`observe.fileEdit`** — A subagent's file changes arrive on the same connection with the child thread id and are recorded for the parent session, with the child as `subagentId`, and reach change capture like the root thread's.
- **`observe.sessionLifecycle`** — Codex sends no thread/started for a spawned subagent; its parent's `subAgentActivity` item (started, completed, interrupted) is the child's lifecycle in the parent session. A fork reports thread/started with `forkedFromId`.
- **`decide.shell`** — The card is answered in Overlord (web, mobile, `ovld`) by the member who launched the session (ADR 0094), or in the attached TUI, whichever is first. Verified live on 0.171.0: four command approvals answered from the web app with the TUI attached.
- **`decide.mcp`** — MCP tool approvals arrive as MCP elicitations. None was raised against a live server, so the adapter refuses the request (fail closed) and the terminal decides.
- **`decide.fileWrite`** — A subagent's patch approval is answered the same way; its card names the subagent (`details.subagent`). Verified live on 0.171.0: a patch approval answered from the web app with the TUI attached.
- **`answer.structuredQuestion`** — The adapter routes a single, non-secret question to a channel request (code and unit tests), but no live server raised `item/tool/requestUserInput` in either probe — the model did not call the experimental tool when asked. Grade it supported only with a recorded frame.
- **`answer.persistentAllow`** — `acceptForSession` and execpolicy amendments exist and are never sent. Product policy hides standing grants from remote surfaces, as for OpenCode.
- **`terminal.concurrentAnswer`** — Codex fans an approval out to every subscriber and takes the first answer; a person at `codex --remote unix://… resume <thread>` can answer while Overlord holds a card, and the card closes as resolved elsewhere.
- **`terminal.statusSurface`** — The private app server loads the same user Codex config and plugins, so a terminal attached with `codex --remote unix://… resume <thread>` (Codex 0.171+, feature `tui_extensions_statusline`, selected by `ovld agent-setup codex --status-line`) shows the Codex hooks adapter's statusline provider. That provider runs inside the server's allowlisted environment, which carries no launch binding, so the sidecar indexes the session's thread under the `codex` agent when the thread is ready and removes the entry on exit. Verified live on 0.171.0 against a private server on a Unix socket.

## Hazards

| Hazard | Severity | Verification | Mitigation | Tracked as |
| --- | --- | --- | --- | --- |
| `experimental-surface-drift` | high | verified | implemented | fixture `fixtures/replay-version-gate.json` |
| `auto-review-would-bypass-overlord` | high | verified | implemented | fixture `fixtures/replay-handshake.json` |
| `control-socket-owns-the-session` | high | verified | implemented | fixture `fixtures/server-socket-owner-only.json` |
| `server-env-carries-scope` | high | verified | implemented | fixture `fixtures/server-socket-owner-only.json` |
| `stop-leaves-turn-running` | medium | verified | implemented | fixture `fixtures/replay-interrupt.json` |
| `launch-mints-no-channel` | high | verified | implemented | fixture `fixtures/launch-mints-control-plane-channel.json` |
| `human-session-controls-closed` | low | verified | required | `coo-1325-control-plane-human-controls` |
| `question-answer-double-delivery` | medium | verified | implemented | fixture `fixtures/human-answers-control-plane-cards.json` |
| `supervisor-killed-leaves-server` | medium | verified | implemented | fixture `fixtures/supervisor-watchdog.json` |
| `reasked-approval-inherits-answer` | medium | verified | implemented | fixture `fixtures/reasked-approval-occurrence.json` |
| `same-user-agent-reaches-credentials` | medium | verified | accepted | — |
| `child-threads-share-the-connection` | high | verified | implemented | fixture `fixtures/replay-child-thread.json` |
| `notifications-missed-while-disconnected` | medium | verified | implemented | fixture `fixtures/replay-history-import.json` |
| `fork-history-repeats-source-turns` | low | verified | implemented | fixture `fixtures/replay-history-import.json` |
| `implicit-folder-trust` | low | verified | implemented | fixture `fixtures/trust-entry-cleanup.json` |

**`experimental-surface-drift`** — `codex app-server` and its WebSocket transport are labelled experimental, and 0.168–0.171 each changed app-server behavior. The adapter speaks only a pinned method list, refuses a server whose initialize userAgent reports a version below the verified range, ignores unknown notifications and refuses unknown server requests.

**`auto-review-would-bypass-overlord`** — A user config with `approvals_reviewer = "auto_review"` makes a Codex subagent decide approvals the client never sees, and a thread started without an explicit reviewer inherits it (spike, LIVE). Every thread is started or resumed with `approvalsReviewer: "user"`.

**`control-socket-owns-the-session`** — Anything that can connect to the app server can drive the agent. The server listens only on `unix://` in an owner-only `~/.ovld/cx/` (Codex keeps the real 0600 socket in its own 0700 directory, and the supervisor connects only after checking that socket and directory belong to this user and are not group- or world-writable), never on TCP and never on the user's shared daemon socket; the supervisor starts no thread until the server reports remote control `disabled` right after `initialize`, and stops if it later reports anything else. A same-user local process can still connect, exactly as the TUI does (see `same-user-agent-reaches-credentials`).

**`server-env-carries-scope`** — Commands the agent runs inherit the app server's environment. The server is started with an allowlisted environment, so the user token, channel credentials and objective scope never reach it, and with OVERLORD_CONTROL_PLANE_SURFACE so the Codex plugin's own hooks stay silent inside it (see the codex adapter's `plugin-hooks-fire-inside-app-server-threads`).

**`stop-leaves-turn-running`** — Ending an Overlord session must not leave Codex working. When the channel stops honoring the credential, or the supervisor is signalled, it interrupts the running turn before closing the connection.

**`launch-mints-no-channel`** — The adapter needs a credentialed session channel, and launch minted none since contract 76 (ADR 0065). A Codex launch in app-server mode now mints one through POST /api/objectives/{id}/session-channels, stages it in the owner-only cache and starts the supervisor; every other launch still mints none (ADR 0092).

**`human-session-controls-closed`** — This adapter's approval, question and choice cards are answered from Overlord (delivery mode `control_plane`, ADR 0094); an approval only by the member who launched the session. Session inputs are still refused for every adapter (`POST /api/agent-session-inputs` answers 410), so a follow-up, steer or interrupt is typed in the attached TUI (`ovld agent-session attach`), not sent from web or mobile.

**`question-answer-double-delivery`** — A human answer to a question or choice request is delivered through Latch into the session's terminal (ADR 0065). For a codex-app-server session that would type the answer into an attached TUI as well as answering the JSON-RPC request. The resolve route now records an answer to a control-plane request without any Latch delivery, and the supervisor answers the JSON-RPC request from its waiter lease (ADR 0094).

**`supervisor-killed-leaves-server`** — The private server runs in its own process group so the supervisor can stop it, and it ignores SIGTERM while a turn runs (LIVE), so stop escalates to SIGKILL. A supervisor that is itself killed with SIGKILL would leave the server running its turn unsupervised, so a detached `sh` watchdog started with the server ends the server's group within about a second of the supervisor's pid disappearing. The next supervisor start and `ovld doctor` still reap any server left behind, after checking the pid belongs to a Codex app server.

**`reasked-approval-inherits-answer`** — Codex can ask twice about one item (a command that failed in the sandbox is asked again to run outside it, with the same item id), and the channel dedupes cards by native request id, returning the earlier card with its answer. The supervisor gives a later request for an already-settled item its own occurrence id (`<item>#2`), so an earlier allow is never applied to a new, possibly broader, approval; a replay of a still-open card keeps its id.

**`same-user-agent-reaches-credentials`** — Commands the agent runs execute as the person's own OS user, and Codex's workspace-write sandbox allows reading the whole filesystem. With network access (granted per command, or a sandbox that allows it) such a command could read the person's `ovld` login and the channel credential cache, or connect to this session's own socket, and answer the session's cards. The server's environment carries no credential and the channel credential cannot resolve a request, but the same-user boundary is the person's own account. Accepted and documented; a sandbox that denies reading `~/.ovld` is the stronger control where Codex supports it.

**`child-threads-share-the-connection`** — The app server attaches every connection to every thread it creates (LIVE 0.170, and `try_attach_thread_listener` in the 0.170 source), so a subagent's notifications and its approval requests reach the Overlord connection with the child's thread id, and so do those of a thread another client started from scratch. The supervisor keeps the session's thread tree: a child announced by a tree thread's `subAgentActivity` or `spawnAgent` item, a thread whose `thread/read` lineage (`parentThreadId`, `forkedFromId`, or the root's inherited `sessionId`) points into the tree, or a fork reported by thread/started, is the session's work and is attributed to it; any other thread is looked up once and then ignored — no event, no capture, no card, and its approvals are left to its own client.

**`notifications-missed-while-disconnected`** — Notifications are not replayed, so whatever a thread or its subagents did while the supervisor's socket was down (server crash and respawn, dropped connection, a supervisor started on an existing thread) would be missing from the session feed and the change ledger. After every resume the supervisor pages `thread/turns/list` for each thread in the tree (children found by `thread/list {parentThreadId}`) and replays completed items through the live path. Event ids are content-derived and equal the live ones, and the change ledger appends a path once, so nothing already captured is duplicated.

**`fork-history-repeats-source-turns`** — A fork's `thread/turns/list` begins with its source's turns, with the same turn and item ids (LIVE 0.170; 0.169 made paging work across fork segments). Importing them under the fork would credit the source's work to the fork. The import walks the tree root first and skips a turn it has already imported in the same pass. A fork is only known from its thread/started, so one made while Overlord was disconnected is not found by the import (`thread/list` has no fork filter); spawned subagents are.

**`implicit-folder-trust`** — `thread/start` in an untrusted git checkout with a writable sandbox writes `trust_level = "trusted"` for that path into the user's ~/.codex/config.toml (LIVE). The supervisor records the entry its thread added and removes exactly that table when the session ends, only while it holds nothing but that line (ADR 0092; LIVE on 0.170 and 0.171). A symlinked config is edited at its target, so the link survives.

## Native decision shape

- **Codec** `codex-app-server`
- **Never send** `hookSpecificOutput`, `permissionDecision`, `acceptForSession`, `acceptWithExecpolicyAmendment`

Decisions are JSON-RPC results to Codex's own request id: `{"decision": "accept"}`, `{"decision": "decline"}`, or `{"decision": "cancel"}` when Codex did not offer decline. Hook-dialect fields mean nothing here, and standing grants are never sent.

## Unbound-session negative test

Fixture: `fixtures/unbound-session.json` — proves what this adapter's registered
integrations do in a session with no Overlord binding, in an unrelated directory.

