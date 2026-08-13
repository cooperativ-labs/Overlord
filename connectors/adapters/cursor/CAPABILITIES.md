<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->

# Cursor Agent CLI — Overlord agent-session capabilities

**Adapter** `cursor` · **Codec** `cursor` · **Integration shape** `callback` · **Capability tier** 1 (Observational)

**Harness version verified** `2026.08.04-aaa8809` · **range** `>=2026.07.01` · **scheme** `calendar`

**Descriptor digest** `7085c25291f5c96cf3c7fb9c280281fa698b5c026e9859377ad8c53d1cd82537`

> The tier is derived from passing fixtures, never authored. `unsupported` means the harness
> cannot do it — do not attempt it. `not-implemented` means it is buildable and unbuilt: that is
> your work. `unverified` means find out first. `supported` without a passing fixture is a CI
> failure, not a claim.

## Session binding

| Field | Value |
| --- | --- |
| Status | ✅ supported |
| Source | `payload` |
| Field | `conversation_id` |
| Fallback field | `session_id` |
| Evidence | fixtures: `fixtures/normalize-before-submit-prompt.json` |

Cursor's current first-party hook reference defines `conversation_id` as stable across many turns. The executable prompt fixture and the shipped prompt/event codecs already use that field as the primary correlation alias, so the descriptor now matches the runtime instead of preferring the optional `session_id`. The verified channel credential remains the authority; neither identifier grants mission scope. A local authenticated resume probe was unavailable, so `session_id` remains a compatibility fallback rather than a competing primary identity.

The native session id is a **correlation alias only**. Authorization and mission scope come
from the verified channel/session credential; neither the working directory nor an unverified
native id is a binding authority.

## Decision hold

| Field | Value |
| --- | --- |
| Status | ✅ supported |
| Timeout field | `timeout` |
| Harness default | 60s |
| Harness ceiling | none documented |
| Evidence | fixtures: `fixtures/permission-request.json` |

The 60-second per-script default is an order of magnitude below any window sized for a human who is away from the keyboard. The adapter must always set `timeout` explicitly and must never rely on the default.

## Capabilities

| Capability | Status | Native | Evidence |
| --- | --- | --- | --- |
| `observe.prompt` | ✅ supported | `beforeSubmitPrompt` | fixtures: `fixtures/normalize-before-submit-prompt.json` |
| `observe.toolCall` | 🚧 not-implemented | `preToolUse` | tracked as `latch-engine` |
| `observe.toolResult` | ✅ supported | `postToolUse` | fixtures: `fixtures/normalize-post-tool-use-write.json` |
| `observe.fileEdit` | ✅ supported | `postToolUse` | fixtures: `fixtures/normalize-post-tool-use-write.json` |
| `observe.sessionLifecycle` | 🚧 not-implemented | `sessionStart` | tracked as `agent-session-phase-1` |
| `decide.shell` | 🚧 not-implemented | `beforeShellExecution` | tracked as `latch-engine` |
| `decide.mcp` | 🚧 not-implemented | `beforeMCPExecution` | tracked as `latch-engine` |
| `decide.fileWrite` | 🚧 not-implemented | `preToolUse` | tracked as `agent-session-phase-2` |
| `decide.anyTool` | 🚧 not-implemented | `preToolUse` | tracked as `latch-engine` |
| `decide.universal` | ⛔ unsupported | — | There is no single event covering every approval. Cursor's own Claude-compatibility map resolves `PermissionRequest` to null and lists it as unsupported; coverage is per tool class (shell, MCP, file read, generic pre-tool), so some approvals will never reach Overlord and the UI must not imply otherwise. (evidence: `connector-harness-taxonomy.md#42-what-is-verified`) |
| `answer.structuredQuestion` | ⛔ unsupported | — | No hook step returns a structured question with options; the decision surfaces return only allow/deny/ask plus free-text user/agent messages. (evidence: `connector-harness-taxonomy.md#42-what-is-verified`) |
| `answer.persistentAllow` | ⛔ unsupported | — | Hook responses are per-call; there is no "always" reply that persists a rule. (evidence: `connector-harness-taxonomy.md#42-what-is-verified`) |
| `inject.midTurn` | ⛔ unsupported | — | No mechanism exists to insert a message into a running turn. (evidence: `connector-harness-taxonomy.md#43-unique-challenges`) |
| `inject.turnBoundary` | ✅ supported | `stop` | fixtures: `fixtures/inject-followup-message.json` |
| `inject.nextTurn` | ✅ supported | `stop` | fixtures: `fixtures/inject-followup-message.json` |
| `terminal.concurrentAnswer` | ⛔ unsupported | — | The native prompt is drawn only after the hook returns, so nobody can answer locally while Overlord holds the decision. (evidence: `connector-harness-taxonomy.md#12-the-axis-that-actually-matters`) |
| `terminal.statusSurface` | ❓ unverified | — | tracked as `taxonomy-7.9` |

