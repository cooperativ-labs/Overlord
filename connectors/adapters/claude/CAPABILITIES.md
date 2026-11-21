<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->

# Claude Code — Overlord agent-session capabilities

**Adapter** `claude` · **Codec** `claude` · **Integration shape** `callback` · **Capability tier** 1 (Observational)

**Harness version verified** `2.1.329` · **range** `>=2.1.328` · **scheme** `semver`

**Descriptor digest** `ea275756dcff0c1ed16b366f8bcfad9a185545d2c7fd55ab7afc6933bbad2552`

> The tier is derived from passing fixtures, never authored. `unsupported` means the harness
> cannot do it — do not attempt it. `not-implemented` means it is buildable and unbuilt: that is
> your work. `unverified` means find out first. `supported` without a passing fixture is a CI
> failure, not a claim.

## Session binding

| Field | Value |
| --- | --- |
| Status | ✅ supported |
| Source | `payload` |
| Field | `session_id` |
| Evidence | fixtures: `fixtures/normalize-post-tool-use-shell.json` |

Every hook body carries `session_id`, so binding needs no environment cooperation and works identically for the first event of a session and the thousandth. The native session id is a correlation alias only: authorization and mission scope come from the verified channel credential, never from cwd and never from an unverified native id. `CLAUDE_CODE_SESSION_ID` remains available in tool subprocesses and is used by `attach`, but the payload field is the one the push path depends on because it is present on the path that actually needs it. The `mcp_tool` hooks template it into the tool input as `${session_id}`. Recorded on 2.1.329 (fixtures/subagent-identity.json): hooks inside a subagent or fork carry the parent's `session_id` plus `agent_id`/`agent_type`, so their work binds to the parent's mission; compaction keeps the `session_id`; a nested `claude -p` gets its own id.

The native session id is a **correlation alias only**. Authorization and mission scope come
from the verified channel/session credential; neither the working directory nor an unverified
native id is a binding authority.

## Decision hold

| Field | Value |
| --- | --- |
| Status | ✅ supported |
| Timeout field | `timeout` |
| Harness ceiling | none documented |
| Evidence | fixtures: `fixtures/permission-request.json` |

The hook's `timeout` (seconds, default 600 for mcp_tool) has no documented ceiling. Claude sends no timeout in the payload, so the launch-registered decision hook passes `hookTimeoutSeconds: 300` as a literal input and the tool answers `{}` 5 s before it. Omitting `decision` from a PermissionRequest answer falls through to the native prompt.

## Mutation-window evidence

| Field | Value |
| --- | --- |
| Classification | `post-only` |
| Executable fixture | `fixtures/mutation-window-evidence.json` |

Recorded completion-side write evidence lacks a matching pre/post call pair. A directly named native edit path normalized by the Claude codec as `file.edited` records objective-bound, non-exclusive `declared_edit`/`direct` evidence. Codec-normalized read, search, and fetch callbacks are silent no-ops. Mutation-capable callbacks without a normalized edit path, plus shell, generic, unknown, and unmapped callbacks, record unavailable evidence health.

A completion callback path normalized by the connector-owned codec as `file.edited`
records objective-bound, non-exclusive `declared_edit`/`direct` evidence.
Codec-normalized read, search, and fetch callbacks are silent no-ops. Mutation-capable
callbacks without a normalized edit path, plus shell, generic, unknown, and unmapped
callbacks, record unavailable evidence health.

## Capabilities

