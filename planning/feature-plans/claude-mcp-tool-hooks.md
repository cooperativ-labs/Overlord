# Claude plugin hooks over `mcp_tool`

Mission: coo:1323 — Replace Claude plugin shell hooks with `mcp_tool` hooks.
This plan is the output of objective 1 (coo:1323.2xz7). Objectives 2–6 build on it.

Contract impact: minor (see §12; one clause is a judgment call that a reviewer may classify as major)

Verified against Claude Code **2.1.329** on 2026-11-20 (docs plus a live probe, §2.3).

---

## 0. Decisions at a glance

| Question | Decision |
| --- | --- |
| Hook target | A **local stdio MCP server bundled by the Claude plugin** (`plugin:overlord:overlord-hooks`), rendered from the connector core shim in a hooks-only mode. Not hosted HTTP MCP (§6). |
| Tool visibility | Hook tools are **omitted from `tools/list`** but still answered on `tools/call`. Verified to work on 2.1.329 (§7). Each tool also checks the event name server-side. |
| Shared core | Each hook tool forwards its rebuilt native payload on stdin to the **same `ovld` command** the CLI fallback uses (`protocol hook-event`, `protocol capture-change`, `agent-session request`). Parity holds by construction (§10). |
| Decision path | `PermissionRequest` → `overlord_hook_permission_request`, `onFailure: "block"` (failure denies). The hook is **registered per launch through `claude --settings`, not in the plugin's static `hooks.json`** (§4.2). |
| Capture / follow-up / Stop | Fail open: no `onFailure` (default non-blocking). `onFailure` has no effect on Stop anyway (§2.1). |
| CLI fallback | No automatic fallback exists in Claude Code (§8). The `ovld protocol` / `ovld agent-session` commands stay. Doctor and setup detect the hook server. Attach reports a missing hook server. The skill points the agent to the CLI. |
| Session binding | Authority unchanged: the launch environment, which the plugin MCP server inherits (verified). The payload `session_id` is a correlation alias. The dead cwd-keyed temp file is replaced by a native-session index that `attach` writes, used only for mission-lifecycle hooks, never for file capture (§9). |
| Cursor (taxonomy-7.1) | The hazard is **real today**: Cursor imports Claude plugin hooks by default. It documents `command`/`prompt` hook types only, so an `mcp_tool`-only `hooks.json` is expected to be inert in Cursor. Moving the fail-closed decision hook out of the plugin removes the worst case. Final verification is assigned to objective 2 (§11). |

---

## 1. Current state (inventory, with defects found)

`connectors/adapters/claude/hooks/hooks.json` registers three command hooks:

| Event | Script | What it does today | Real effect |
| --- | --- | --- | --- |
| `UserPromptSubmit` (`.*`) | `scripts/user-prompt-submit-hook.sh` | bash → python3: keeps a turn counter in `~/.ovld/claude-user-prompt-hook/<sha(session_id)>`, writes `~/.ovld/native-sessions/<key>`, reads a session key from `$SESSION_KEY` or a cwd-keyed temp file, then fire-and-forget `ovld protocol hook-event --hook-type UserPromptSubmit` | Works only when `MISSION_ID` is in the environment (launched sessions). Records `user_follow_up`. |
| `PostToolUse` (`Edit\|Write\|MultiEdit\|NotebookEdit\|Bash`) | `scripts/post-tool-use-hook.sh` (rendered at setup from `connectors/core/scripts/capture-change-hook.sh`, not checked in) | `ovld protocol capture-change --agent claude --objective-id $OVERLORD_OBJECTIVE_ID` with the payload on stdin | Local objective ledger only (`cli/src/change-ledger.ts`, owner-only files under the global data dir). No network. |
| `Stop` (`.*`) | `scripts/stop-hook.sh` | bash → python3: reads the cwd-keyed temp file, then `ovld protocol hook-event --hook-type Stop`, then parses `deliveryStatus` | **Inert.** `packages/core/service/protocol.ts:1511` rejects every `hookType` except `UserPromptSubmit`, and nothing produces `deliveryStatus` (hazard `shipped-stop-hook-inert`). |

`scripts/permission-hook.sh` ships but is **not registered**. It calls a non-existent `ovld protocol permission-request` and backgrounds the call (hazard `shipped-permission-hook-inert`). Every `decide.*` capability for Claude is `not-implemented`. There is no Claude decision path today.

Defects found while planning. The listed objectives must fix them:

1. **The cwd-keyed temp file is written by nothing.** `.overlord-session-<b64(cwd)>` is read by the Claude, Codex and Cursor prompt scripts and by the Claude Stop script, but no code in `cli/src` writes it. The session-key lookup in every script is dead code. → Replace it (§9).
2. **The Claude decision codec emits the wrong shape.** `codec/claude.decision-codec.yaml` emits `hookSpecificOutput.decision: allow` (a string). Claude Code requires `decision: { "behavior": "allow" | "deny" }` (hooks reference, "PermissionRequest decision control"). Under `onFailure: "block"`, output that fails schema validation counts as a failure, so **every remote allow would become a deny**. → Fix in objective 9hkq, with a fixture.
3. **`fixtures/permission-request.json` asserts fields Claude does not send.** The documented PermissionRequest input has `tool_name`, `tool_input`, `permission_suggestions` and (for MCP tools) `mcp_server`. It has no `request_id`, `tool_use_id` or `timeout`. The decision codec's `requestIdPaths`, `callIdPaths` and `timeoutPaths` will be empty. → Re-record the fixture from a real payload and supply the timeout as a literal hook input (§4.1).
4. **`fixtures/inject-stop-block.json` asserts `agent-session-inbox.sh` in `hooks.json`,** which is false. It is an orphan: no capability references it. → Replace it in objective 5jzn.
5. **The local shim speaks only `Content-Length` framing.** `connectors/core/scripts/overlord-mcp.mjs` `parseMessages` waits for a `\r\n\r\n` header. Claude Code's stdio transport (and the MCP stdio spec) is newline-delimited JSON. The probe server (§2.3) used NDJSON. As written, the shim would never answer `initialize` under Claude Code. → The hooks mode (and preferably the whole shim) must accept NDJSON, auto-detected from the first byte (`{` versus `C`), and reply in the framing it received.
6. `hook-event` has **no entry in `contract/protocol-commands.yaml`** (it is only named in a deny list). → Add one with the contract change (§12).

