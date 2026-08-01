<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->

# Pi Coding Agent — Overlord agent-session capabilities

**Adapter** `pi` · **Codec** `pi` · **Integration shape** `extension` · **Capability tier** 3 (Conversational)

**Harness version verified** `0.83.0` · **range** `>=0.83.0 <0.84.0` · **scheme** `semver`

**Descriptor digest** `1b4966a98c4994645dd4a46a930f38864e8eec3922603d4c5f2117dcbadcab79`

> The tier is derived from passing fixtures, never authored. `unsupported` means the harness
> cannot do it — do not attempt it. `not-implemented` means it is buildable and unbuilt: that is
> your work. `unverified` means find out first. `supported` without a passing fixture is a CI
> failure, not a claim.

## Session binding

| Field | Value |
| --- | --- |
| Status | ✅ supported |
| Source | `api` |
| Field | `ctx.sessionManager.getSessionId()` |
| Evidence | fixtures: `fixtures/agent-session-runtime.json` |

The extension runs in-process and can read the session id directly; the shipped extension already writes it into the native-session cache. That cache is keyed by (cwd, mission, agent) today — cwd may help LOCATE an existing binding but can never create one or authorize an event. The channel credential is the authority.

The native session id is a **correlation alias only**. Authorization and mission scope come
from the verified channel/session credential; neither the working directory nor an unverified
native id is a binding authority.

## Decision hold

| Field | Value |
| --- | --- |
| Status | ✅ supported |
| Harness ceiling | none documented |
| Evidence | fixtures: `fixtures/agent-session-runtime.json` |

`tool_call` handlers are async, so a decision can be awaited without blocking any process and there is no harness timeout ceiling. There is also no native prompt to release to: a timed-out request must let the tool proceed.

## Capabilities

| Capability | Status | Native | Evidence |
| --- | --- | --- | --- |
| `observe.prompt` | ✅ supported | `input` | fixtures: `fixtures/agent-session-runtime.json` |
| `observe.toolCall` | ✅ supported | `tool_call` | fixtures: `fixtures/normalize-tool-call.json` |
| `observe.toolResult` | 🚧 not-implemented | `tool_result` | tracked as `agent-session-phase-4` |
| `observe.fileEdit` | 🚧 not-implemented | `tool_execution_end` | tracked as `agent-session-phase-4` |
| `observe.sessionLifecycle` | ✅ supported | `agent_start` | fixtures: `fixtures/agent-session-runtime.json` |
| `decide.shell` | ✅ supported | `tool_call` | fixtures: `fixtures/agent-session-runtime.json`, `fixtures/decision-codec.json` |
| `decide.mcp` | ✅ supported | `tool_call` | fixtures: `fixtures/agent-session-runtime.json`, `fixtures/decision-codec.json` |
| `decide.fileWrite` | ✅ supported | `tool_call` | fixtures: `fixtures/agent-session-runtime.json`, `fixtures/decision-codec.json` |
| `decide.anyTool` | ✅ supported | `tool_call` | fixtures: `fixtures/agent-session-runtime.json`, `fixtures/decision-codec.json` |
| `decide.universal` | ✅ supported | `tool_call` | fixtures: `fixtures/agent-session-runtime.json`, `fixtures/decision-codec.json` |
| `answer.structuredQuestion` | 🚧 not-implemented | `ctx.ui.select` | tracked as `agent-session-phase-4` |
| `answer.persistentAllow` | ⛔ unsupported | — | Pi has no native permission model, so there is no standing allow rule for a reply to write. A persistent grant would have to be invented by Overlord rather than recorded in the harness, which is a different feature with its own audit and RBAC review. (evidence: `connector-harness-taxonomy.md#52-what-is-verified`) |
| `inject.midTurn` | ✅ supported | `sendUserMessage(deliverAs=steer)` | fixtures: `fixtures/inject-send-user-message.json` |
| `inject.turnBoundary` | ✅ supported | `sendUserMessage(deliverAs=followUp)` | fixtures: `fixtures/inject-send-user-message.json` |
| `inject.nextTurn` | 🚧 not-implemented | `sendMessage(deliverAs=nextTurn)` | tracked as `agent-session-phase-4` |
| `terminal.concurrentAnswer` | ⛔ unsupported | — | There is no native permission prompt for a human to answer concurrently. This is not a timing limitation like the callback harnesses have; the surface does not exist. (evidence: `connector-harness-taxonomy.md#53-unique-challenges`) |
| `terminal.statusSurface` | 🚧 not-implemented | `ctx.ui.notify` | tracked as `agent-session-phase-4` |

### Capability notes

- **`observe.prompt`** — The shipped extension already captures `input` and posts legacy follow-up activity through the CLI. That is not the normalized agent-session event graded here.
- **`decide.universal`** — One async handler covers every tool call, so coverage is genuinely universal — but the only two outcomes are "return (the tool runs)" and "block with a reason (the model is told it was refused)". There is no defer.
- **`inject.midTurn`** — `steer` is genuine mid-turn injection. The extension claims via inbox, calls sendUserMessage, then confirms — Delivered only after the harness accepts the message.

## Hazards

| Hazard | Severity | Verification | Mitigation | Tracked as |
| --- | --- | --- | --- | --- |
| `no-native-floor-fails-open` | high | verified | implemented | fixture `fixtures/agent-session-runtime.json` |
| `block-is-visible-to-the-model` | medium | verified | implemented | fixture `fixtures/agent-session-runtime.json` |
| `in-process-blast-radius` | high | verified | implemented | fixture `fixtures/extension-holds-no-credentials.json` |
| `typed-api-version-coupling` | medium | unverified | required | `taxonomy-7.10` |

**`no-native-floor-fails-open`** — Pi has no dialog to fall back to, so a timed-out or failed remote decision must ALLOW the tool. Every other adapter fails toward a human; this one fails toward execution. Remote decisions stay off by default and require a workspace-policy ceiling plus project opt-in whose consent text names the fail-open timeout.

**`block-is-visible-to-the-model`** — A block becomes a tool refusal in the conversation and changes what the agent does next, so `block` must never be used as a "please wait" mechanism. The wait happens inside the async handler, before returning.

**`in-process-blast-radius`** — The extension runs with the agent's memory, credentials, and event loop. An unhandled exception is a crash in someone's editor. It must hold no token, make no HTTP call, and catch everything — all network work goes through the CLI.

**`typed-api-version-coupling`** — The extension is typed against @earendil-works/pi-coding-agent 0.83.0. A typed in-process API is far more breakable than JSON on stdin, so the adapter needs a version check and a graceful "extension disabled, mission workflow unaffected" path.

## Native decision shape

- **Codec** `pi`
- **Never send** `hookSpecificOutput`, `permissionDecision`, `permission`
- **Allow fixture** `fixtures/decision-codec.json`
- **Deny fixture** `fixtures/decision-codec.json`
- **Defer fixture** `fixtures/decision-codec.json`

Pi's decision is a resolved promise, not bytes: `{}` allows and `{ block: true, reason }` denies. There is no defer value, which is why the fail-open posture must be a product decision rather than an adapter default.

## Unbound-session negative test

Fixture: `fixtures/extension-holds-no-credentials.json` — proves what this adapter's registered
integrations do in a session with no Overlord binding, in an unrelated directory.