| Capability | Status | Native | Evidence |
| --- | --- | --- | --- |
| `observe.prompt` | ✅ supported | `UserPromptSubmit` | fixtures: `fixtures/normalize-user-prompt-submit.json`, `fixtures/native-payload-shapes.json` |
| `observe.toolCall` | 🚧 not-implemented | `PreToolUse` | tracked as `agent-session-phase-2` |
| `observe.toolResult` | 🚧 not-implemented | `PostToolUse` | tracked as `latch-engine` |
| `observe.fileEdit` | ✅ supported | `PostToolUse` | fixtures: `fixtures/normalize-post-tool-use-write.json`, `fixtures/normalize-post-tool-use-notebook.json`, `fixtures/post-tool-use-parity.json`, `fixtures/post-tool-use-capture.json`, `fixtures/hook-capture-fail-open.json`, `fixtures/native-payload-shapes.json` |
| `observe.sessionLifecycle` | 🚧 not-implemented | `SessionStart` | tracked as `latch-engine` |
| `decide.shell` | 🚧 not-implemented | `PermissionRequest` | tracked as `latch-engine` |
| `decide.mcp` | 🚧 not-implemented | `PermissionRequest` | tracked as `latch-engine` |
| `decide.fileWrite` | 🚧 not-implemented | `PermissionRequest` | tracked as `latch-engine` |
| `decide.anyTool` | 🚧 not-implemented | `PreToolUse` | tracked as `latch-engine` |
| `decide.universal` | 🚧 not-implemented | `PermissionRequest` | tracked as `latch-engine` |
| `answer.structuredQuestion` | ❓ unverified | `Elicitation` | tracked as `agent-session-verify-claude-elicitation` |
| `answer.persistentAllow` | 🚧 not-implemented | `PermissionRequest.decision.updatedPermissions` | tracked as `agent-session-standing-permissions` |
| `inject.midTurn` | 🚧 not-implemented | `asyncRewake` | tracked as `latch-engine` |
| `inject.turnBoundary` | 🚧 not-implemented | `Stop` | tracked as `latch-engine` |
| `inject.nextTurn` | 🚧 not-implemented | `Stop` | tracked as `agent-session-phase-4` |
| `terminal.concurrentAnswer` | ⛔ unsupported | — | The native permission prompt is drawn only after the hook returns, so nobody can answer in the terminal while Overlord holds the decision. Holding is simultaneously the only way to answer remotely and the reason the terminal cannot participate. (evidence: `connector-harness-taxonomy.md#12-the-axis-that-actually-matters`) |
| `terminal.statusSurface` | ✅ supported | `statusLine` | fixtures: `fixtures/status-line-payload.json`, `fixtures/status-line-opt-in.json`, `fixtures/status-line-side-effect-free.json` |

### Capability notes

- **`observe.prompt`** — The UserPromptSubmit `mcp_tool` hook calls `overlord_hook_user_prompt_submit`, which runs `ovld protocol hook-event --hook-type UserPromptSubmit` and posts `user_follow_up` mission events. It fails open (fixtures/hooks-fail-open-registration.json). There is no separate mechanical agent-session event stream.
- **`observe.toolCall`** — Deliberately unregistered in Phase 1. PreToolUse is decision-capable: registering it for observation alone would put a script in front of every tool call for no benefit a PostToolUse registration does not already provide, while inheriting the blast radius of the decision path. It lands with the codecs that can actually use it.
- **`observe.toolResult`** — The protocol PostToolUse callback forwards bounded mutation evidence to the local objective ledger, but it does not expose a general tool-result event stream.
- **`observe.fileEdit`** — The PostToolUse `mcp_tool` hook calls `overlord_hook_post_tool_use`, which forwards the rebuilt native payload to local `capture-change` only when `OVERLORD_OBJECTIVE_ID` resolves an exact active-session binding, and always answers `{}` (fails open). A directly named Write/Edit path normalized by the Claude codec as `file.edited` records non-exclusive `declared_edit`/`direct` evidence. Codec-normalized read, search, and fetch callbacks are silent no-ops; mutation-capable callbacks without a normalized edit path, plus shell, generic, unknown, and unmapped callbacks, record unavailable evidence health. Mechanical agent-session observation is not a live Overlord path.
- **`observe.sessionLifecycle`** — No Overlord session-lifecycle registration ships.
- **`decide.universal`** — The native Claude prompt owns approvals; Overlord exposes no remote decision control yet. The transport exists: `ovld launch` registers a PermissionRequest `mcp_tool` hook with `onFailure: "block"` for channel-bound launches only (fixtures/decision-hook-registration.json). A failure to reach the hooks server denies (fixtures/probe-decision-fail-closed.json); a CLI or backend failure answers no decision and keeps the native prompt (fixtures/hook-decision-no-approval-on-failure.json).
- **`answer.structuredQuestion`** — Elicitation/ElicitationResult hook events exist in the binary but their request and response shapes were not read. Write the fixture before relying on them.
- **`answer.persistentAllow`** — Structurally available, deliberately unbuilt. A standing permission grant needs its own design, confirmation, audit language, and RBAC review before any remote surface offers it.
- **`inject.midTurn`** — Session-input injection is not a live Overlord connector path. A future conversation surface must use the native Latch v2 Conversation Hub protocol.
- **`inject.turnBoundary`** — Turn-boundary injection moved off Overlord connectors. The Stop `mcp_tool` hook still checks the channel inbox and reminds the agent to deliver when needed, at most once per session and objective. It fails open (fixtures/hook-stop-fail-open.json). At a final Stop (no running `background_tasks`) in a headless session (`CLAUDE_CODE_ENTRYPOINT` `sdk-*`) the inbox step polls for up to 60 s so an instruction sent just after the run finishes still reaches it; interactive sessions claim once and never wait. The plugin's Stop hook timeout is 100 s (hazard `headless-stop-hold`).
- **`inject.nextTurn`** — No distinct next-turn-only path yet; turn-boundary Stop covers the portable fallback.
- **`terminal.statusSurface`** — Claude Code's `statusLine` command runs `ovld status-line --agent claude --payload-file -`, which shows the bound mission and objective (display ids and titles) and whether the session is awaiting an answer or approval, blocked on a question, or delivered. The binding comes from the native-session index under the payload `session_id`, else the launch environment; an unbound session prints nothing and makes no network call. The command answers from an owner-only local snapshot and refreshes a stale one in a detached, lock-guarded process. A plugin cannot ship a status line, so `ovld agent-setup claude --status-line` (or a yes at its prompt) adds it to the user's settings and never replaces an existing one. Verified live on 2.1.329. The hook `statusMessage` field is unrelated: it is static spinner text with no session-binding predicate, and Overlord does not use it.

