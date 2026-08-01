<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->

# Antigravity CLI — Overlord agent-session capabilities

**Adapter** `antigravity` · **Codec** `antigravity` · **Integration shape** `callback` · **Capability tier** 0 (Unsupported)

**Harness version verified** _not verified_ · **scheme** `opaque`

**Descriptor digest** `c021926c384a72bdaa62ac5f0eab57e80822c5d2996db75ea3c30c6bf5d09ce8`

> The tier is derived from passing fixtures, never authored. `unsupported` means the harness
> cannot do it — do not attempt it. `not-implemented` means it is buildable and unbuilt: that is
> your work. `unverified` means find out first. `supported` without a passing fixture is a CI
> failure, not a claim.

## Session binding

| Field | Value |
| --- | --- |
| Status | ❓ unverified |
| Source | `payload` |
| Evidence | tracked as `agent-session-verify-antigravity` |

No native session identifier has been established for Antigravity hook payloads. Until one is, this connector cannot bind, and therefore cannot reach any interaction tier.

The native session id is a **correlation alias only**. Authorization and mission scope come
from the verified channel/session credential; neither the working directory nor an unverified
native id is a binding authority.

## Decision hold

| Field | Value |
| --- | --- |
| Status | ❓ unverified |
| Harness ceiling | none documented |
| Evidence | tracked as `agent-session-verify-antigravity` |

The shipped hooks declare a 10-second timeout, but whether a held PreToolUse response actually gates execution — and what the harness does when the hook exceeds that timeout — was not verified.

## Capabilities

| Capability | Status | Native | Evidence |
| --- | --- | --- | --- |
| `observe.prompt` | ❓ unverified | `PreInvocation` | tracked as `agent-session-verify-antigravity` |
| `observe.toolCall` | ❓ unverified | `PreToolUse` | tracked as `agent-session-verify-antigravity` |
| `observe.toolResult` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `observe.fileEdit` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `observe.sessionLifecycle` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `decide.shell` | ❓ unverified | `PreToolUse` | tracked as `agent-session-verify-antigravity` |
| `decide.mcp` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `decide.fileWrite` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `decide.anyTool` | ❓ unverified | `PreToolUse` | tracked as `agent-session-verify-antigravity` |
| `decide.universal` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `answer.structuredQuestion` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `answer.persistentAllow` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `inject.midTurn` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `inject.turnBoundary` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `inject.nextTurn` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `terminal.concurrentAnswer` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `terminal.statusSurface` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |

## Hazards

| Hazard | Severity | Verification | Mitigation | Tracked as |
| --- | --- | --- | --- | --- |
| `outside-verification-survey` | medium | unverified | required | `agent-session-verify-antigravity` |
| `pre-tool-use-always-allows` | medium | verified | required | `agent-session-verify-antigravity` |

**`outside-verification-survey`** — Antigravity was not part of the harness verification survey. Every row above is unverified rather than inferred, and this connector must stay at its fixture-proven tier until a dedicated verification objective upgrades it.

**`pre-tool-use-always-allows`** — The shipped PreToolUse hook always answers `{"allow_tool":true}` and records the request through a detached `ovld protocol permission-request` call to a subcommand that does not exist. It therefore neither gates nor records anything, while its conformance manifest declared the permissionHook capability.

## Native decision shape

- **Codec** `antigravity`
- **Never send** `hookSpecificOutput`, `permissionDecision`, `permission`

The observed response shape is a flat `{"allow_tool": boolean}`. No deny or defer shape has been verified, so no decision codec may be written for this adapter yet.

## Unbound-session negative test

Fixture: `fixtures/unbound-session.json` — proves what this adapter's registered
integrations do in a session with no Overlord binding, in an unrelated directory.