### Capability notes

- **`observe.toolCall`** — Mechanical preToolUse observation moved to Latch `events`. Native Cursor permission prompts own approvals when Latch is absent.
- **`observe.fileEdit`** — Carried on postToolUse rather than on Cursor's dedicated `afterFileEdit`, for the same reason Claude carries it on PostToolUse: one registration then covers every mutation, including the ones a shell command makes, and the split into `file.edited` happens where the normalized tool name is already known. `afterFileEdit` remains available if a future need appears for edit-level granularity the tool-level event cannot express.
- **`observe.sessionLifecycle`** — Cursor fires the event, but no shipped code in this repo has ever read one of its payloads, so the field carrying the equivalent of Claude's `source` is unknown. A codec rule on a guessed path would not fail loudly — an unresolved path yields a card with no detail — so this stays unbuilt until a real payload is recorded, rather than being claimed on an assumed field name.
- **`inject.turnBoundary`** — `stop` returns `followup_message` for the protocol delivery reminder. Session-input injection is no longer a live Overlord path.
- **`inject.nextTurn`** — Cursor's followup_message is scheduled for the next turn; the same path covers turn-boundary and next-turn naming.
- **`terminal.statusSurface`** — Whether Cursor exposes an in-TUI status surface equivalent to Claude's statusMessage was not established.

## Hazards

| Hazard | Severity | Verification | Mitigation | Tracked as |
| --- | --- | --- | --- | --- |
| `false-permission-hook-claim` | high | verified | implemented | fixture `fixtures/no-permission-request-hook.json` |
| `reads-claude-hook-config` | high | unverified | required | `taxonomy-7.1` |
| `allowlist-precedence` | medium | unverified | required | `taxonomy-7.8` |
| `fail-closed-inverts-fallback` | high | verified | implemented | fixture `fixtures/fail-closed-unset.json` |
| `post-tool-use-log-dir-precondition` | medium | verified | implemented | fixture `fixtures/post-tool-use-log-dir.json` |

**`false-permission-hook-claim`** — The shipped conformance manifest declared the `permissionHook` capability and a `PermissionRequest` hook type. Cursor maps that event to null and lists it as unsupported, so the declaration was false and would render remote controls that can never fire. Corrected in this descriptor and in the generated legacy projection.

**`reads-claude-hook-config`** — Cursor resolves hooks from Claude's own project-local, project, and user configuration in addition to its own. If plugin-provided hooks are expanded, Overlord's Claude hooks may fire inside Cursor sessions and emit Claude-shaped decisions into a Cursor-shaped contract — cross-connector misattribution with no code change on our side.

**`allowlist-precedence`** — Reported upstream that beforeShellExecution allow/ask is ignored when a command allowlist entry matches. A remote approval may be a no-op, so "we returned allow" is not proof the decision was decisive.

**`fail-closed-inverts-fallback`** — Cursor's per-script `failClosed` converts a hook failure into a block, inverting the core's fail-toward-the-harness rule. Overlord's hook registration must never set it.

**`post-tool-use-log-dir-precondition`** — The shipped postToolUse hook redirects stderr into ~/.ovld/logs without creating that directory first (Claude's equivalent does). On a machine where the directory does not yet exist the redirect fails and `ovld protocol record-touched` is never invoked, so touched-file attribution silently records nothing for that session. Fixed in phase 0B by creating the directory before the redirect, matching Claude's hook; the fixture guards the hook against losing that line again.

## Native decision shape

- **Codec** `cursor`
- **Never send** `hookSpecificOutput`, `permissionDecision`, `decision`
- **Allow fixture** `fixtures/decision-codec.json`
- **Deny fixture** `fixtures/decision-codec.json`
- **Defer fixture** `fixtures/decision-codec.json`

Cursor's own dialect is flat — `{ permission, user_message, agent_message }`. Claude's nested `hookSpecificOutput` must never be emitted here even though Cursor would accept it under `enableClaudeNestedHookSpecificOutputCompatibility`: relying on another vendor's compatibility shim for our primary path is a dependency we do not need. The decision-codec fixture executes the shared interpreter and pins all three outcomes.

## Unbound-session negative test

Fixture: `fixtures/unbound-session.json` — proves what this adapter's registered
integrations do in a session with no Overlord binding, in an unrelated directory.

