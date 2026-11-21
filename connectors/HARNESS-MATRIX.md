<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->

# Harness capability matrix

Generated from each adapter's fixture-backed `harness-capabilities.yaml` descriptor.
The descriptor is the single authored capability source; the tier and every table cell are
derived.

Legend: ✅ supported (fixture-proven) · ⛔ unsupported (harness cannot) · 🚧 not-implemented
(buildable, unbuilt) · ❓ unverified (find out first).

## Adapters

| Adapter | Harness | Verified version | Shape | Tier | Mutation evidence | Binding | Decision hold |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [`antigravity`](adapters/antigravity/CAPABILITIES.md) | Antigravity CLI | `docs + agy changelog 1.5.13` | `callback` | 1 (Observational) | `post-only` | ✅ supported | ❓ unverified |
| [`claude`](adapters/claude/CAPABILITIES.md) | Claude Code | `2.1.329` | `callback` | 1 (Observational) | `post-only` | ✅ supported | ✅ supported |
| [`codex`](adapters/codex/CAPABILITIES.md) | Codex CLI | `0.171.0` | `callback` | 1 (Observational) | `post-only` | ✅ supported | ✅ supported |
| [`codex-app-server`](adapters/codex-app-server/CAPABILITIES.md) | Codex app server | `0.171.0` | `controlPlane` | 3 (Conversational) | `paired` | ✅ supported | ✅ supported |
| [`cursor`](adapters/cursor/CAPABILITIES.md) | Cursor Agent CLI | `2026.08.04-aaa8809` | `callback` | 1 (Observational) | `post-only` | ✅ supported | ✅ supported |
| [`opencode`](adapters/opencode/CAPABILITIES.md) | OpenCode | — | `controlPlane` | 3 (Conversational) | `post-only` | ✅ supported | ✅ supported |
| [`pi`](adapters/pi/CAPABILITIES.md) | Pi Coding Agent | `0.83.0` | `extension` | 1 (Observational) | `unsupported` | ✅ supported | 🚧 not-implemented |

## Capabilities

| Capability | `antigravity` | `claude` | `codex` | `codex-app-server` | `cursor` | `opencode` | `pi` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `observe.prompt` | ✅ supported | ✅ supported | ✅ supported | ✅ supported | ✅ supported | 🚧 not-implemented | ✅ supported |
| `observe.toolCall` | 🚧 not-implemented | 🚧 not-implemented | 🚧 not-implemented | ✅ supported | 🚧 not-implemented | 🚧 not-implemented | 🚧 not-implemented |
| `observe.toolResult` | ✅ supported | 🚧 not-implemented | 🚧 not-implemented | ✅ supported | ✅ supported | ✅ supported | 🚧 not-implemented |
| `observe.fileEdit` | ✅ supported | ✅ supported | ✅ supported | ✅ supported | ✅ supported | 🚧 not-implemented | 🚧 not-implemented |
| `observe.sessionLifecycle` | 🚧 not-implemented | 🚧 not-implemented | 🚧 not-implemented | ✅ supported | 🚧 not-implemented | ✅ supported | 🚧 not-implemented |
| `decide.shell` | 🚧 not-implemented | 🚧 not-implemented | 🚧 not-implemented | ✅ supported | 🚧 not-implemented | ✅ supported | 🚧 not-implemented |
| `decide.mcp` | ❓ unverified | 🚧 not-implemented | 🚧 not-implemented | ❓ unverified | 🚧 not-implemented | ✅ supported | 🚧 not-implemented |
| `decide.fileWrite` | 🚧 not-implemented | 🚧 not-implemented | 🚧 not-implemented | ✅ supported | 🚧 not-implemented | 🚧 not-implemented | 🚧 not-implemented |
| `decide.anyTool` | 🚧 not-implemented | 🚧 not-implemented | 🚧 not-implemented | ⛔ unsupported | 🚧 not-implemented | ✅ supported | 🚧 not-implemented |
| `decide.universal` | ❓ unverified | 🚧 not-implemented | 🚧 not-implemented | ⛔ unsupported | ⛔ unsupported | 🚧 not-implemented | 🚧 not-implemented |
| `answer.structuredQuestion` | ❓ unverified | ❓ unverified | ❓ unverified | ❓ unverified | ⛔ unsupported | 🚧 not-implemented | 🚧 not-implemented |
| `answer.persistentAllow` | 🚧 not-implemented | 🚧 not-implemented | ❓ unverified | 🚧 not-implemented | ⛔ unsupported | 🚧 not-implemented | ⛔ unsupported |
| `inject.midTurn` | ⛔ unsupported | 🚧 not-implemented | ❓ unverified | ✅ supported | ⛔ unsupported | ✅ supported | 🚧 not-implemented |
| `inject.turnBoundary` | ✅ supported | 🚧 not-implemented | 🚧 not-implemented | ✅ supported | ✅ supported | ✅ supported | 🚧 not-implemented |
| `inject.nextTurn` | 🚧 not-implemented | 🚧 not-implemented | 🚧 not-implemented | ✅ supported | ✅ supported | ✅ supported | 🚧 not-implemented |
| `terminal.concurrentAnswer` | ❓ unverified | ⛔ unsupported | ⛔ unsupported | ✅ supported | ⛔ unsupported | ✅ supported | ⛔ unsupported |
| `terminal.statusSurface` | ❓ unverified | ✅ supported | ✅ supported | ✅ supported | ❓ unverified | 🚧 not-implemented | 🚧 not-implemented |

## Open hazards

| Adapter | Hazard | Severity | Verification | Mitigation | Tracked as |
| --- | --- | --- | --- | --- | --- |
| `antigravity` | `per-invocation-hook-spawn` | low | verified | accepted | — |
| `claude` | `hook-tool-unlisted-call` | medium | verified | required | `coo:1323.2ewy` |
| `codex` | `prompt-and-agent-hook-handlers-inert` | low | verified | accepted | — |
| `codex` | `hooks-version-and-platform-gate` | medium | verified | required | `agent-session-phase-4` |
| `codex` | `plugin-hook-trust-pinned-to-bundle` | high | verified | accepted | — |
| `codex-app-server` | `human-session-controls-closed` | low | verified | required | `coo-1325-control-plane-human-controls` |
| `codex-app-server` | `same-user-agent-reaches-credentials` | medium | verified | accepted | — |
| `cursor` | `allowlist-precedence` | medium | unverified | required | `taxonomy-7.8` |
| `opencode` | `harness-version-unverified` | medium | unverified | required | `agent-session-verify-opencode-frames` |
| `pi` | `no-native-floor-fails-open` | high | verified | accepted | — |
| `pi` | `block-is-visible-to-the-model` | medium | verified | accepted | — |
| `pi` | `typed-api-version-coupling` | medium | unverified | required | `taxonomy-7.10` |

## Reading this table

Before writing any code for a harness, read its descriptor or run
`ovld agent-session capabilities <agent>`. Do not attempt an `unsupported` capability. If you
believe the cited evidence is now wrong, replace `evidenceRef` and add the executable fixture
in the same change that flips the status.

