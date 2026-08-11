<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->

# Antigravity CLI — Overlord agent-session capabilities

**Adapter** `antigravity` · **Codec** `antigravity` · **Integration shape** `callback` · **Capability tier** 0 (Unsupported)

**Harness version verified** `docs: Antigravity CLI v1.1.11 / Antigravity 2.0 v2.6.0` · **scheme** `opaque`

**Descriptor digest** `e7313b23f98b6ed15a1a32849291a2a391523d4c06403bf395ecbcadfa3b11ac`

> The tier is derived from passing fixtures, never authored. `unsupported` means the harness
> cannot do it — do not attempt it. `not-implemented` means it is buildable and unbuilt: that is
> your work. `unverified` means find out first. `supported` without a passing fixture is a CI
> failure, not a claim.

## Session binding

| Field | Value |
| --- | --- |
| Status | ✅ supported |
| Source | `payload` |
| Field | `conversationId` |
| Evidence | fixtures: `fixtures/official-pre-tool-use.json` |

The first-party hook contract defines `conversationId` as the unique UUID of the active agent conversation and includes it in every hook payload. It remains a correlation alias; the verified channel credential is the authorization and mission scope. The local `agy` binary was unavailable for an empirical resume test, so no interaction capability is promoted solely from this binding proof.

The native session id is a **correlation alias only**. Authorization and mission scope come
from the verified channel/session credential; neither the working directory nor an unverified
native id is a binding authority.

## Decision hold

| Field | Value |
| --- | --- |
| Status | ❓ unverified |
| Harness ceiling | none documented |
| Evidence | tracked as `agent-session-verify-antigravity` |

The first-party docs define command-hook timeouts (30 seconds by default) and a synchronous PreToolUse `decision` response, but do not define timeout, crash, non-zero-exit, or malformed JSON fallback behavior. Keep the remote decision hold unverified until an installed binary exercises those failure paths.

## Capabilities

| Capability | Status | Native | Evidence |
| --- | --- | --- | --- |
| `observe.prompt` | ⛔ unsupported | `PreInvocation` | PreInvocation exposes invocation counters and common metadata but no submitted prompt. Reading transcriptPath to reconstruct one would violate the raw-transcript privacy boundary. (evidence: `https://antigravity.google/docs/hooks#preinvocation`) |
| `observe.toolCall` | 🚧 not-implemented | `PreToolUse` | tracked as `agent-session-verify-antigravity` |
| `observe.toolResult` | 🚧 not-implemented | `PostToolUse` | tracked as `agent-session-verify-antigravity` |
| `observe.fileEdit` | 🚧 not-implemented | `PostToolUse` | tracked as `agent-session-verify-antigravity` |
| `observe.sessionLifecycle` | 🚧 not-implemented | `Stop` | tracked as `agent-session-verify-antigravity` |
| `decide.shell` | 🚧 not-implemented | `PreToolUse` | tracked as `agent-session-verify-antigravity` |
| `decide.mcp` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `decide.fileWrite` | 🚧 not-implemented | `PreToolUse` | tracked as `agent-session-verify-antigravity` |
| `decide.anyTool` | 🚧 not-implemented | `PreToolUse` | tracked as `agent-session-verify-antigravity` |
| `decide.universal` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `answer.structuredQuestion` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `answer.persistentAllow` | 🚧 not-implemented | `PreToolUse.permissionOverrides` | tracked as `agent-session-verify-antigravity` |
| `inject.midTurn` | ⛔ unsupported | — | PreInvocation and PostInvocation can inject only at model-invocation boundaries; the hook surface has no path to deliver input while a model or tool call is actively running. (evidence: `https://antigravity.google/docs/hooks#preinvocation`) |
| `inject.turnBoundary` | 🚧 not-implemented | `Stop` | tracked as `agent-session-verify-antigravity` |
| `inject.nextTurn` | 🚧 not-implemented | `PreInvocation.injectSteps.userMessage` | tracked as `agent-session-verify-antigravity` |
| `terminal.concurrentAnswer` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `terminal.statusSurface` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |

## Hazards

| Hazard | Severity | Verification | Mitigation | Tracked as |
| --- | --- | --- | --- | --- |
| `outside-verification-survey` | medium | unverified | required | `agent-session-verify-antigravity` |
| `pre-tool-use-always-allows` | medium | verified | implemented | fixture `fixtures/unbound-session.json` |
| `pre-invocation-has-no-prompt` | high | verified | implemented | fixture `fixtures/unbound-session.json` |

**`outside-verification-survey`** — Antigravity was not part of the original harness verification survey. The current first-party docs now establish hook names, payload fields, and response shapes, but the `agy` binary was unavailable for empirical timeout, failure, resume, and headless tests. The connector must stay at its fixture-proven tier until those paths are exercised.

**`pre-tool-use-always-allows`** — The former PreToolUse hook answered `{"allow_tool":true}` even though the first-party response contract requires `decision`, and called a nonexistent detached protocol command. It neither gated nor recorded reliably; changing it to native `decision: allow` would have silently bypassed the harness permission system, so the registration was removed.

**`pre-invocation-has-no-prompt`** — The former follow-up hook guessed prompt/message/text/input fields on PreInvocation, but the first-party schema contains none of them. It could never capture a normal follow-up; reconstructing one from transcriptPath would violate the raw-transcript privacy boundary. The false followUpHook projection and the registration were removed.

## Native decision shape

- **Codec** `antigravity`
- **Never send** `allow_tool`, `hookSpecificOutput`, `permissionDecision`, `permission`

The first-party response is `{ decision, reason?, permissionOverrides? }`, with decision values allow, deny, ask, force_ask, and deny_unless_prior_grant. No decision codec ships until an installed binary verifies failure fallback and exact emitted bytes; in particular, no failure path may manufacture `decision: allow`.

## Unbound-session negative test

Fixture: `fixtures/unbound-session.json` — proves what this adapter's registered
integrations do in a session with no Overlord binding, in an unrelated directory.