## Hazards

| Hazard | Severity | Verification | Mitigation | Tracked as |
| --- | --- | --- | --- | --- |
| `shipped-permission-hook-inert` | high | verified | implemented | fixture `fixtures/decision-hook-registration.json` |
| `shipped-stop-hook-inert` | medium | verified | implemented | fixture `fixtures/hook-stop-fail-open.json` |
| `hook-tool-unlisted-call` | medium | verified | required | `coo:1323.2ewy` |
| `hook-server-no-fallback` | medium | verified | implemented | fixture `fixtures/probe-fail-open.json` |
| `fork-and-subagent-identity-unknown` | medium | verified | implemented | fixture `fixtures/subagent-identity.json` |
| `subagent-stop-unregistered` | medium | verified | implemented | fixture `fixtures/subagent-stop-background.json` |
| `nested-session-inherits-launch-env` | medium | verified | implemented | fixture `fixtures/hook-nested-session-gate.json` |
| `headless-stop-hold` | low | verified | implemented | fixture `fixtures/probe-stop-heartbeat.json` |

**`shipped-permission-hook-inert`** — Retired with the shell scripts (coo:1323). The old plugin shipped an unregistered `scripts/permission-hook.sh` that called a nonexistent `ovld protocol permission-request` and backgrounded the call, so it could never return a decision. The script is deleted. The decision path is now a PermissionRequest `mcp_tool` hook that `ovld launch` registers only for channel-bound sessions, with `onFailure: "block"`.

**`shipped-stop-hook-inert`** — Fixed in coo:1323. The old Stop script called `ovld protocol hook-event --hook-type Stop`, which the CLI rejected, and gated on a `MISSION_ID` the pod did not set. The Stop hook is now an `mcp_tool` call: it binds through the launch environment or the native-session index that `attach` writes, `hook-event` accepts Stop and returns delivery status, and the reminder blocks at most once per session and objective. Failures fail open.

**`hook-tool-unlisted-call`** — The hooks server omits its hook tools from `tools/list` so the model never sees them, and Claude Code still calls them from `mcp_tool` hooks (verified on 2.1.329). That behavior is undocumented. A release that validated hook tools against `tools/list` would break every Overlord hook, and in channel-bound launches would deny every permission request. Doctor warns when Claude Code is newer than `verifiedVersion`; the probe must be re-run on each `verifiedVersion` bump.

