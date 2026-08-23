<!-- GENERATED FILE — DO NOT EDIT. Source: harness-capabilities.yaml. Regenerate with `yarn connectors:capabilities`. -->

# OpenCode — Overlord agent-session capabilities

**Adapter** `opencode` · **Codec** `opencode` · **Integration shape** `controlPlane` · **Capability tier** 3 (Conversational)

**Harness version verified** _not verified_ · **range** `>=0.5.0` · **scheme** `semver`

**Descriptor digest** `4af085fa3987501b85e323fdbfcc0c3cfe1a8da47ef373f0b509082749d2c44f`

> The tier is derived from passing fixtures, never authored. `unsupported` means the harness
> cannot do it — do not attempt it. `not-implemented` means it is buildable and unbuilt: that is
> your work. `unverified` means find out first. `supported` without a passing fixture is a CI
> failure, not a claim.

## Session binding

| Field | Value |
| --- | --- |
| Status | ✅ supported |
| Source | `env` |
| Field | `OVERLORD_SESSION_CHANNEL_ID` |
| Evidence | fixtures: `fixtures/sidecar-loopback-only.json` |

A control-plane adapter has no hook payload to read a binding out of, and it does not need one: the sidecar is started by Overlord, so it holds the channel bootstrap in its own environment from the first instant. The harness's own `sessionID` arrives on the event stream and is recorded as a correlation alias. That ordering is the opposite of a callback harness and produces the same authorization property, which is the point of separating correlation from authorization in the first place.

The native session id is a **correlation alias only**. Authorization and mission scope come
from the verified channel/session credential; neither the working directory nor an unverified
native id is a binding authority.

## Decision hold

| Field | Value |
| --- | --- |
| Status | ✅ supported |
| Harness ceiling | none documented |
| Evidence | fixtures: `fixtures/permission-reply-path.json` |

Shape C never *holds* anything: there is no callback to block, so a permission is a durable object on the harness's own bus that can be answered by either side. That makes `terminal.concurrentAnswer` reachable here and structurally impossible for Claude — the one place where the control-plane shape is strictly richer rather than merely different.

## Mutation-window evidence

| Field | Value |
| --- | --- |
| Classification | `post-only` |
| Executable fixture | `fixtures/mutation-window-evidence.json` |

A completed tool frame is recorded, but no matching in-progress frame exists.

The completion fixture proves post-only timing but exposes no normalized `file.edited`
path. Runtime file evidence is unavailable for this adapter.

## Capabilities

| Capability | Status | Native | Evidence |
| --- | --- | --- | --- |
| `observe.prompt` | 🚧 not-implemented | `message.updated` | tracked as `agent-session-phase-3` |
| `observe.toolCall` | 🚧 not-implemented | `message.part.updated` | tracked as `agent-session-phase-2` |
| `observe.toolResult` | ✅ supported | `message.part.updated` | fixtures: `fixtures/normalize-tool-completed.json` |
| `observe.fileEdit` | 🚧 not-implemented | `message.part.updated` | tracked as `agent-session-phase-2` |
| `observe.sessionLifecycle` | ✅ supported | `session.idle` | fixtures: `fixtures/normalize-session-idle.json` |
| `decide.shell` | ✅ supported | `/permission` | fixtures: `fixtures/permission-reply-path.json` |
| `decide.mcp` | ✅ supported | `/permission` | fixtures: `fixtures/permission-reply-path.json` |
| `decide.fileWrite` | 🚧 not-implemented | `/permission` | tracked as `agent-session-phase-2` |
| `decide.anyTool` | ✅ supported | `/permission` | fixtures: `fixtures/permission-reply-path.json` |
| `decide.universal` | 🚧 not-implemented | `/permission` | tracked as `agent-session-phase-2` |
| `answer.structuredQuestion` | 🚧 not-implemented | `/question` | tracked as `agent-session-phase-2` |
| `answer.persistentAllow` | 🚧 not-implemented | `POST /permission/{id}/reply (always)` | tracked as `agent-session-phase-2` |
| `inject.midTurn` | ✅ supported | `prompt_async` | fixtures: `fixtures/prompt-async-path.json` |
| `inject.turnBoundary` | ✅ supported | `prompt_async` | fixtures: `fixtures/prompt-async-path.json` |
| `inject.nextTurn` | ✅ supported | `prompt_async` | fixtures: `fixtures/prompt-async-path.json` |
| `terminal.concurrentAnswer` | ✅ supported | `GET /permission` | fixtures: `fixtures/permission-reply-path.json` |
| `terminal.statusSurface` | 🚧 not-implemented | — | tracked as `agent-session-phase-2` |