---

## 2. Verified Claude Code `mcp_tool` hook contract

Sources: https://code.claude.com/docs/en/hooks.md (snapshot 2026-11-20), https://code.claude.com/docs/en/mcp.md, Claude Code CHANGELOG through 2.1.329. Section 2.3 records a live probe for behavior the docs leave unstated.

### 2.1 Documented

**Config fields** (on top of the common `type`, `timeout`, `statusMessage`, `if`):

| Field | Req | Meaning |
| --- | --- | --- |
| `server` | yes | Configured server name. A plugin-bundled server uses the scoped name `plugin:<plugin>:<server>`, not the bare key. |
| `tool` | yes | Tool name on that server. |
| `input` | no | Tool arguments. String values support `${path}` substitution from the hook's JSON input, e.g. `"${tool_input.file_path}"`. |
| `onFailure` | no | `"continue"` (default behavior) or `"block"`. `block` on `mcp_tool` requires **≥ 2.1.328** (CHANGELOG 2.1.328: "Added `"onFailure": "block"` for `mcp_tool` hooks, as for command and HTTP hooks"). |

`matcher` stays at group level. `if` (permission-rule syntax) is evaluated only on PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest and PermissionDenied. On any other event, a hook with `if` never runs.

**Result mapping.** "Claude Code reads the tool's text content the same way it reads command-hook stdout, following the parsing rule under exit code 0." The text must be exactly one JSON object, with nothing but whitespace around it. That object carries the ordinary hook output fields: `decision`/`reason`, `continue`, `stopReason`, `systemMessage`, and `hookSpecificOutput.{hookEventName, permissionDecision, additionalContext, decision{behavior, updatedInput, updatedPermissions, message, interrupt}}`. `isError: true` is a non-blocking error unless `onFailure: "block"`. `structuredContent` is not used for hooks. MCP has no exit-code equivalent.

**Timeout.** Default 600 s for `mcp_tool`. It is lowered to 30 s on UserPromptSubmit. A timed-out hook is cancelled and its output discarded ("renders no decision"). On blocking events such as PreToolUse or Stop, Claude waits for a still-connecting server for at most `MCP_TIMEOUT`, within the hook's own timeout.

**What counts as failure** ("Block the action when a hook fails"):
- *MCP failure*: the server isn't connected, or the tool returns an error. With `block` set on an event such as PreToolUse or UserPromptSubmit, "a non-empty answer also counts unless it's `{}` or JSON that sets a hook output field other than `reason`".
- *Timeout*: the hook reaches its `timeout`.
- *Invalid output*: the JSON can't be parsed or fails schema validation.

With `block`, a failure does what exit code 2 does on that event. **On `PermissionRequest` it denies the request.** `onFailure` **has no effect on `Stop`, `SubagentStop`, `TaskCompleted` or `TeammateIdle`.**

**Events supporting `mcp_tool`:** PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, PermissionRequest, PermissionDenied, UserPromptSubmit, UserPromptExpansion, Stop, SubagentStop, TaskCreated, TaskCompleted, TeammateIdle, plus (command/http/mcp_tool only) SubagentStart, SessionEnd, PreCompact, PostCompact, Notification, Elicitation, ElicitationResult, ConfigChange, CwdChanged, FileChanged, InstructionsLoaded, MessageDisplay, Pre/PostModelSwitch, StopFailure, WorktreeCreate/Remove, DirectoryAdded.

Exceptions:
- **`SessionStart` at launch (including `--continue`/`--resume`) and every `Setup` event fire before MCP servers are available, so their `mcp_tool` hooks are skipped.** SessionStart after `/clear` or compaction does run them.

**Multiple hooks:** "When an event fires, its matching hooks run in parallel." Identical handlers across settings files run once, but a plugin's copy stays separate. PreToolUse precedence is deny > defer > ask > allow. **There is no documented fallback** from a failed `mcp_tool` hook to another hook.

**Oversize answers:** over 16 MiB, or an answer with no text, yields "gave no verdict". That error refuses the tool call on PreToolUse and is non-blocking elsewhere.

**Hiding a tool from the model:** not documented.

### 2.2 Version notes relevant to later objectives

- 2.1.323: progress heartbeat every 30 s while hooks run long in `claude -p` / SDK sessions (objective n938).
- 2.1.323: PreCompact, PostCompact and post-compaction SessionStart hooks now receive `agent_id`/`agent_type` (objective n938).
- 2.1.284 / 2.1.323: the non-interactive first turn waits up to 2 s for servers named by an `mcp_tool` hook (`CLAUDE_CODE_MCP_STARTUP_WAIT_MS`).
- 2.1.327: `claude mcp add-json <name> -` reads the definition from stdin (`cli/src/claude-mcp-registration.ts`).

### 2.3 Probe results (Claude Code 2.1.329, `claude -p --model haiku`, isolated `--setting-sources ""`, `--strict-mcp-config`)

A throwaway NDJSON stdio server logged every `tools/call`. Hooks were set through `--settings` for UserPromptSubmit, PostToolUse(Bash) and Stop.

