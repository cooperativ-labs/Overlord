<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->

# Codex CLI — Overlord agent-session capabilities

**Adapter** `codex` · **Codec** `codex` · **Integration shape** `callback` · **Capability tier** 1 (Observational)

**Harness version verified** `0.147.0` · **range** `>=0.124.0` · **scheme** `semver`

**Descriptor digest** `e0d536667a5616d1a662c7225fc8ef439b5d7cdce1d6703e577190c9e5c6d9c5`

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

`CODEX_THREAD_ID` exists in the environment but is NOT known to equal the hook payload's `session_id`; the binary distinguishes session ids, turn ids, and thread ids. Assuming symmetry with Claude here is exactly the guess that produces silent misattribution, so binding stays on the payload field until the equality is settled by fixture.

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

Per-hook timeouts in seconds; the documentation gives a 600-second default. The adapter must set `timeout` explicitly from the window policy and well below that default. A local 0.147.0 `codex exec --approve-for-me` smoke test still emitted PermissionRequest after the workspace sandbox failed and automatic review retried the shell command, so auto-review does not bypass the installed request hook.

## Capabilities

| Capability | Status | Native | Evidence |
| --- | --- | --- | --- |
| `observe.prompt` | ✅ supported | `UserPromptSubmit` | fixtures: `fixtures/normalize-user-prompt.json` |
| `observe.toolCall` | 🚧 not-implemented | `PreToolUse` | tracked as `latch-engine` |
| `observe.toolResult` | 🚧 not-implemented | `PostToolUse` | tracked as `latch-engine` |
| `observe.fileEdit` | 🚧 not-implemented | `PostToolUse` | tracked as `latch-engine` |
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
| `terminal.statusSurface` | ❓ unverified | — | tracked as `taxonomy-7.9` |

### Capability notes

- **`observe.toolCall`** — Mechanical PreToolUse observation moved to Latch `events`.
- **`decide.universal`** — Remote permission decisions moved to Latch `awaiting_input` / `latch send --resolve`.
- **`answer.structuredQuestion`** — `codex app-server` exposes ToolRequestUserInput with per-option label/description and an autoResolutionMs — an ACP-shaped structured question in everything but name. It is unreachable until the single-subscriber question is settled.
- **`inject.midTurn`** — ThreadInjectItems/TurnSteer exist on the experimental app-server surface only. The binary carries "expected exactly one client subscribed to the thread, found {}", so if the TUI is that one client Overlord cannot also subscribe and this path is closed.

## Hazards

| Hazard | Severity | Verification | Mitigation | Tracked as |
| --- | --- | --- | --- | --- |
| `two-integration-surfaces-could-disagree` | high | verified | implemented | fixture `fixtures/agent-session-hooks.json` |
| `shipped-permission-hook-inert` | high | verified | implemented | fixture `fixtures/agent-session-hooks.json` |
| `prompt-and-agent-hook-handlers-inert` | low | verified | accepted | — |
| `hooks-version-and-platform-gate` | medium | verified | required | `agent-session-phase-4` |

**`two-integration-surfaces-could-disagree`** — Hooks and `codex app-server` can both answer a permission. A session driven by both would race in a way no revision CAS can settle, so exactly one surface must be chosen and documented before either is built.

**`shipped-permission-hook-inert`** — The former PermissionRequest hook called a nonexistent protocol command in the background. The connector no longer registers a PermissionRequest hook; the native prompt owns approvals when Latch is absent.

**`prompt-and-agent-hook-handlers-inert`** — Codex 0.146.0 accepts three hook handler types — `command`, `prompt`, and `agent` — but only `command` runs. Hook discovery parses `prompt` and `agent` and then skips them with a "not supported yet" warning, so a manifest that used either would install cleanly, list in `hooks`, and never execute. The connector must keep emitting `command` handlers only, and must not read the presence of these variants in the schema as availability. `command` is a shell command line run through `$SHELL -lc` (`/bin/sh` when SHELL is unset) — it is not restricted to Bash and not restricted to shell scripting, since the command may invoke any interpreter.

**`hooks-version-and-platform-gate`** — Hooks were experimental behind `features.codex_hooks` before v0.124. The connector requires Codex >=0.124; installations outside that range must be treated as unavailable.

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

