<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->

# Antigravity CLI — Overlord agent-session capabilities

**Adapter** `antigravity` · **Codec** `antigravity` · **Integration shape** `callback` · **Capability tier** 1 (Observational)

**Harness version verified** `docs + agy changelog 1.5.13` · **range** `>=1.5.4` · **scheme** `semver`

**Descriptor digest** `de365807648036c961169528d2235bf6d51a04bf0bf540152f9149b67edbfea6`

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
| Evidence | fixtures: `fixtures/normalize-pre-invocation.json` |

The first-party hook contract defines `conversationId` as the UUID of the active conversation and includes it in every hook payload; the codec reads it as the native session id and `hook-event` persists it as the session's external id. It remains a correlation alias: the launch environment (or a verified channel credential) is the authorization and mission scope. Antigravity exports no conversation id to tool processes, so a chat-started attach cannot index itself and its hooks stay unbound.

The native session id is a **correlation alias only**. Authorization and mission scope come
from the verified channel/session credential; neither the working directory nor an unverified
native id is a binding authority.

## Decision hold

| Field | Value |
| --- | --- |
| Status | ❓ unverified |
| Timeout field | `timeout` |
| Harness default | 30s |
| Harness ceiling | none documented |
| Evidence | tracked as `latch-engine` |

Hook `timeout` is in seconds with a 30-second default; no maximum is documented. The build guide states that a non-zero exit is logged and ignored ("failing open"), and agy 1.4.3 made a failing PostToolUse hook (missing command, error exit, timeout, invalid JSON) leave the tool result unchanged. Whether a PreToolUse hook held past its timeout falls back to the native permission prompt has not been exercised, and no decision hook is registered, so the hold stays unverified.

## Mutation-window evidence

| Field | Value |
| --- | --- |
| Classification | `post-only` |
| Executable fixture | `fixtures/mutation-window-evidence.json` |

Only PostToolUse is registered, so evidence is post-only. A `write_to_file`, `replace_file_content` or `multi_replace_file_content` completion names its destination in `TargetFile`; the codec normalizes it to `file.edited` and decodes the outcome from `error` (empty or absent is success per the hook contract). Only an `ok` edit records objective-bound, non-exclusive `declared_edit`/`direct` evidence; a failed edit records `outcome_partial`, and `run_command` records `shell_activity_unverified`.

A completion callback path normalized by the connector-owned codec as `file.edited`
records objective-bound, non-exclusive `declared_edit`/`direct` evidence.
Codec-normalized read, search, and fetch callbacks are silent no-ops. Mutation-capable
callbacks without a normalized edit path, plus shell, generic, unknown, and unmapped
callbacks, record unavailable evidence health.

## Saved freeform chat resume

**Status** 🚧 not-implemented · **Evidence** Latch docs/INTEGRATIONS.md#antigravity

**Native command** `agy --conversation <conversation-id>`

tracked as `coo:1370`

The paired gateway has no Antigravity launch path or native Conversation Hub observer.

## Capabilities

| Capability | Status | Native | Evidence |
| --- | --- | --- | --- |
| `observe.prompt` | ✅ supported | `PreInvocation` | fixtures: `fixtures/normalize-pre-invocation.json`, `fixtures/pre-invocation-hook.json`, `fixtures/pre-invocation-unbound.json` |
| `observe.toolCall` | 🚧 not-implemented | `PreToolUse` | tracked as `latch-engine` |
| `observe.toolResult` | ✅ supported | `PostToolUse` | fixtures: `fixtures/normalize-post-tool-use-shell.json`, `fixtures/normalize-post-tool-use-failed.json` |
| `observe.fileEdit` | ✅ supported | `PostToolUse` | fixtures: `fixtures/normalize-post-tool-use-write.json`, `fixtures/normalize-post-tool-use-failed.json`, `fixtures/post-tool-use-hook.json`, `fixtures/post-tool-use-unbound.json` |
| `observe.sessionLifecycle` | 🚧 not-implemented | `SessionStart` | tracked as `latch-engine` |
| `decide.shell` | 🚧 not-implemented | `PreToolUse` | tracked as `latch-engine` |
| `decide.mcp` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `decide.fileWrite` | 🚧 not-implemented | `PreToolUse` | tracked as `latch-engine` |
| `decide.anyTool` | 🚧 not-implemented | `PreToolUse` | tracked as `latch-engine` |
| `decide.universal` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `answer.structuredQuestion` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `answer.persistentAllow` | 🚧 not-implemented | `PreToolUse.permissionOverrides` | tracked as `latch-engine` |
| `inject.midTurn` | ⛔ unsupported | — | PreInvocation and PostInvocation can inject only at model-invocation boundaries; the hook surface has no path to deliver input while a model or tool call is actively running. (evidence: `https://antigravity.google/docs/hooks#preinvocation`) |
| `inject.turnBoundary` | ✅ supported | `Stop` | fixtures: `fixtures/stop-delivery-reminder.json`, `fixtures/stop-inbox-inject.json`, `fixtures/stop-hook-failure.json`, `fixtures/official-stop.json` |
| `inject.nextTurn` | 🚧 not-implemented | `PreInvocation.injectSteps.userMessage` | tracked as `latch-engine` |
| `terminal.concurrentAnswer` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |
| `terminal.statusSurface` | ❓ unverified | — | tracked as `agent-session-verify-antigravity` |