| # | Question | Observed |
| --- | --- | --- |
| P1 | What does the tool receive? | **Only the templated `input` object.** With no `input`, `arguments` is `{}`. There is no `_meta`, and the full hook JSON is not passed. |
| P2 | `${path}` semantics | `${session_id}`, `${cwd}`, `${prompt}`, `${hook_event_name}`, `${transcript_path}`, `${tool_name}`, `${tool_use_id}` and `${tool_input.command}` substitute as strings. **An object value (`${tool_input}`, `${tool_response}`) arrives as a JSON-encoded string.** Booleans arrive as strings (`"true"`/`"false"`). Missing paths (`${agent_id}` in the main agent, `${does_not_exist}`) become `""`. Templating applies inside nested objects and within longer strings (`"x-${session_id}-y"`). Non-string literals (`5`) pass through. **`${}` is not substituted**, so there is no way to pass the whole payload. |
| P3 | Server environment | The plugin/stdio server process **inherits the Claude Code process environment** (`MISSION_ID` was visible) and also receives `CLAUDE_PROJECT_DIR` and `CLAUDE_CODE_SESSION_ID`. One server process per session. |
| P4 | Stop output | `{"decision":"block","reason":"…"}` in the tool's text made Claude continue and act on the reason. The second Stop carried `stop_hook_active: "true"`. |
| P5 | UserPromptSubmit output | `hookSpecificOutput.additionalContext` reached the model. |
| P6 | `--disallowedTools mcp__probe__*` | The tools vanished from the model's list, **and hooks still called them**. A permission deny does not block the hook's own call. |
| P7 | **Server omits the tools from `tools/list`** | Hooks still called them successfully, and the model saw no such tools. This also works with an empty `tools/list`. |
| P8 | `onFailure: "block"`, server not configured | UserPromptSubmit was blocked: `failed; blocking because onFailure is "block" and the hook got no usable answer from its MCP server … MCP server 'nosuch' not connected`. |
| P9 | `onFailure: "block"`, tool returns `isError: true` | Blocked with the same message, and the error detail was withheld from the transcript. |

Not probed: PermissionRequest behavior (it does not fire in `-p` without a prompting tool), plugin-scoped server names referenced from `--settings`, and hooks inside subagents. Objective 5jzn must verify the first two (§13).

---

## 3. Target architecture

```
Claude Code ──hook (mcp_tool)──▶ plugin:overlord:overlord-hooks   (stdio, NDJSON, hooks-only mode of the
                                       │                           rendered connector shim; lists no tools)
                                       │ 1. per-call scope gate (env / native-session index stat) → `{}` if unbound
                                       │ 2. rebuild native payload from templated fields (JSON-decode object fields)
                                       ▼ 3. spawn the SAME CLI command as the fallback, payload on stdin
                     ovld protocol hook-event | ovld protocol capture-change | ovld agent-session request|inbox
                                       │
                                       ▼
                         CLI core (bind/scope, codecs, ledger, channel client) ──▶ REST
```

The hooks server is a separate plugin MCP server entry, declared in the plugin's `.mcp.json` (or `mcpServers` in `plugin.json`):

```json
{ "mcpServers": { "overlord-hooks": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/overlord-mcp.mjs", "--hooks"] } } }
```

The shim is rendered per adapter (`__OVERLORD_ADAPTER_KEY__` → `claude`) by `cli/src/connector-core-render.ts` exactly as today. `--hooks` selects the hook tool set and an empty `tools/list`. Without `--hooks`, the shim behaves as it does now for the adapters that use it as a model-facing server. The Claude plugin does not ship the model-facing shim: model-facing tools come from the hosted connector. That is unchanged.

Spawn cost: `ovld` startup measured at about 70 ms. That is acceptable per hook call, and it buys a single implementation (§10).

---

## 4. Hook → tool mapping

### 4.1 Mapping table

| Event (matcher) | Registered in | Tool | onFailure | timeout | `input` (all strings unless noted) | Output |
| --- | --- | --- | --- | --- | --- | --- |
| `PermissionRequest` (`.*`) | **launch settings** (§4.2) | `overlord_hook_permission_request` | **`block`** | 300 | `hook_event_name`, `session_id`, `cwd`, `permission_mode`, `tool_name`, `tool_input` (JSON string), `hookTimeoutSeconds: 300` (number literal) | `{}` (no decision → native prompt), or `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`, or `…{"behavior":"deny","message":"…"}` |
| `UserPromptSubmit` (`.*`) | plugin `hooks.json` | `overlord_hook_user_prompt_submit` | — (open) | 10 | `hook_event_name`, `session_id`, `cwd`, `prompt` | always `{}` |
| `PostToolUse` (`Edit\|Write\|MultiEdit\|NotebookEdit\|Bash`) | plugin `hooks.json` | `overlord_hook_post_tool_use` | — (open) | 15 | `hook_event_name`, `session_id`, `cwd`, `tool_name`, `tool_use_id`, `tool_input` (JSON string) | always `{}` |
| `Stop` (`.*`) | plugin `hooks.json` | `overlord_hook_stop` | — (no effect on Stop) | 100 (was 30; §15) | `hook_event_name`, `session_id`, `cwd`, `stop_hook_active`, `background_tasks` (JSON string; §15) | `{}`, or `{"decision":"block","reason":"…"}` only when there is something to inject |

Rules for every hook tool:

