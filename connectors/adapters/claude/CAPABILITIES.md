<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->

# Claude Code — Overlord agent-session capabilities

**Adapter** `claude` · **Codec** `claude` · **Integration shape** `callback` · **Capability tier** 1 (Observational)

**Harness version verified** `2.1.227` · **range** `>=2.1.0` · **scheme** `semver`

**Descriptor digest** `c7e52ce7d4698d35888a533b42d67c56d7616b3bb90e8537e4afcc39e1b6cc5d`

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

Every hook body carries `session_id`, so binding needs no environment cooperation and works identically for the first event of a session and the thousandth. The native session id is a correlation alias only: authorization and mission scope come from the verified channel credential, never from cwd and never from an unverified native id. `CLAUDE_CODE_SESSION_ID` remains available in tool subprocesses and is used by `attach`, but the payload field is the one the push path depends on because it is present on the path that actually needs it.

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

Per-command `timeout` in seconds with no documented ceiling. Omitting `decision` from a PermissionRequest response falls through to the native prompt, which is the required fail-toward-the-harness behavior.

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
| `observe.prompt` | ✅ supported | `UserPromptSubmit` | fixtures: `fixtures/normalize-user-prompt-submit.json` |
| `observe.toolCall` | 🚧 not-implemented | `PreToolUse` | tracked as `agent-session-phase-2` |
| `observe.toolResult` | 🚧 not-implemented | `PostToolUse` | tracked as `latch-engine` |
| `observe.fileEdit` | ✅ supported | `PostToolUse` | fixtures: `fixtures/normalize-post-tool-use-write.json`, `fixtures/post-tool-use-parity.json`, `fixtures/post-tool-use-capture.json` |
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
| `terminal.statusSurface` | 🚧 not-implemented | `statusMessage` | tracked as `agent-session-phase-2` |

### Capability notes

- **`observe.prompt`** — The protocol follow-up hook posts `user_follow_up` mission events. There is no separate mechanical agent-session event stream.
- **`observe.toolCall`** — Deliberately unregistered in Phase 1. PreToolUse is decision-capable: registering it for observation alone would put a script in front of every tool call for no benefit a PostToolUse registration does not already provide, while inheriting the blast radius of the decision path. It lands with the codecs that can actually use it.
- **`observe.toolResult`** — The protocol PostToolUse callback forwards bounded mutation evidence to the local objective ledger, but it does not expose a general tool-result event stream.
- **`observe.fileEdit`** — The shipped PostToolUse callback forwards its native payload to local `capture-change` only when `OVERLORD_OBJECTIVE_ID` resolves an exact active-session binding. A directly named Write/Edit path normalized by the Claude codec as `file.edited` records non-exclusive `declared_edit`/`direct` evidence. Codec-normalized read, search, and fetch callbacks are silent no-ops; mutation-capable callbacks without a normalized edit path, plus shell, generic, unknown, and unmapped callbacks, record unavailable evidence health. Mechanical agent-session observation is not a live Overlord path.
- **`observe.sessionLifecycle`** — No Overlord session-lifecycle registration ships.
- **`decide.universal`** — The native Claude prompt owns approvals; Overlord exposes no remote decision control.
- **`answer.structuredQuestion`** — Elicitation/ElicitationResult hook events exist in the binary but their request and response shapes were not read. Write the fixture before relying on them.
- **`answer.persistentAllow`** — Structurally available, deliberately unbuilt. A standing permission grant needs its own design, confirmation, audit language, and RBAC review before any remote surface offers it.
- **`inject.midTurn`** — Session-input injection is not a live Overlord connector path. A future conversation surface must use the native Latch v2 Conversation Hub protocol.
- **`inject.turnBoundary`** — Turn-boundary injection moved off Overlord connectors. The protocol Stop hook still reminds the agent to deliver when needed.
- **`inject.nextTurn`** — No distinct next-turn-only path yet; turn-boundary Stop covers the portable fallback.
- **`terminal.statusSurface`** — `statusMessage` is static install-time configuration with no per-request interpolation and no session-binding predicate, so it renders in unbound sessions too. It must be worded as an option, never as an instruction.

## Hazards

| Hazard | Severity | Verification | Mitigation | Tracked as |
| --- | --- | --- | --- | --- |
| `shipped-permission-hook-inert` | high | verified | implemented | fixture `fixtures/permission-request.json` |
| `shipped-stop-hook-inert` | medium | verified | required | `agent-session-phase-3` |
| `fork-and-subagent-identity-unknown` | medium | unverified | required | `taxonomy-7.6` |
| `subagent-stop-unregistered` | medium | verified | required | `coo:585` |

**`shipped-permission-hook-inert`** — The installed PermissionRequest hook calls a `ovld protocol permission-request` subcommand that does not exist, backgrounds the call with `) & disown`, and is gated on a MISSION_ID environment variable launched sessions do not always set. It records nothing and, being backgrounded with stdout discarded, is structurally incapable of returning a decision.

**`shipped-stop-hook-inert`** — The installed Stop hook calls `ovld protocol hook-event --hook-type Stop`, which the CLI rejects, and then parses a `deliveryStatus` field nothing produces. Confirmed again at 2.1.221 from a live agent-pod session: every entry in ~/.ovld/logs/stop-hook.log takes the `no launch mission id` branch and returns before the delivery check, because the hook gates on a `MISSION_ID` environment variable the pod does not set. The PostToolUse path is independently scoped by explicit mission and objective launch environment; the Stop hook should use an equally explicit binding.

**`fork-and-subagent-identity-unknown`** — Whether an in-process fork mints a new native session id, and whether subagent tool calls carry the parent's id, are both unverified. Guessing either routes a session's requests to the wrong mission. Partially narrowed at 2.1.221: the binary carries distinct `SubagentStart` and `SubagentStop` hook events, converts an agent-frontmatter `Stop` registration into `SubagentStop` ("subagents trigger SubagentStop"), and records `parent_session_id` and `agent_type` as separate fields from `session_id`. That the harness distinguishes the two identities is now established; which value lands in a subagent hook payload's `session_id` is still not, and that is the part binding depends on. Read it from a real subagent payload before changing any binding code.

**`subagent-stop-unregistered`** — The adapter registers `Stop` and no subagent-lifecycle event. Claude Code 2.1.221 fires `SubagentStop` — not `Stop` — when a subagent finishes, and subagents now run in the background past the parent's turn boundary. Version 2.1.224 also removed the 200-subagent-per-session spawn cap, increasing the frequency of this gap, so the shipped Stop registration is guaranteed not to run for work a subagent completes after the parent stopped. Nothing is lost today because that registration is already inert (see `shipped-stop-hook-inert`), which is exactly why the fix is to repair the Stop path first and only then decide whether the repaired body should also ride `SubagentStop`. Registering the current inert script on a second event would add a spawn per subagent completion and buy nothing.

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

