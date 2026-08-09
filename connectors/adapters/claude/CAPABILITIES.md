<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->

# Claude Code — Overlord agent-session capabilities

**Adapter** `claude` · **Codec** `claude` · **Integration shape** `callback` · **Capability tier** 3 (Conversational)

**Harness version verified** `2.1.221` · **range** `>=2.1.0` · **scheme** `semver`

**Descriptor digest** `bdeb8c46cb12d692aced13597c6c2120312c303f3aaeb597b891d83e054db365`

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

## Capabilities

| Capability | Status | Native | Evidence |
| --- | --- | --- | --- |
| `observe.prompt` | ✅ supported | `UserPromptSubmit` | fixtures: `fixtures/normalize-user-prompt-submit.json` |
| `observe.toolCall` | 🚧 not-implemented | `PreToolUse` | tracked as `agent-session-phase-2` |
| `observe.toolResult` | ✅ supported | `PostToolUse` | fixtures: `fixtures/normalize-post-tool-use-shell.json`, `fixtures/agent-session-hook-unbound.json` |
| `observe.fileEdit` | ✅ supported | `PostToolUse` | fixtures: `fixtures/normalize-post-tool-use-write.json`, `fixtures/post-tool-use-parity.json` |
| `observe.sessionLifecycle` | ✅ supported | `SessionStart` | fixtures: `fixtures/normalize-session-start.json` |
| `decide.shell` | ✅ supported | `PermissionRequest` | fixtures: `fixtures/permission-request.json`, `fixtures/decision-codec.json` |
| `decide.mcp` | ✅ supported | `PermissionRequest` | fixtures: `fixtures/permission-request.json`, `fixtures/decision-codec.json` |
| `decide.fileWrite` | ✅ supported | `PermissionRequest` | fixtures: `fixtures/permission-request.json`, `fixtures/decision-codec.json` |
| `decide.anyTool` | 🚧 not-implemented | `PreToolUse` | tracked as `agent-session-phase-2` |
| `decide.universal` | ✅ supported | `PermissionRequest` | fixtures: `fixtures/permission-request.json`, `fixtures/decision-codec.json` |
| `answer.structuredQuestion` | ❓ unverified | `Elicitation` | tracked as `agent-session-verify-claude-elicitation` |
| `answer.persistentAllow` | 🚧 not-implemented | `PermissionRequest.decision.updatedPermissions` | tracked as `agent-session-standing-permissions` |
| `inject.midTurn` | ✅ supported | `asyncRewake` | fixtures: `fixtures/inject-async-rewake.json`, `fixtures/agent-session-inbox-unbound.json` |
| `inject.turnBoundary` | ✅ supported | `Stop` | fixtures: `fixtures/inject-stop-block.json`, `fixtures/agent-session-inbox-unbound.json` |
| `inject.nextTurn` | 🚧 not-implemented | `Stop` | tracked as `agent-session-phase-4` |
| `terminal.concurrentAnswer` | ⛔ unsupported | — | The native permission prompt is drawn only after the hook returns, so nobody can answer in the terminal while Overlord holds the decision. Holding is simultaneously the only way to answer remotely and the reason the terminal cannot participate. (evidence: `connector-harness-taxonomy.md#12-the-axis-that-actually-matters`) |
| `terminal.statusSurface` | 🚧 not-implemented | `statusMessage` | tracked as `agent-session-phase-2` |

### Capability notes

- **`observe.prompt`** — Two registrations now ride UserPromptSubmit: the legacy hook that posts `user_follow_up` mission events through the Connector → Protocol surface, and the normalized agent-session event this capability grades. Both stay installed until the normalized path has proven equivalent follow-up attribution; replacing a working capture with an unproven one is how a migration loses data quietly.
- **`observe.toolCall`** — Deliberately unregistered in Phase 1. PreToolUse is decision-capable: registering it for observation alone would put a script in front of every tool call for no benefit a PostToolUse registration does not already provide, while inheriting the blast radius of the decision path. It lands with the codecs that can actually use it.
- **`observe.fileEdit`** — The shipped PostToolUse hook that records touched files into the per-session log used by `deliver` for change attribution is untouched and still registered. The normalized event is additive: `fixtures/post-tool-use-parity.json` guards both registrations being present, because the migration must not repair observation by regressing change attribution.
- **`observe.sessionLifecycle`** — SessionStart only. There is no matching stop-class registration: continuing or observing a session a user believed had finished is a larger surprise than a missing row, and the Stop event is decision-capable in a way SessionStart is not.
- **`decide.universal`** — Unlike Cursor, Claude has one event that covers every approval, so a single registration can reach every decision rather than a per-tool-class slice.
- **`answer.structuredQuestion`** — Elicitation/ElicitationResult hook events exist in the binary but their request and response shapes were not read. Write the fixture before relying on them.
- **`answer.persistentAllow`** — Structurally available, deliberately unbuilt. A standing permission grant needs its own design, confirmation, audit language, and RBAC review before any remote surface offers it.
- **`inject.midTurn`** — SessionStart and PostToolUse register `agent-session-inbox.sh` with `asyncRewake: true`. Exit code 2 wakes the model with stderr as a system reminder — that is Delivered.
- **`inject.turnBoundary`** — Stop returns `decision: "block"` with the instruction as `reason`, which continues the turn with that text. The model receives it, so this path also reports Delivered.
- **`inject.nextTurn`** — No distinct next-turn-only path yet; turn-boundary Stop covers the portable fallback.
- **`terminal.statusSurface`** — `statusMessage` is static install-time configuration with no per-request interpolation and no session-binding predicate, so it renders in unbound sessions too. It must be worded as an option, never as an instruction.