**`hook-server-no-fallback`** — Claude Code has no fallback from a failed `mcp_tool` hook to another hook, so when the hooks server is not connected (no `node` on PATH, server disabled in `/mcp`, plugin not installed) follow-up capture, file capture and the Stop reminder silently stop while the session keeps working. Mitigated: these hooks fail open (fixtures/probe-fail-open.json), `ovld agent-setup claude` and `ovld doctor` report a missing or disconnected server with the fix, and the overlord-mission skill tells the agent to use the `ovld protocol` CLI.

**`fork-and-subagent-identity-unknown`** — Resolved (coo:1323.n938). Recorded on 2.1.329: every hook fired inside a subagent, including a `fork` subagent, carries the parent's `session_id` and adds `agent_id` and `agent_type`; `${agent_id}`/`${agent_type}` template the same values into an `mcp_tool` input and `""` in the main agent. PreCompact, PostCompact and the post-compaction SessionStart keep the `session_id` (main-thread compaction carries no `agent_id`). Binding by `session_id` therefore routes subagent and fork work to the parent's binding, which is correct because they work on the parent's objective, and a binding survives compaction. No Overlord hook needs `agent_id` today; it stays available if a decision card ever has to name the subagent.

**`subagent-stop-unregistered`** — Resolved (coo:1323.n938); `SubagentStop` stays unregistered on purpose. Recorded on 2.1.329: the main `Stop` fires while background subagents still run and lists them in `background_tasks`; each subagent's end fires `SubagentStop` (parent `session_id` plus `agent_id`); Claude then wakes the main agent with a harness-written `<task-notification>` prompt through UserPromptSubmit, and that turn ends in another main `Stop` with `background_tasks` empty. So the main Stop does run after subagent work completes. A subagent's stop is not the end of the objective, so a reminder or an inbox claim there would be wrong. The Stop hook templates `background_tasks`; while one is running, the delivery reminder and the headless inbox wait are deferred to the later Stop, and `hook-event` never records a `<task-notification>` prompt as a user follow-up.

**`nested-session-inherits-launch-env`** — A `claude -p` started from a Bash tool of a launched session gets its own session id (2.1.317+, and on 2.1.329 even with `CLAUDE_CODE_DISABLE_NESTED_SESSION_ID=1`), so it never matches the native-session index. But it inherits the launch environment (mission, objective, session channel), which bound it to the parent's mission: its prompt would be recorded as the user's follow-up, its Stop could claim the parent's pending instruction or be told to deliver the parent's objective. Mitigated: Claude Code exports `CLAUDE_PID` to tool processes but not to MCP servers, so a hooks server that sees a `CLAUDE_PID` other than its own parent belongs to a nested session. Its follow-up, Stop and decision hooks then ignore the launch binding (it may still bind through the index under its own id if its agent attaches); file capture keeps the launch objective because the nested process edits the same checkout for the same objective. Limit: a session launched by an `ovld` process that itself runs inside a Claude Code tool inherits that outer `CLAUDE_PID` and is treated as nested.

**`headless-stop-hold`** — A headless final Stop holds the inbox open for up to 60 s. Before 2.1.323 a host could take a hook that long for a hung turn. Since 2.1.323 `claude -p` and SDK sessions emit a progress heartbeat every 30 s while a hook runs (recorded on 2.1.329: `tool_progress` with `heartbeat: true` at 30 s during a 45 s Stop hook). Interactive sessions never wait, the wait is skipped while background subagents run, and the Stop hook timeout (100 s) exceeds the wait plus the inbox (16 s) and reminder (10 s) budgets.

## Native decision shape

- **Codec** `claude`
- **Never send** `permission`, `user_message`, `agent_message`, `followup_message`
- **Allow fixture** `fixtures/decision-codec.json`
- **Deny fixture** `fixtures/decision-codec.json`
- **Defer fixture** `fixtures/decision-codec.json`

Claude expects `hookSpecificOutput.decision` with behavior allow/deny. Cursor's flat `permission` dialect must never be emitted here; relying on a cross-vendor dialect fallback is how a connector silently stops working after an upstream release. The decision-codec fixture executes the shared interpreter and pins all three outcomes.

## Unbound-session negative test

Fixture: `fixtures/unbound-session.json` — proves what this adapter's registered
integrations do in a session with no Overlord binding, in an unrelated directory.