- **Always answer with exactly one JSON object, `{}` at minimum.** Never empty text, never plain text. Under `onFailure: block` on most events, a non-empty answer that isn't `{}` or a valid output object counts as failure. Keep one rule for all tools.
- **Never template `transcript_path`, `tool_response` or `permission_suggestions`.** Paths and tool output cross the privacy boundary (`contract/protocol.md`, Hook Surface). Capture needs only `tool_input`, because PostToolUse is success-only by harness contract (`claude.codec.yaml`).
- **Rebuild the native payload** as `{ hook_event_name, session_id, cwd, tool_name, tool_input: JSON.parse(tool_input), … }` and drop empty-string fields (the probe showed that missing paths become `""`). This keeps the existing connector codecs (`claude.codec.yaml`, `claude.decision-codec.yaml`) as the only decoders. Change the codec request paths to match what Claude actually sends (§1 item 3).
- **Check the event name server-side:** each tool rejects (`{}`, no spawn) a payload whose `hook_event_name` isn't its own event. This is defense in depth for §7, not a security boundary.
- **Internal deadline.** The decision tool must return `{}` at least 5 s before `hookTimeoutSeconds`. A Claude-side timeout on a `block` hook is a deny (§2.1), so a backend that is slow to answer has to degrade to the native prompt, not to a deny. The other tools use a 3 s internal budget for any synchronous network wait. Past that budget the UserPromptSubmit tool returns `{}` and lets the spawned `ovld` finish in the background, preserving today's fire-and-forget behavior.

### 4.2 Why the fail-closed decision hook is registered per launch, not in the plugin

Plugin hooks run in **every** Claude Code session on the machine, including unbound sessions (the user's own agent in an unrelated directory). A `PermissionRequest` hook with `onFailure: "block"` in the plugin would turn any local fault into a **machine-wide denial of every permission prompt**. Such faults include `node` missing from PATH, the plugin's MCP server disabled in `/mcp`, a shim crash, or `ovld` uninstalled while the plugin stays enabled. That violates the scope-gate rule ("an unbound session produces no request … and no observable delay"), and it is the failure the Cursor descriptor already warns about (`fail-closed-inverts-fallback`).

So `ovld launch` adds the decision hook only for sessions it launched and bound (those with a session channel), through `claude --settings '<json>'`, alongside the existing launch environment. Before injecting the hook, launch verifies that the plugin and its `overlord-hooks` server are installed and enabled. If they are not, launch omits the hook, warns, and the session falls back to the native prompt. A chat-attached session has no session channel, so it has no remote decision path to lose.

> **This deviates from objective 5jzn step 1**, which lists "decision" among the events to put in the plugin's `hooks.json`. Objective 5jzn should follow this section: `hooks.json` holds UserPromptSubmit, PostToolUse and Stop, and the PermissionRequest hook is emitted by launch. The fail-closed property the mission requires is unchanged.

The decision tool forwards to `ovld agent-session request --agent claude --payload-file -`. Unbound, unresolved, or backend-error outcomes all produce no decision, which yields `{}` and the native prompt. That keeps the core failure rule. Only the **harness→local-tool hop** failing (server down, tool error, Claude-side timeout, invalid output) denies. "No failure may manufacture an approval" still holds, because a block is a deny.

### 4.3 Stop semantics

`overlord_hook_stop` runs two checks in order and returns the first non-empty result:

1. **Inbox (turn-boundary inject)**, only when the session has a session channel. It calls the existing `agent-session inbox` core path `claude-turn-boundary`, which already emits `{"decision":"block","reason":…}` and claims exactly once.
   - `inject.turnBoundary` stays `not-implemented` in the descriptor until a fixture proves it.
   - The descriptor note says turn-boundary injection moved to the Latch Conversation Hub. Objective 9hkq should confirm with the owner whether this branch ships enabled, or stays behind the channel's effective capability snapshot (which is the contract's gating rule anyway).
2. **Delivery reminder.** `hook-event --hook-type Stop` (newly accepted, §12) returns `deliveryStatus { needed, reason }` for the bound session. The tool emits `{"decision":"block","reason":"[Overlord] …"}` **only when `needed` and `stop_hook_active` is `"false"`**, and at most once per session and objective (a local marker in the global data dir). This repairs `shipped-stop-hook-inert` without creating a Stop loop.

Stop is fail-open by harness design: `onFailure` has no effect on it (§2.1). An unreachable server or a tool error lets the turn end. That is the required behavior.

`SubagentStop` is not registered. It stays with hazard `subagent-stop-unregistered` (coo:585) for objective n938.

---

## 5. Exact output shapes (pin these with fixtures in 9hkq)

| Case | Tool text content |
| --- | --- |
| Any tool, unbound / nothing to do / internal error | `{}` |
| Decision allow | `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` |
| Decision deny | `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"<resolver message>"}}}` |
| Decision ask / defer / timeout | `{}` |
| Stop inject or reminder | `{"decision":"block","reason":"<text>"}` |
| Never emitted | `isError: true` for a business outcome. Tool errors are reserved for genuine malfunction, so `block` means "the hook could not run". |

`updatedPermissions` (`answer.persistentAllow`) stays unbuilt, as the descriptor says.

---

## 6. Hook target: local stdio server, not hosted HTTP MCP

Hosted MCP (`https://app.ovld.ai/mcp`, the `claude.ai Overlord` connector) cannot be the hook target:

1. **Capture is machine-local.** `capture-change` writes the owner-only objective ledger under the global data dir (`cli/src/change-ledger.ts`). No server can do that.
2. **Wrong credential family.** The agent-session routes accept only the channel-scoped `OVERLORD_SESSION_CHANNEL_TOKEN` (env or the owner-only cache), and "a normal user or session token is rejected on the adapter route family" (`contract/protocol.md`). Hosted MCP authenticates the user through OAuth.
3. **No session context.** Binding comes from the launch environment of this Claude process (§9). Hosted MCP cannot see it.
4. **Failure coupling.** With `block`, a hosted outage or an expired OAuth token would deny every permission prompt. Hooks "don't start an OAuth flow" (§2.1). A local server keeps the fail-closed hop local, and the CLI core degrades backend errors to "no decision".
5. The `mcp` component contract says it does not own "Local filesystem, worktree, runner claim … operations".

