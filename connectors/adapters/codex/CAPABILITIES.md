<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->

# Codex CLI — Overlord agent-session capabilities

**Adapter** `codex` · **Codec** `codex` · **Integration shape** `callback` · **Capability tier** 1 (Observational)

**Harness version verified** `0.171.0` · **range** `>=0.124.0` · **scheme** `semver`

**Descriptor digest** `689c59aa63597d90cf3ef64ac11fd339f543c9f381646f98e6c417c5c31bbc38`

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
| Evidence | fixtures: `fixtures/normalize-session-start.json` |

Shell tools see `CODEX_SESSION_ID` (the root session, which hooks send as `session_id`) and `CODEX_THREAD_ID`; in a root thread both equal the thread id (fixtures/shell-session-env.json). Binding stays on the payload field; attach run by a Codex agent indexes `CODEX_SESSION_ID` in the native-session index, so the payload id can find it. Inside a spawned subagent `session_id` is the root session's id (root-session inheritance, verified in the 0.170 source) and `agent_id` names the child thread, so a subagent's hook events bind to the session that spawned it and record the child as `subagentId`.

The native session id is a **correlation alias only**. Authorization and mission scope come
from the verified channel/session credential; neither the working directory nor an unverified
native id is a binding authority.

## Decision hold

| Field | Value |
| --- | --- |
| Status | ✅ supported |
| Timeout field | `timeout` |
| Harness default | 600s |
| Harness ceiling | none documented |
| Evidence | fixtures: `fixtures/permission-request.json` |

Per-hook timeouts in seconds; the documentation gives a 600-second default. The adapter must set `timeout` explicitly from the window policy and well below that default. The bound is the handler's `timeout` key in hooks.json: the PermissionRequest payload carries no timeout, request id or tool_use_id (0.170.0 live, 0.171.0 schema). Local `codex exec --approve-for-me` smoke tests on 0.147.0 and again on 0.170.0 still emitted PermissionRequest for an escalated shell command before automatic review decided it, so auto-review does not bypass the installed request hook. A 0.170.0 `codex exec -s read-only -c approval_policy="on-request"` run emitted PermissionRequest for the escalated shell command and honored both the allow and the deny bytes in decision-codec.json.

## Mutation-window evidence

| Field | Value |
| --- | --- |
| Classification | `post-only` |
| Executable fixture | `fixtures/mutation-window-evidence.json` |

Recorded pre/post shapes are separate calls and do not prove a paired window. A directly named native edit path normalized by the Codex codec as `file.edited` may record objective-bound, non-exclusive `declared_edit`/`direct` evidence. `apply_patch` destinations are reduced only from its declared `*** Add|Update|Delete File:` headers; patch text itself is never retained.

The completion fixture proves post-only timing but exposes no normalized `file.edited`
path. Runtime file evidence is unavailable for this adapter.

## Capabilities

| Capability | Status | Native | Evidence |
| --- | --- | --- | --- |
| `observe.prompt` | ✅ supported | `UserPromptSubmit` | fixtures: `fixtures/normalize-user-prompt.json` |
| `observe.toolCall` | 🚧 not-implemented | `PreToolUse` | tracked as `latch-engine` |
| `observe.toolResult` | 🚧 not-implemented | `PostToolUse` | tracked as `latch-engine` |
| `observe.fileEdit` | ✅ supported | `PostToolUse` | fixtures: `fixtures/normalize-post-tool-use.json`, `fixtures/normalize-post-tool-use-failed.json`, `fixtures/normalize-post-tool-use-rename.json`, `fixtures/normalize-post-tool-use-subagent.json`, `fixtures/agent-session-hooks.json`, `fixtures/post-tool-use-hook.json`, `fixtures/post-tool-use-unbound.json` |
| `observe.sessionLifecycle` | 🚧 not-implemented | `SessionStart` | tracked as `latch-engine` |
| `decide.shell` | 🚧 not-implemented | `PermissionRequest` | tracked as `latch-engine` |
| `decide.mcp` | 🚧 not-implemented | `PermissionRequest` | tracked as `latch-engine` |
| `decide.fileWrite` | 🚧 not-implemented | `PermissionRequest` | tracked as `latch-engine` |
| `decide.anyTool` | 🚧 not-implemented | `PreToolUse` | tracked as `agent-session-phase-4` |
| `decide.universal` | 🚧 not-implemented | `PermissionRequest` | tracked as `latch-engine` |
| `answer.structuredQuestion` | ❓ unverified | `ToolRequestUserInput` | tracked as `taxonomy-7.2` |
| `answer.persistentAllow` | ❓ unverified | — | tracked as `taxonomy-7.4` |
| `inject.midTurn` | ❓ unverified | `ThreadInjectItems` | tracked as `taxonomy-7.2` |
| `inject.turnBoundary` | 🚧 not-implemented | `Stop` | tracked as `latch-engine` |
| `inject.nextTurn` | 🚧 not-implemented | `Stop` | tracked as `agent-session-phase-4` |
| `terminal.concurrentAnswer` | ⛔ unsupported | — | On the hook path the native prompt is drawn only after the callback returns, so the terminal cannot answer while Overlord holds the decision. (A future app-server integration could change this; it would be a different integrationShape.) (evidence: `connector-harness-taxonomy.md#12-the-axis-that-actually-matters`) |
| `terminal.statusSurface` | ✅ supported | `statusline MCP provider (tui_extensions_statusline)` | fixtures: `fixtures/status-line-state.json`, `fixtures/status-line-provider.json`, `fixtures/shell-session-env.json`, `fixtures/status-line-opt-in.json` |

