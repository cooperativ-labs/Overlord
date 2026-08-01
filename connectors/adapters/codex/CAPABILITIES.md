<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->

# Codex CLI — Overlord agent-session capabilities

**Adapter** `codex` · **Codec** `codex` · **Integration shape** `callback` · **Capability tier** 3 (Conversational)

**Harness version verified** `0.146.0` · **range** `>=0.124.0` · **scheme** `semver`

**Descriptor digest** `c8cb9aabe2beac3777c5f565241079f068a4672509e427c760813e2341a0ed78`

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

Per-hook timeouts in seconds; the documentation gives a 600-second default. The adapter must set `timeout` explicitly from the window policy and well below that default.

## Capabilities

| Capability | Status | Native | Evidence |
| --- | --- | --- | --- |
| `observe.prompt` | ✅ supported | `UserPromptSubmit` | fixtures: `fixtures/normalize-user-prompt.json` |
| `observe.toolCall` | ✅ supported | `PreToolUse` | fixtures: `fixtures/normalize-pre-tool-use.json` |
| `observe.toolResult` | ✅ supported | `PostToolUse` | fixtures: `fixtures/normalize-post-tool-use.json` |
| `observe.fileEdit` | ✅ supported | `PostToolUse` | fixtures: `fixtures/normalize-post-tool-use.json` |
| `observe.sessionLifecycle` | ✅ supported | `SessionStart` | fixtures: `fixtures/normalize-session-start.json` |
| `decide.shell` | ✅ supported | `PermissionRequest` | fixtures: `fixtures/permission-request.json`, `fixtures/decision-codec.json` |
| `decide.mcp` | ✅ supported | `PermissionRequest` | fixtures: `fixtures/permission-request.json`, `fixtures/decision-codec.json` |
| `decide.fileWrite` | ✅ supported | `PermissionRequest` | fixtures: `fixtures/permission-request.json`, `fixtures/decision-codec.json` |
| `decide.anyTool` | 🚧 not-implemented | `PreToolUse` | tracked as `agent-session-phase-4` |
| `decide.universal` | ✅ supported | `PermissionRequest` | fixtures: `fixtures/permission-request.json`, `fixtures/decision-codec.json` |
| `answer.structuredQuestion` | ❓ unverified | `ToolRequestUserInput` | tracked as `taxonomy-7.2` |
| `answer.persistentAllow` | ❓ unverified | — | tracked as `taxonomy-7.4` |
| `inject.midTurn` | ❓ unverified | `ThreadInjectItems` | tracked as `taxonomy-7.2` |
| `inject.turnBoundary` | ✅ supported | `Stop` | fixtures: `fixtures/agent-session-hooks.json` |
| `inject.nextTurn` | 🚧 not-implemented | `Stop` | tracked as `agent-session-phase-4` |
| `terminal.concurrentAnswer` | ⛔ unsupported | — | On the hook path the native prompt is drawn only after the callback returns, so the terminal cannot answer while Overlord holds the decision. (A future app-server integration could change this; it would be a different integrationShape.) (evidence: `connector-harness-taxonomy.md#12-the-axis-that-actually-matters`) |
| `terminal.statusSurface` | ❓ unverified | — | tracked as `taxonomy-7.9` |

### Capability notes

- **`decide.universal`** — Codex PermissionRequest covers Bash, apply_patch/Edit/Write, and MCP tool names. The codec emits only documented allow/deny behavior and deliberately never emits reserved `updatedInput`, `updatedPermissions`, or `interrupt` fields.
- **`answer.structuredQuestion`** — `codex app-server` exposes ToolRequestUserInput with per-option label/description and an autoResolutionMs — an ACP-shaped structured question in everything but name. It is unreachable until the single-subscriber question is settled.
- **`inject.midTurn`** — ThreadInjectItems/TurnSteer exist on the experimental app-server surface only. The binary carries "expected exactly one client subscribed to the thread, found {}", so if the TUI is that one client Overlord cannot also subscribe and this path is closed.

## Hazards

| Hazard | Severity | Verification | Mitigation | Tracked as |
| --- | --- | --- | --- | --- |
| `two-integration-surfaces-could-disagree` | high | verified | implemented | fixture `fixtures/agent-session-hooks.json` |
| `shipped-permission-hook-inert` | high | verified | implemented | fixture `fixtures/agent-session-hooks.json` |
| `hooks-version-and-platform-gate` | medium | verified | required | `agent-session-phase-4` |

**`two-integration-surfaces-could-disagree`** — Hooks and `codex app-server` can both answer a permission. A session driven by both would race in a way no revision CAS can settle, so exactly one surface must be chosen and documented before either is built.

**`shipped-permission-hook-inert`** — The former PermissionRequest hook called a nonexistent protocol command in the background. The managed registration now invokes the fixed request runtime directly.

**`hooks-version-and-platform-gate`** — Hooks were experimental behind `features.codex_hooks` before v0.124. The connector requires Codex >=0.124; installations outside that range must be treated as unavailable.

## Native decision shape

- **Codec** `codex`
- **Never send** `updatedInput`, `updatedPermissions`, `interrupt`, `permission`, `followup_message`
- **Allow fixture** `fixtures/decision-codec.json`
- **Deny fixture** `fixtures/decision-codec.json`
- **Defer fixture** `fixtures/decision-codec.json`

PermissionRequest accepts the documented hookSpecificOutput decision.behavior allow/deny shape. `ask` remains a deliberate no-output defer so Codex shows its own approval prompt. The adapter never emits updatedInput, updatedPermissions, or interrupt.

## Unbound-session negative test

Fixture: `fixtures/unbound-session.json` — proves what this adapter's registered
integrations do in a session with no Overlord binding, in an unrelated directory.