Therefore: a plugin-bundled local stdio server. Being plugin-bundled means `ovld agent-setup claude` does not need `claude mcp add`, and no credential is ever placed in an MCP definition. The server reads credentials the same way the CLI does, from the environment and owner-only files. `claude-mcp-registration.ts` stays the only path if a user-scope registration is ever needed.

---

## 7. Hook-only tool visibility

Options considered:

| Option | Verdict |
| --- | --- |
| Separate server entry that lists its tools normally | Rejected. The model would see four internal tools and could call them. |
| `permissions.deny` / `--disallowedTools` on `mcp__plugin_overlord_overlord-hooks__*` | Works (P6), but **a plugin cannot set the user's permission rules**. It would need a settings write from setup, which the user can drop. It remains an optional hardening step for launched sessions, through the same `--settings` JSON as §4.2. |
| Annotation or `_meta` | No documented annotation hides a tool. |
| **Omit from `tools/list`, answer `tools/call`** | **Chosen.** Verified on 2.1.329 (P7). Zero model-visible surface. |
| Server-side guard | Kept as defense in depth: event-name check (§4.1) and scope gate. |

Hazard to record in `harness-capabilities.yaml` (objective 5jzn): `hook-tool-unlisted-call` (severity medium). The behavior is undocumented, and a Claude Code release that validated hook tools against `tools/list` would break every hook. For the fail-closed decision hook, that break means every launched session denies permissions. Mitigations:
- objective 2ewy re-runs the probe each time `verifiedVersion` is bumped;
- doctor reports a Claude Code version above `verifiedVersion` as a warning;
- if the behavior changes, fall back to listing the tools with an explicit "internal — do not call" description plus a per-launch deny rule.

Even if the model did reach a hook tool, it gains nothing it cannot already do through Bash with the `ovld` CLI. Hiding the tools keeps the model's tool list clean; it is not a privilege boundary.

---

## 8. CLI fallback

**Can Claude Code fall back from an `mcp_tool` hook to a command hook?** No. The docs describe only `continue`/`block` on failure and state that "matching hooks run in parallel". Registering a command hook alongside the `mcp_tool` hook would run both every time, giving double capture, double follow-up events and two Stop answers. Reintroducing a command hook also breaks the mission constraint, so it is **not** proposed. Automatic fallback is therefore impossible without a shell hook, and the fallback is defined as follows:

1. **The CLI stays fully supported and unchanged in behavior.** `ovld protocol hook-event`, `ovld protocol capture-change`, `ovld agent-session request|inbox|event`, and every other `ovld protocol` command keep working. Codex, Cursor, Pi and Antigravity keep using them through their own hooks.
2. **Doctor** (`ovld doctor` / `ovld agent-setup claude --check`):
   - Error: Claude Code < 2.1.328.
   - Error: the Overlord plugin is not installed or enabled.
   - Error: `plugin:overlord:overlord-hooks` is not `✔ Connected` in `claude mcp list`. The output names the fix (re-run `ovld agent-setup claude`, check `node` on PATH, enable the server in `/mcp`) and says that until it is fixed, follow-ups, file capture, the Stop reminder and remote decisions are off, and the agent must use `ovld protocol …`.
   - Warning: Claude Code newer than `verifiedVersion`.
3. **Setup** (`ovld agent-setup claude`):
   - renders the shim and `.mcp.json` into the marketplace plugin;
   - removes the obsolete managed scripts (`scripts/{stop,user-prompt-submit,permission,post-tool-use}-hook.sh`) from existing installs, only if their content matches a known managed rendering (the managed-file rule);
   - runs the doctor check above.
4. **Attach.** The hooks server writes a liveness marker on `initialize`, keyed by `sha256(CLAUDE_CODE_SESSION_ID)` (owner-only, global data dir; P3 shows the variable is present). When `ovld protocol attach` runs inside Claude Code, it checks for this session's marker. If the marker is missing, the attach response adds an instruction: hooks are not running, so declare changed files with `--declared-paths-json` on `update`/`deliver`, and do not expect the Stop reminder.
5. **Skill** (Claude adapter notes in `skills/overlord-mission`): "If Overlord MCP tools fail or are unavailable, use the equivalent `ovld protocol` command; if attach reports hooks are not running, declare changed paths explicitly." The hosted model-facing tools already have CLI equivalents, and the skill lists them.

---

## 9. Session binding without the cwd-keyed temp file

Contract constraints (`cli/src/agent-session/bind.ts`, `contract/protocol.md`):
- channel credential and protocol session key authorize;
- native session id and cwd may only locate an existing binding;
- file capture requires an explicit objective identity;
- the scope gate runs before any spawn, log, write or network call.

Decision:

| Hook | Locate binding by | Authority |
| --- | --- | --- |
| PostToolUse capture | `OVERLORD_OBJECTIVE_ID` from the inherited launch environment, exactly as today | active-session manifest entry for that objective (written by `attach`) |
| PermissionRequest / Stop inbox | `OVERLORD_SESSION_CHANNEL_ID` from the inherited environment, as today | channel credential (env or owner-only cache) |
| UserPromptSubmit / Stop reminder | 1) `OVERLORD_MISSION_ID`/`MISSION_ID` and `OVERLORD_OBJECTIVE_ID` from the inherited environment; else 2) **native-session index** lookup by the payload `session_id` | protocol session key from the active-session manifest |