## Hazards

| Hazard | Severity | Verification | Mitigation | Tracked as |
| --- | --- | --- | --- | --- |
| `shipped-permission-hook-inert` | high | verified | implemented | fixture `fixtures/permission-request.json` |
| `shipped-stop-hook-inert` | medium | verified | required | `agent-session-phase-3` |
| `unbound-session-side-effects` | medium | verified | required | `agent-session-phase-4` |
| `fork-and-subagent-identity-unknown` | medium | unverified | required | `taxonomy-7.6` |
| `subagent-stop-unregistered` | medium | verified | required | `coo:585` |
| `subagent-commits-escape-delivery-delta` | high | verified | required | `coo:585` |

**`shipped-permission-hook-inert`** — The installed PermissionRequest hook calls a `ovld protocol permission-request` subcommand that does not exist, backgrounds the call with `) & disown`, and is gated on a MISSION_ID environment variable launched sessions do not always set. It records nothing and, being backgrounded with stdout discarded, is structurally incapable of returning a decision. The shipped conformance `permissionHook` flag therefore overstates what happens today.

**`shipped-stop-hook-inert`** — The installed Stop hook calls `ovld protocol hook-event --hook-type Stop`, which the CLI rejects, and then parses a `deliveryStatus` field nothing produces. Confirmed again at 2.1.221 from a live agent-pod session: every entry in ~/.ovld/logs/stop-hook.log takes the `no launch mission id` branch and returns before the delivery check, because the hook gates on a `MISSION_ID` environment variable the pod does not set. The PostToolUse hook works in the same session because it resolves the mission from the per-cwd active-session manifest instead; the Stop hook should resolve it the same way.

**`unbound-session-side-effects`** — NARROWED, NOT CLOSED. The new agent-session registrations gate in bash on OVERLORD_SESSION_CHANNEL_ID before spawning anything, so they are completely silent in an unbound session (proved by fixtures/agent-session-hook-unbound.json). The LEGACY PostToolUse hook still spawns `ovld protocol record-touched` and appends to ~/.ovld/logs in every session on the machine, because its scope gate lives inside the CLI rather than before the spawn (proved by fixtures/unbound-session.json). It stays installed on purpose: it is what feeds touched-file change attribution at deliver time, and removing it before the normalized path has demonstrated equivalent attribution would trade a privacy nit for a data-loss bug. Closing this means retiring the legacy hook, which is a migration, not a patch.

**`fork-and-subagent-identity-unknown`** — Whether an in-process fork mints a new native session id, and whether subagent tool calls carry the parent's id, are both unverified. Guessing either routes a session's requests to the wrong mission. Partially narrowed at 2.1.221: the binary carries distinct `SubagentStart` and `SubagentStop` hook events, converts an agent-frontmatter `Stop` registration into `SubagentStop` ("subagents trigger SubagentStop"), and records `parent_session_id` and `agent_type` as separate fields from `session_id`. That the harness distinguishes the two identities is now established; which value lands in a subagent hook payload's `session_id` is still not, and that is the part binding depends on. Read it from a real subagent payload before changing any binding code.

**`subagent-stop-unregistered`** — The adapter registers `Stop` and no subagent-lifecycle event. Claude Code 2.1.221 fires `SubagentStop` — not `Stop` — when a subagent finishes, and subagents now run in the background past the parent's turn boundary, so the shipped Stop registration is guaranteed not to run for work a subagent completes after the parent stopped. Nothing is lost today because that registration is already inert (see `shipped-stop-hook-inert`), which is exactly why the fix is to repair the Stop path first and only then decide whether the repaired body should also ride `SubagentStop`. Registering the current inert script on a second event would add a spawn per subagent completion and buy nothing.

**`subagent-commits-escape-delivery-delta`** — Delivery change attribution is computed from `git status --porcelain` against the attach baseline (cli/src/vcs.ts `readChangedFiles` / `filterRunAttributableChanges`); nothing in that path consults HEAD or the commit graph. A background subagent that commits, merges, or opens a PR for its own work therefore removes those files from the worktree delta, and they vanish from the delivery report entirely — not flagged, not skipped, silently absent. The PostToolUse touched-files log is unaffected (its key is `sha256(abspath(cwd) + "\0" + MISSION_ID)`, so a subagent sharing the cwd writes to the same log), which means the evidence that the edit happened survives while the delta that decides coverage does not. Closing this means teaching the delta about commits made since the baseline, which is a CLI change with branch and worktree semantics to settle, not a hook edit.

## Native decision shape

- **Codec** `claude`
- **Never send** `permission`, `user_message`, `agent_message`, `followup_message`
- **Allow fixture** `fixtures/decision-codec.json`
- **Deny fixture** `fixtures/decision-codec.json`
- **Defer fixture** `fixtures/decision-codec.json`

Claude expects `hookSpecificOutput.decision` with behavior allow/deny. Cursor's flat `permission` dialect must never be emitted here; relying on any cross-vendor compatibility shim is how a connector silently stops working after an upstream release. The decision-codec fixture executes the shared interpreter and pins all three outcomes.

## Unbound-session negative test

Fixture: `fixtures/unbound-session.json` — proves what this adapter's registered
integrations do in a session with no Overlord binding, in an unrelated directory.