### Capability notes

- **`observe.toolCall`** — There is no mechanical observation path until Overlord has a native Conversation Hub client.
- **`observe.fileEdit`** — The lifecycle PostToolUse registration forwards Codex's native payload to local `capture-change` only when `OVERLORD_OBJECTIVE_ID` resolves an exact active-session binding. Native paths and declared `apply_patch` headers normalized by the Codex codec as `file.edited` record non-exclusive `declared_edit`/`direct` evidence. Codec-normalized read, search, and fetch callbacks are silent no-ops; mutation-capable callbacks without a normalized edit path, plus shell, generic, unknown, and unmapped callbacks, record unavailable evidence health. It remains separate from mechanical agent-session observation. A subagent's edits run in the same Codex process and environment, so they are captured for the same objective.
- **`decide.universal`** — The native Codex prompt owns approvals; Overlord exposes no remote decision control.
- **`answer.structuredQuestion`** — `codex app-server` exposes ToolRequestUserInput with per-option label/description and an autoResolutionMs — an ACP-shaped structured question in everything but name. It is unreachable until the single-subscriber question is settled.
- **`inject.midTurn`** — ThreadInjectItems/TurnSteer exist on the experimental app-server surface only. The binary carries "expected exactly one client subscribed to the thread, found {}", so if the TUI is that one client Overlord cannot also subscribe and this path is closed.
- **`inject.turnBoundary`** — The recorded Stop payload is shape evidence only; the connector registers no Stop hook.
- **`terminal.statusSurface`** — Codex 0.171+ with the experimental feature `tui_extensions_statusline` (off by default) renders an MCP statusline provider in the TUI footer. The Overlord plugin's MCP server advertises one (`overlord_status_line`, resource `ui://overlord/status-line`); Codex reads it about once a second with the displayed thread's state, allows one second per read and stops polling after an error, so the shim always answers at once: the model, folder and context items it replaces, then the Overlord segment from `ovld status-line --agent codex --ui-tree --native-session-id <thread id>` (mission and objective, awaiting answer or approval, blocked, delivered), cached per thread for 10 s. Binding is the native-session index, written by attach from `CODEX_SESSION_ID` (equal to a root thread's id), else the launch environment; an unbound thread shows only the built-in items. In 0.171 the TUI reads through a shared app-server daemon that outlives the session, so the launch environment is only reliable for the session that started the daemon; the index is the binding that holds. Opt-in: `ovld agent-setup codex --status-line` turns the feature on when unset and selects the provider in user config only when none is selected. A child thread viewed in the TUI is not indexed and shows no segment. Verified live on 0.171.0.

## Hazards

| Hazard | Severity | Verification | Mitigation | Tracked as |
| --- | --- | --- | --- | --- |
| `two-integration-surfaces-could-disagree` | high | verified | implemented | fixture `fixtures/agent-session-hooks.json` |
| `plugin-hooks-fire-inside-app-server-threads` | high | verified | implemented | fixture `fixtures/control-plane-surface-guard.json` |
| `prompt-hook-inside-app-server-threads` | medium | verified | implemented | fixture `fixtures/control-plane-surface-prompt-guard.json` |
| `subagent-hooks-share-the-root-session` | medium | verified | implemented | fixture `fixtures/normalize-post-tool-use-subagent.json` |
| `prompt-and-agent-hook-handlers-inert` | low | verified | accepted | — |
| `hooks-version-and-platform-gate` | medium | verified | required | `agent-session-phase-4` |
| `plugin-hook-trust-pinned-to-bundle` | high | verified | accepted | — |

**`two-integration-surfaces-could-disagree`** — Hooks and `codex app-server` can both answer a permission. A session driven by both would race in a way no revision CAS can settle, so exactly one surface must be chosen and documented before either is built. Chosen per session: user-started Codex sessions use this hooks adapter, which claims no `decide.*`; Overlord-driven sessions use the separate `codex-app-server` adapter, whose server environment silences these hooks (`plugin-hooks-fire-inside-app-server-threads`).

**`plugin-hooks-fire-inside-app-server-threads`** — The installed Overlord Codex plugin's hooks run inside `codex app-server` threads too (spike coo:1325.gqfy: hook/started for userPromptSubmit and postToolUse inside app-server turns). When the `codex-app-server` adapter drives a session, a hook that still reported would capture every edit twice and could attribute a thread to whatever objective started the server. The supervisor starts the server with an allowlisted environment (no objective, mission or channel scope) plus OVERLORD_CONTROL_PLANE_SURFACE, and every Overlord callback exits before any work when that marker is set. In app-server mode only the adapter observes and answers, which also keeps `two-integration-surfaces-could-disagree` closed by construction.

**`prompt-hook-inside-app-server-threads`** — The plugin's UserPromptSubmit callback writes the native-session alias and spawns `ovld protocol hook-event`; inside an Overlord-driven app server it must do neither, for the same reason as the PostToolUse callback.

**`subagent-hooks-share-the-root-session`** — Codex runs the plugin's hooks inside spawned subagents too. In 0.170 every thread of a session tree shares the root's agent-control identity, so a subagent's hook payload carries the root session's `session_id` plus `agent_id` (the child thread) and `agent_type` (its role) — codex-rs `core/src/hook_runtime.rs` and `core/src/agent/control.rs`; the 0.168 `InheritedSessionId` extension does the same for host-started child threads. The codec records `agent_id` as `subagentId`, so a user-started session's subagent work correlates with the parent session instead of appearing as a separate one. Not covered: a 0.170 fork (`/fork`) gets a new session id and correlates as its own session; release notes say 0.171 makes forks inherit the root session id, which has not been run here. SubagentStart and SubagentStop hooks exist but are not registered; the parent's tool calls already show the spawn.

**`prompt-and-agent-hook-handlers-inert`** — Codex parses `prompt` and `agent` hook handlers and then skips them with a "not supported yet" warning (re-checked live on 0.170.0 and in the 0.171.0 hook discovery source), so a manifest that used either would install cleanly, list in `hooks`, and never execute. `command` runs, and since 0.148 an `mcp_tool` handler can call an MCP tool; the connector uses neither `mcp_tool` nor the inert types. The connector must keep emitting `command` handlers only, and must not read the presence of these variants in the schema as availability. `command` is a shell command line run through `$SHELL -lc` (`/bin/sh` when SHELL is unset) — it is not restricted to Bash and not restricted to shell scripting, since the command may invoke any interpreter.

**`hooks-version-and-platform-gate`** — Hooks were experimental behind `features.codex_hooks` before v0.124. The connector requires Codex >=0.124; installations outside that range must be treated as unavailable. Re-checked at 0.171.0: `hooks` is a stable feature and the hook schemas the connector reads are unchanged, but nothing yet enforces the lower bound at install or launch.

**`plugin-hook-trust-pinned-to-bundle`** — Codex runs a plugin hook only after the user approves it in `/hooks`, and from 0.164 the approval (`trusted_content_hash` in config.toml) pins a fingerprint of the whole installed plugin bundle. A fresh `ovld agent-setup codex`, and every connector update after it (each one bumps plugin.json), leaves the Overlord hooks unapproved. The interactive TUI asks for review; `codex exec` skips them silently, so prompt capture and change capture stop without an error. `ovld agent-setup codex` and `ovld doctor` reproduce the fingerprint and name the hooks that will not run. Overlord never writes hook trust: approving a hook stays the user's decision, and `--dangerously-bypass-hook-trust` is not used.

## Native decision shape

- **Codec** `codex`
- **Never send** `updatedInput`, `updatedPermissions`, `interrupt`, `permission`, `followup_message`
- **Allow fixture** `fixtures/decision-codec.json`
- **Deny fixture** `fixtures/decision-codec.json`
- **Defer fixture** `fixtures/decision-codec.json`

PermissionRequest accepts the documented hookSpecificOutput decision.behavior allow/deny shape. `ask` remains a deliberate no-output defer so Codex shows its own approval prompt. The adapter never emits updatedInput, updatedPermissions, or interrupt. The reserved list is not symmetric across events at 0.146.0: PermissionRequest rejects `updatedInput` as unsupported, while PreToolUse accepts it together with `permissionDecision: "allow"` and will rewrite the call. Keeping `updatedInput` on `neverSend` stays a deliberate policy choice — silently editing a tool call a user approved is not a decision Overlord should make — and not an inference about what the harness can do.

## Unbound-session negative test

Fixture: `fixtures/unbound-session.json` — proves what this adapter's registered
integrations do in a session with no Overlord binding, in an unrelated directory.