**Native-session index** (replaces the temp file):
- **Write:** when `ovld protocol attach` (or `connect`/`resume`) runs with a known native session id (`--external-session-id`, or `CLAUDE_CODE_SESSION_ID` in the Bash tool's environment), it writes `<globalDataDir>/native-session-index/<sha256("claude\0" + nativeId)>`. The file is owner-only, holds `{ workingDirectory, missionId, objectiveId }`, and contains no secret: the session key stays in the existing active-session manifest.
- **Read:** the hooks server's gate is one environment check plus at most one `stat` of that index path. Both are allowed pre-gate ("lookup in already-known local state"). No match means `{}` with no spawn.
- **Remove:** finalize and deliver remove the entry.
- **Restriction:** the index never feeds `capture-change`, so file capture keeps requiring an explicit objective (the contract's Hook Surface "Scope" rule).

Why not the MCP server session alone: the server process lives for the whole Claude session, and its environment is frozen at start. A mid-session `attach` cannot change it, and after `/clear` the native id changes while the process stays. Why not cwd: two agents can share a checkout. The payload `session_id` arrives fresh on every call (P2) and is the right correlation key.

**CLI/MCP consistency.** One resolver, `resolveHookBinding({ env, nativeSessionId, agent })` in `cli/src`, is used by `hook-event` (when `--session-key` is absent) and reached by the MCP path because the hooks server spawns the same command. The server's pre-gate is a deliberate, documented duplicate of the cheap part only, following the `agent-session-hook.sh` precedent. The turn counter from `user-prompt-submit-hook.sh` moves into the CLI, keyed by native session id, under the global data dir.

Objective n938 checked nested `claude -p` (§15): it gets its own native id and never matches the index, but it inherited the launch environment and so bound to the parent's mission. The hooks server now detects a nested session and ignores the launch binding for follow-up, Stop and decision hooks.

---

## 10. Shared core (for objective 9hkq)

- The hook tools add **no business logic**. Each one: gate, rebuild payload, `execFile(ovld, [...fixed argv...])` with the payload on stdin, and map stdout to the §5 shape. Argv is fixed per tool, following the "action fixed at render time" rule in `agent-session-hook.sh`. No payload value reaches argv (prompt text goes through `--prompt-file -`, not `--prompt`).
- CLI changes the tools need:
  - `hook-event` accepts `--payload-file -` with a native Claude payload and `--agent claude`, so the CLI decodes it with the connector codec instead of the shim. It also accepts `--hook-type Stop` and returns `deliveryStatus`.
  - Session-key resolution moves into the CLI (§9).
  - `agent-session request` returns `{}`-compatible empty output for "no decision" (it already returns null/silence).
- **Parity tests:** for each fixture input, (a) run the CLI command directly and (b) call the hooks server's `tools/call` over NDJSON stdio, then assert identical decoded output and identical recorded side effects. Use a stubbed backend and a temp global data dir. Add framing tests (NDJSON and Content-Length) for the shim.

---

## 11. Cursor `reads-claude-hook-config` (taxonomy-7.1)

Findings (Cursor docs at https://cursor.com/docs/reference/third-party-hooks and https://cursor.com/docs/hooks, plus forum threads t/173171, t/166558, t/150594 and t/168129; Cursor CLI changelog 2026-05-07):

- Cursor loads hooks from `.claude/settings.local.json`, `.claude/settings.json` and `~/.claude/settings.json`. It also imports **installed and enabled Claude Code plugins** (`~/.claude/plugins/installed_plugins.json` plus `enabledPlugins`), converting their `hooks/hooks.json`.
  - In the IDE this is on by default (Settings → Agents → Third-Party Imports).
  - In `cursor-agent` it **cannot be disabled** (staff-confirmed, t/166558).
  - "All matching hooks from every source run."
- Event mapping: UserPromptSubmit→beforeSubmitPrompt, PostToolUse→postToolUse, Stop→stop, PreToolUse→preToolUse. **PermissionRequest is not supported.**
- Cursor documents only `type: "command" | "prompt"` hooks, with `command` required. "Plugin hooks run command hooks only." The Claude-plugin converter "copies only `command`".
- **How Cursor treats `type: "mcp_tool"` is not documented.**

Conclusions:

1. **The hazard is real today, not hypothetical.** The current Claude command hooks are imported into Cursor sessions, so the Claude bash scripts can run inside Cursor with Cursor-shaped payloads. Change `verification` from `unverified` to `verified` for the import itself, citing the docs and forum.
2. An `mcp_tool`-only `hooks.json` has no `command` field. It is expected to be dropped or converted to an empty command on the imported events (beforeSubmitPrompt, postToolUse, stop), all of which fail open in Cursor. **The migration therefore reduces the hazard.**
3. **The worst case is removed** by §4.2: no decision-shaped or fail-closed hook lives in the plugin, and Cursor doesn't map PermissionRequest anyway. The plugin never registers PreToolUse. That is the one event where Cursor treats invalid output as a block.
4. Cursor may also import the plugin's `.mcp.json`. The hooks server lists no tools and is scope-gated, so the cost is at most one idle process.

Mitigation work for objective 5jzn:
- Verify with the plugin installed: `cursor-agent -p` and the IDE Hooks output channel, recording what Cursor loads from the Claude plugin. Store this as a `native-payload`/`source-guard` fixture in the Cursor adapter.
- Set the hazard's mitigation to `implemented`, with the evidence. Otherwise keep it `required` with the observed behavior.
- Add a `source-guard` fixture to the Claude adapter asserting that `hooks.json` contains no `"type": "command"`, no `PreToolUse`, no `PermissionRequest` and no `onFailure`.

---

## 12. Contract impact

**Contract impact: minor.** One `yarn version:contract minor` ships with objective 9hkq, the first objective that changes interfaces. Objective 5jzn's descriptor and version-floor changes are connector evidence, not contract text, unless noted. The changes are additive: a new hook transport, new local hook tools, a new accepted `hookType`, and a decision registration that did not exist. No existing consumer, flag or field is removed or renamed.

**Judgment call.** The Agent Session Surface failure rule says that a timeout and similar failures yield "no decision, which yields the harness's native prompt". The fail-closed Claude decision hook makes a *harness-side* transport failure or timeout a **deny** instead. No Claude decision path ships today, so no consumer relies on the old behavior. If the owner reads the rule as a user-facing guarantee for all connectors, this becomes `major`. The ADR below records the decision.

Contract edits (all in 9hkq):

| File | Change |
| --- | --- |
| `contract/protocol.md`, Connector → Protocol (Hook Surface) | Transport adds harness `mcp_tool` calls to a connector-bundled **local** stdio server whose hook tools forward the native payload to the same `ovld protocol` commands. Rule: hook tools hold no logic of their own. Per-hook failure policy is declared by the connector. |
| `contract/protocol.md`, Agent Session Surface | Failure rule: the core still returns no decision on every internal failure. A connector **may** register a decision hook with harness-level fail-closed behavior only for sessions it launched and bound, where a failure to reach the local hook tool denies and never approves. Scope gate: a harness-started, connector-bundled local server process is allowed in unbound sessions if it does no I/O, logging or network before the per-call gate. |
| `contract/protocol-commands.yaml` | Add a `hook-event` entry (it is missing): `--hook-type UserPromptSubmit\|Stop`, `--payload-file`, `--agent`, response `deliveryStatus`. Note native-session-index binding on `attach`. |
| `contract/components.yaml` (`mcp` catalog statement, v164) and `contract/architecture.md` §12 | Hook tools are **connector-owned**, not part of the `@overlord/contract/mcp-tools` catalog. The hosted server never publishes them. The local shim serves them only in hooks mode and omits them from `tools/list`. |
| `contract/extension-points.yaml` | Reword the `integrationShapes.callback` comment to "per-event harness callback (spawned subprocess or `mcp_tool` call); decision in stdout or tool text". **No new vocabulary value**; adding one would be a closed-vocabulary `major`. No new `fixtureKinds` value, for the same reason: tool IO is covered by CLI parity tests plus `source-guard`/`native-payload` fixtures. |
| `contract/decisions/00NN-claude-mcp-tool-hooks.md` | New ADR: `mcp_tool` transport, local hooks server, per-launch fail-closed decision hook, CLI as fallback, native-session index, unlisted hook tools. |
| `contract/CHANGELOG.md` | Entry from `yarn version:contract minor`. |

Connector evidence (5jzn, no contract bump):
- `harness-capabilities.yaml` `versionRange: '>=2.1.328'`;
- the plugin's `engines["claude-code"]`;
- the new hazard `hook-tool-unlisted-call`;
- `shipped-stop-hook-inert` and `shipped-permission-hook-inert` → retired or mitigated;
- the conformance manifest's managed-file list (remove the scripts, add `.mcp.json` and `scripts/overlord-mcp.mjs`);
- `yarn connectors:capabilities`, then regenerate `catalog.generated.ts` and HARNESS-MATRIX.

**Impact on other modules:**
- Codex, Cursor, Pi and Antigravity are unchanged. Their shell hooks still use the same CLI commands.
- Codex and Cursor prompt scripts also read the dead temp file. They keep working (the read was already a no-op) and can adopt the index later.
- The backend changes only by accepting `hookType: Stop` in `packages/core/service/protocol.ts` and returning delivery status.
- Hosted MCP is unchanged.
- The web app is unchanged.

**Drift-review alignment** (run the drift-review skill in 9hkq and 5jzn):

| Surface | Needed |
| --- | --- |
| API | The `POST /api/protocol/hook-event` route accepts `Stop`. Check whether `contract/api/openapi.yaml` enumerates subcommand bodies (it currently does not name `hookType`; confirm with `yarn contract:parity`). |
| CLI | `cli/src/protocol-help.ts` `hook-event` help (Stop, `--payload-file`, `--agent`); `cli/README.md`; doctor/setup output; `connector-core-render.ts` (Claude no longer renders `capture-change-hook.sh`; it renders the shim with `--hooks`). |
| MCP | `yarn connectors:mcp-tools:check` must still pass. Hook tools are a separate, hand-maintained or connector-generated list, never projected into the hosted catalog. |
| Docs | `docs/src/content/docs/docs-for-agents/agent-sessions.mdx` (names `permission-hook.sh`); `connectors/README.md` lines ~120 and ~149; `connectors/docs/05-connectors-and-agent-plugins.md` line ~71; `connectors/adapters/claude/README.md` and `CAPABILITIES.md`; `webapp/docs/ui/07-connectors-and-doctor.md` (capability names); the public docs CLI-fallback section. |
| Tests | `scripts/check-claude-plugin.test.mjs` (hard-codes `scripts/post-tool-use-hook.sh`), `cli/test/agent-session-event.test.ts:230`, `cli/test/setup-doctor.test.ts:288`, `connectors/adapters/claude/fixtures/post-tool-use-parity.json`. |

---

## 13. Risks and items to verify during implementation

| Risk | Owner | Handling |
| --- | --- | --- |
| Unlisted-tool hook calls stop working in a future Claude Code | 5jzn, 2ewy | Hazard plus a probe on each `verifiedVersion` bump (§7). |
| PermissionRequest `mcp_tool` + `block` behavior not probed | 5jzn | Interactive smoke test: deny on server down; `{}` → native prompt; allow/deny shapes honored. |
| Plugin-scoped server name referenced from `--settings` (launch-time decision hook) not probed | 5jzn | Smoke test. If unsupported, inject the decision hook through a per-launch `--plugin-dir` overlay or a project-local settings file under `.overlord/tmp`, never the user's settings. |
| Long decision holds versus MCP client tool timeouts (`MCP_TOOL_TIMEOUT`) | 9hkq | Keep `hookTimeoutSeconds` ≤ the effective MCP tool timeout. Launch sets `MCP_TOOL_TIMEOUT` if needed. |
| A plugin MCP server starts in every Claude session (idle node process, ~30 MB) | 5jzn | Accepted and recorded in the contract scope-gate clause. The server does nothing before the per-call gate. |
| Shim framing (NDJSON) | 9hkq | §1 item 5. |
| `stop_hook_active` arrives as the string `"true"`/`"false"` | 9hkq | Compare strings. A fixture pins it (P4). |
| UserPromptSubmit now runs at most 10 s in the hook path (was a detached Popen) | 9hkq | The internal 3 s budget, then background completion. |

---

## 14. Hand-off by objective

| Objective | Takes from this plan |
| --- | --- |
| **9hkq** (tools) | §§4, 5, 9, 10; contract edits in §12; defects 2, 3, 5 and 6 from §1; hooks mode of the shim; CLI `hook-event` Stop and `--payload-file`; native-session index; parity tests. |
| **5jzn** (switch-over) | `hooks.json` with three `mcp_tool` hooks (§4.1); launch-time PermissionRequest hook (§4.2); `.mcp.json`; script removal and managed-file cleanup; doctor, setup and attach fallback (§8); version floor 2.1.328; Cursor verification and fixtures (§11); hazards; the drift docs in §12. |
| **n938** (heartbeat / identity) | Hook timeouts in §4.1 are the baseline to tune. Nested-session note in §9. |
| **dsnh** (status line) | Use the native-session index (§9) plus the launch environment to find the bound mission for `ovld` status. The status line receives `session_id`. |
| **2ewy** (hardening) | `engines` ≥ 2.1.328; re-run the §2.3 probe when bumping `verifiedVersion` (P7 especially). |

---

## 15. Outcome of objective n938 (heartbeat long-poll, subagent identity)

Probed on Claude Code 2.1.329 and recorded as fixtures in `connectors/adapters/claude/fixtures/`; ADR 0088, contract 179.2.2.

| Finding | Fixture | Change |
| --- | --- | --- |
| Subagent and fork hooks carry the parent `session_id` plus `agent_id`/`agent_type`; compaction keeps the `session_id`. | `subagent-identity.json` | None to binding. Hazard `fork-and-subagent-identity-unknown` resolved. |
| The main Stop fires while background subagents run (`background_tasks`); they end with `SubagentStop`; a `<task-notification>` UserPromptSubmit wakes the main agent; a second Stop follows. | `subagent-stop-background.json` | Stop templates `background_tasks`; the reminder and the headless wait defer while one runs; task notifications are not follow-ups. `SubagentStop` stays unregistered. |
| Nested `claude -p` gets its own id (also with `CLAUDE_CODE_DISABLE_NESTED_SESSION_ID=1`) but inherits the launch env; its MCP servers see the outer `CLAUDE_PID`. | `subagent-identity.json` (`nested`), `hook-nested-session-gate.json` | Hooks server ignores the launch binding when `CLAUDE_PID` is not its parent (capture excepted). New hazard `nested-session-inherits-launch-env`. |
| Headless hooks emit a heartbeat at 30 s; a 45 s Stop hook completed. | `probe-stop-heartbeat.json` | Final headless Stop polls the inbox every 2 s for up to 60 s (`CLAUDE_CODE_ENTRYPOINT` `sdk-*`, no running background task); interactive claims once. Stop timeout 100 s; inbox budget 16 s (+60 s headless), reminder 10 s. New hazard `headless-stop-hold`. |

Timeouts left as they were: UserPromptSubmit 10 s (3 s internal budget, background completion), PostToolUse 15 s (10 s budget), PermissionRequest 300 s (answers `{}` 5 s early; it does not fire in `-p` without a prompting tool).

---

## 16. Outcome of objective dsnh (status line)

Claude Code `statusLine` (verified live on 2.1.329, `fixtures/status-line-payload.json`): the command gets the status JSON on stdin (`session_id`, `cwd`, `workspace.current_dir`, `version`, …) and inherits the launch environment, `CLAUDE_CODE_SESSION_ID` and `COLUMNS`. Claude runs it at start, after events (debounced 300 ms, an in-flight run is cancelled) and every `refreshInterval` seconds; only exit-0 output shows. A plugin cannot ship a status line.

Shared command for every harness (the Codex objective coo:1325.fx4f reuses it with `--agent codex`):

```
ovld status-line --agent <key> [--payload-file -] [--native-session-id <id>] [--json]
```

- Binding: native-session index under the payload `session_id` (the latest attach in this conversation), else the launch environment. Never cwd. Unbound prints nothing and does no I/O beyond one `stat`.
- Output: `ovld <mission> <mission title> › <key> <objective title> · <state>`, fitted to `COLUMNS`, `NO_COLOR` respected; `--json` prints the computed view for a harness that composes its own line.
- State: open question/choice request → awaiting answer; open permission/retry → awaiting approval; mission status type `blocked` → blocked; objective `pending_delivery`/`complete` → delivered.
- Cache: owner-only snapshot `<global data dir>/status-line/<sha(mission, objective)>.json`, fresh for 20 s; a stale one starts one detached `--refresh` (lock file, 15 s) that reads mission search (display-id mode), `GET /api/missions/:id/objectives` and `GET /api/agent-requests?status=open`. `GET /api/missions/:id` is avoided because it marks the blocking-question indicator seen.
- Setup: `ovld agent-setup claude --status-line` (or a yes at the interactive prompt) writes `statusLine` with `refreshInterval: 10` to the user's Claude settings only when none exists.