### Capability notes

- **`observe.prompt`** — Reachable on the same event stream, deliberately unregistered until the inject path exists: a user prompt and an Overlord-injected instruction arrive through the same frame, and recording them as the same thing before we can tell them apart would put words in a user's mouth in the activity feed.
- **`observe.toolCall`** — The same frame carries in-progress and completed parts. Grading the in-progress state as supported would require a fixture proving we can distinguish them, which the recorded payload set does not yet contain.
- **`observe.fileEdit`** — The codec can route a file-mutating tool to `file.edited`, but no recorded OpenCode fixture proves a normalized edit path yet. A completed shell frame is not file-edit evidence.
- **`answer.persistentAllow`** — OpenCode's `always` reply grants a standing permission on the machine. Product policy hides it from remote surfaces: a person approving from a phone cannot see what they are granting for the rest of the session, and an irreversible grant made from a surface that shows a summary is not informed consent.
- **`terminal.concurrentAnswer`** — Structurally available and unbuilt — the one adapter where this is a tracker rather than a permanent `unsupported`. A permission is a durable object on the bus, so the TUI and Overlord can both see it and either can answer; the loser learns it was resolved elsewhere. Callback harnesses cannot produce that outcome at all.

## Hazards

| Hazard | Severity | Verification | Mitigation | Tracked as |
| --- | --- | --- | --- | --- |
| `control-port-is-unauthenticated-by-default` | high | verified | implemented | fixture `fixtures/sidecar-loopback-only.json` |
| `replay-on-reconnect` | low | verified | implemented | fixture `fixtures/normalize-tool-completed.json` |
| `harness-version-unverified` | medium | unverified | required | `agent-session-verify-opencode-frames` |

**`control-port-is-unauthenticated-by-default`** — OpenCode's server accepts commands that drive the agent — running tools, sending prompts — and binds without authentication unless configured otherwise. Anything that can reach the port owns the session. The sidecar therefore binds loopback only, generates a per-launch OPENCODE_SERVER_PASSWORD, and never projects either the port or the secret to the browser or mobile clients, which reach Overlord's own authenticated surface instead.

**`replay-on-reconnect`** — A reconnecting sidecar re-reads state and re-emits frames it may already have sent. This is not mitigated by suppressing the replay — a sidecar cannot know what its predecessor delivered — but by content-derived producer event ids, so a replayed frame is a no-op at the server rather than a second row in the feed.

**`harness-version-unverified`** — The recorded event payloads were taken from the documented `/event` schema rather than from a running binary of a pinned version, so `harness.verifiedVersion` is absent. Frame shapes may differ in a released build. Record payloads from a real session and pin the version before grading anything else here as supported.

## Native decision shape

- **Codec** `opencode`
- **Never send** `hookSpecificOutput`, `permissionDecision`, `decision`, `permission`

Shape C answers over HTTP (`POST /permission/{id}/reply`) rather than by writing a decision to stdout. None of the callback dialects' response fields mean anything here, and emitting one would be silently ignored rather than rejected — the worst failure mode, because it looks like it worked.

## Unbound-session negative test

Fixture: `fixtures/unbound-session.json` — proves what this adapter's registered
integrations do in a session with no Overlord binding, in an unrelated directory.