### Capability notes

- **`observe.prompt`** — PreInvocation carries the latest user message as `lastUserInput` (a common hook field since agy 1.4.7, documented in the hook contract). It fires before every model invocation, so `hook-event` records a prompt only when it differs from the last one recorded for the conversation, and the launch prompt (turn 0) is skipped as for other adapters. The transcript is never read.
- **`observe.toolCall`** — The codec normalizes PreToolUse, but no PreToolUse hook is registered: the observation has no live path until Overlord has a native Conversation Hub client.
- **`observe.toolResult`** — PostToolUse carries the call and any `error`, never the tool output (build guide). The codec reduces it to a tool card with a decoded `ok`/`error` outcome; the error text is not retained.
- **`observe.fileEdit`** — The PostToolUse hook (matcher `write_to_file|replace_file_content| multi_replace_file_content|run_command`) runs the rendered core capture callback, which forwards the payload to local `capture-change --agent antigravity` only when `OVERLORD_OBJECTIVE_ID` is in the launch environment.
- **`decide.shell`** — PreToolUse returns `decision` for `run_command`. The decision codec pins the exact bytes (fixtures/decision-codec.json), but no launch creates a session channel and no PreToolUse hook is registered, so Antigravity's native permission flow stays the only authority.
- **`decide.mcp`** — The name a plugin MCP tool has in PreToolUse is not documented: the plugin docs namespace tools as `<plugin>_<server>` while the build guide's matcher example is `mcp_.*`.
- **`decide.universal`** — PreToolUse sees every tool call, but whether every approval Antigravity would prompt for (sandbox escapes, admin review) is decided through it is not documented; agy 1.5.7 made admin-enforced review ignore `auto_approve`.
- **`inject.turnBoundary`** — Stop `decision: "continue"` keeps the agent from stopping and injects `reason` as a system message. The live path is the once-per-objective delivery reminder from `hook-event`; it is skipped while `continuation_active` is true or `fullyIdle` is false. With a session channel the inbox instruction takes precedence, which is not a live path today.
- **`inject.nextTurn`** — The PreInvocation hook and the inbox encoder emit `injectSteps: [{ userMessage }]` before the next model call, proven by the fixture, but only for a session channel, which no launch creates today.

## Hazards

| Hazard | Severity | Verification | Mitigation | Tracked as |
| --- | --- | --- | --- | --- |
| `outside-verification-survey` | medium | verified | implemented | fixture `fixtures/hooks-registration.json` |
| `per-invocation-hook-spawn` | low | verified | accepted | — |

**`outside-verification-survey`** — Antigravity was not part of the original harness verification survey. Its hook names, payload fields, response shapes and failure behavior are now established by the first-party hook contract, the build guide ("any non-zero exit code is logged ... and ignored (failing open)") and the agy release notes, and every graded capability is fixture-proven against that contract. The connector registers only fail-open observational, reminder and inject hooks; it registers no decision hook, so no hook failure can block or approve a tool call. No live agy session at the 1.5.4 floor has been recorded (the local agy was 1.0.4).

**`per-invocation-hook-spawn`** — PreInvocation runs before every model call, so a launched session spawns `ovld` once per invocation to record a prompt that usually has not changed. Repeats are dropped locally before any backend call; unlaunched sessions spawn nothing.

## Native decision shape

- **Codec** `antigravity`
- **Never send** `allow_tool`, `hookSpecificOutput`, `permissionDecision`, `permission`, `overwrite`
- **Allow fixture** `fixtures/decision-codec.json`
- **Deny fixture** `fixtures/decision-codec.json`
- **Defer fixture** `fixtures/decision-codec.json`

The PreToolUse response is `{ decision, reason?, overwrite?, permissionOverrides? }`. Antigravity's `allow` only defers to the next hook or default policy, so a remote approval is `auto_approve`; deny is `deny`; ask is silence, leaving the native permission flow. The connector never emits `overwrite`, which would rewrite tool arguments a person approved.

## Unbound-session negative test

Fixture: `fixtures/unbound-session.json` — proves what this adapter's registered
integrations do in a session with no Overlord binding, in an unrelated directory.

