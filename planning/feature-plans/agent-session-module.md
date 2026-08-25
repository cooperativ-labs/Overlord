# Agent Session Module — Implementation Plan

Status: implemented (largely shipped; per-adapter capability coverage is partial —
see `connectors/HARNESS-MATRIX.md` for current, generated, fixture-backed
status). This document is a historical build order and worked examples below
may be aspirational; do not treat it as current-state documentation. Implements
the design in
[connector-hook-standard.md](./connector-hook-standard.md) (the harness-agnostic
core) against the harness facts in
[connector-harness-taxonomy.md](./connector-harness-taxonomy.md), feeding the
backend described in [agent-interaction-acp.md](./agent-interaction-acp.md).

This document is the build order: what modules exist, what files they contain,
what the wire format is, and — the part with the longest half-life — how each
adapter's capabilities are recorded so a future agent can tell in thirty seconds
what is possible for that harness and what is not.

Review correction: this module is the **local adapter runtime**, not the whole
Agent Session Exchange. It depends on the channel bootstrap, scoped credential,
versioned adapter REST surface, and durable request/input state machines in
[agent-interaction-acp.md](./agent-interaction-acp.md). Those are Phase 0
prerequisites, not details that this plan may substitute with the user's normal
CLI token or a cwd-derived session guess.

---

## 1. What is being built

One local module with **two entry points**, thin adapters, and a machine-readable
capability descriptor per adapter that is simultaneously the gating input, the
CI contract, and the documentation.

The module is named `agent-session` rather than `hooks`, matching the existing
`agent_sessions` table that already scopes this work. Pi and OpenCode have no
callback hooks at all; naming the module after one integration shape would make
those integrations permanent misfits.

There are **six catalog entries** to account for, not five: the five connectors
that ship today (Claude, Codex, Cursor, Pi, and Antigravity), plus OpenCode when
its new connector lands. Antigravity was outside the five-harness research
objective, so its interaction capabilities begin as `unverified`; omitting a
shipped connector would make the generated matrix less truthful than the one it
replaces.

### 1.1 The two entry points

|                      | **Push**                                            | **Call**                                                 |
| -------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| Question it answers  | "Something happened"                                | "May I, and what do I do while I wait?"                  |
| Blocking             | Never                                               | Yes, with a deadline                                     |
| Failure behavior     | No harness output; bounded local diagnostics        | Falls back to the harness's own behavior                 |
| Return value         | None                                                | A native decision, in the harness's exact shape          |
| Features built on it | Activity feed, delivery attribution, session health | Permission cards, blocking questions, structured choices |

Keeping these separate is the single most important structural decision here. A
merged entry point either lets a backend hiccup stall an unrelated session, or
loses the deadline-and-fallback discipline that makes blocking safe.

"No harness output" is not "undebuggable": after a session is in scope, push
failures increment bounded local diagnostics and degrade the channel heartbeat.
Before the scope gate succeeds, the adapter remains completely silent and does
no I/O, as required by the connector interaction core.

---

## 2. Module layout

### 2.1 `packages/core/service/agent-session/pure/` — pure

No I/O. No network. No filesystem. Everything here is a function from data to
data, which is what makes the security-relevant parts testable.

```
envelope.ts            Normalized event and answerable-request types
tool-normalize.ts      Native tool name/input -> normalized vocabulary
capabilities.ts        Capability vector, tier grading, descriptor types
window.ts              Decision-window policy (presence sizing, release triggers)
redact.ts              Payload reduction rules (§9 of the core doc)
describe/index.ts      Formatter registry keyed by normalized tool
describe/shell.ts      argv0, truncation, sudo/rm -rf/curl/pipe-to-shell markers
describe/write.ts      Path, byte count, create-vs-overwrite. Never content
describe/read.ts       Path only
describe/fetch.ts      Scheme/host/path, query string stripped
describe/mcp.ts        Server and tool name, input key names only
describe/generic.ts    Unknown tool: name + top-level keys, nothing else
```

Tests live beside them, with golden fixtures under
`packages/core/service/agent-session/__fixtures__/`.

### 2.2 `cli/src/agent-session/` — channel-authenticated runtime

The only local module that touches the Overlord network. It uses the
channel-lifetime, hash-only-server-side `OVERLORD_SESSION_CHANNEL_TOKEN` scoped
to one channel — never the user's broad `USER_TOKEN` — for adapter event,
request, input, and heartbeat calls. Human CLI diagnostics use normal user
authentication on their separate read surface.

```
bind.ts          Scope gate and binding; extends the existing native-session.ts
channel.ts       Validate channel bootstrap and select the scoped credential
event.ts         Push path: gate -> reduce -> post -> exit
request.ts       Call path: gate -> create -> wait -> resolve, with fallback
inbox.ts         Pull pending injections for adapters that poll
descriptor.ts    Load, validate, and expose the harness descriptor (§4)
sentinel.ts      Lightweight channel heartbeat/process-exit reporter
codec-registry.generated.ts  Build output from connector-owned codecs
```

`cli/src/native-session.ts` already caches a native session id per
(cwd, mission, agent) and the Pi extension already writes into that cache.
`bind.ts` replaces that cwd-bearing key as the authority for this feature: the
native session id is a lookup/correlation alias, while the channel id plus its
credential is the authorization and mission scope. Cwd may help locate an
existing local binding but can never create one or authorize an event.

For an Overlord launch, the channel is created before spawn and the runner exports
`OVERLORD_SESSION_CHANNEL_ID` and `OVERLORD_SESSION_CHANNEL_TOKEN`. Protocol
`attach` atomically binds the channel to `agent_sessions.id` and records the
native session id when available. A manual/unlaunched session gains a channel
only through authenticated attach. `ovld agent-session bind` must therefore
require either the active session key or the channel credential; possession of a
native id alone never permits binding or rebinding.

"Short-lived" means revocable with the channel, not "expires halfway through a
healthy long-running agent." The server extends the credential's bounded expiry
with the channel lease and revokes it on `ended`/`lost` or an absolute lifetime
ceiling. If rotation is required before that ceiling, attach/runtime must define
a one-time bootstrap-to-local-credential exchange and atomic refresh before
shipping; an environment bearer with no refresh path is not an acceptable
design. Manual attach stores the scoped credential in an owner-only global-data
file keyed by channel/native session and removes it when the channel ends.

### 2.3 `connectors/core/scripts/agent-session-hook.sh` — one shared script

Following the `overlord-mcp.mjs` precedent, this is written once in
`connectors/core/scripts/` and rendered per adapter at `ovld agent-setup` time
with both the adapter key and a fixed action substituted. There is no
payload-controlled `$1` dispatch and no per-adapter shell state machine. Existing
edit-capture behavior stays installed until the new event runtime has parity;
the migration must not repair permission handling by regressing touched-file
attribution.

```bash
#!/bin/bash
command -v ovld >/dev/null 2>&1 || exit 0
ovld agent-session <FIXED_ACTION> --agent <ADAPTER_KEY> --payload-file -
```

The harness payload streams directly from stdin, avoiding a shell variable's
size and NUL-byte semantics. The rendered registration chooses `event` or
`request`; untrusted payload data cannot choose a CLI operation. For `request`,
stdout and exit status pass through unchanged so the native decision actually
reaches the harness. The CLI itself guarantees that every failure-to-decide path
emits no bytes and exits with the harness's documented defer behavior.

### 2.4 `connectors/adapters/<agent>/` — translation only

Per adapter: the harness's own hook/extension registration, connector-owned
normalization/decision codecs, a `harness-capabilities.yaml` descriptor, and
nothing else new. Pi keeps its TypeScript extension; OpenCode gains a sidecar
entry point rather than a script. The source codecs live here because native
event and decision contracts belong to the Connector Layer. A dedicated build
step compiles them into `cli/src/agent-session/codec-registry.generated.ts`; the
CLI owns execution and transport but does not become the source of truth for
harness dialects.

### 2.5 `packages/core/service/agent-session/` — durable services

The impure service layer sits beside `pure/` and is shared by REST and the
protocol attach path. It owns transactions, resource-derived authorization,
idempotency, revision CAS, projection to `mission_events`/`entity_changes`, and
Postgres/SQLite-equivalent state transitions.

```
channels.ts     Create/bind/heartbeat/end channels; hash scoped credentials
events.ts       Idempotent append, sequence-gap diagnostics, mission projection
requests.ts     Create/wait/resolve/release/cancel and waiter leases
inputs.ts       Enqueue/lease/emit/ack/fail without post-emission auto-retry
capabilities.ts Compute the effective live-channel snapshot from catalog + probes + policy
```

### 2.6 `backend/agent-session-routes.ts` — HTTP boundary

One router implements two deliberately separate auth families:

- `/api/agent-session-channels/v1/*` accepts only a scoped channel credential
  and exposes adapter event/request/input/heartbeat operations for that channel;
- human routes resolve capabilities, list/answer requests, and enqueue/cancel
  input through normal session/token auth plus resource-derived RBAC.

Route handlers validate and delegate to the service layer. They do not write
tables or duplicate state machines.

### 2.7 Database and launch integration

Both database dialects add the four Exchange tables and constraints specified in
the parent architecture. Generated database types are refreshed through the
repo's normal codegen path. Runner/manual/virtual launch preparation creates the
channel and passes only its bootstrap; the lightweight sentinel reports process
liveness and exit but never becomes a message broker or addressable runner.

---

## 3. Local command and network surfaces

Four adapter-runtime subcommands as originally planned (shipped as six —
`capabilities` and `sidecar` were added for control-plane harnesses; see
`cli/src/agent-session/index.ts`). Adding another harness must add **zero**
subcommands — that is the test for whether the waist is in the right place.

```
ovld agent-session event   --agent <key> --payload-file -
ovld agent-session request --agent <key> --payload-file -
ovld agent-session inbox   --agent <key> --channel <channel-id>
ovld agent-session bind    --agent <key> --native-session-id <id> \
  (--channel <channel-id> | --session-key <key>)
```

Everything harness-specific travels as **data** — the payload is the harness's
native JSON, and the adapter key selects a connector-owned codec. `request`
writes the native decision to stdout and exits 0; on any failure it writes
nothing and uses the defer behavior verified for that adapter. Exit `0` is not
assumed universal: the descriptor fixture records the exact stdout/stderr/exit
tuple.

A fifth, human-facing command completes the surface:

```
ovld agent-session capabilities [<agent>]   # print the descriptor, human or --json
```

This exists so an agent working in a terminal can ask what is possible without
reading files, which is the fastest path to the answer and therefore the one
that will actually get used.

The adapter commands call the versioned
`/api/agent-session-channels/v1/*` route family from the parent architecture.
They do not use `ovld protocol hook-event`, and they are not added to
`contract/protocol-commands.yaml`: they do not mutate the mission lifecycle.
They create a new sanctioned **Connector → CLI Agent Session Runtime → REST**
surface, which must be added to `CONTRACT.md` and `contract/components.yaml`
before implementation. The human `capabilities` and `ovld requests` commands
use ordinary authenticated read/resolve routes and cannot present a channel
credential as a human actor.

---

## 4. The harness descriptor — how the documentation stays true

This is the part the rest of the plan exists to support.

`connectors/README.md` already carries a hand-written adapter capability matrix
that tries to separate deliberate gaps from unported work. That instinct is
right and the format is wrong: prose maintained by hand alongside code drifts,
and a matrix that is 60% accurate is worse than none, because it is trusted.

So: **one machine-readable descriptor per adapter, which the runtime reads for
gating, CI validates against fixtures, and the documentation is generated
from.** It cannot drift from the code, because it _is_ the code's input.

### 4.1 The four states

Two states (`yes`/`no`) is the trap. An agent reading "no" cannot tell whether
to give up or to start building, and both errors are expensive: one wastes a day
on something structurally impossible, the other leaves a capability unbuilt for
a year because someone assumed it was refused.

| Status            | Meaning                                     | Required fields         |
| ----------------- | ------------------------------------------- | ----------------------- |
| `supported`       | Works today, proven                         | `native`, `fixtures`    |
| `unsupported`     | The harness cannot do this. Do not attempt  | `reason`, `evidenceRef` |
| `not-implemented` | The harness can; we have not built it       | `trackedAs`             |
| `unverified`      | Nobody knows. Find out before relying on it | `trackedAs`             |

The rule that keeps this honest: **`supported` requires an executable fixture,
and CI runs it against the compiled codec.** Checking only that a named file
exists would allow an empty fixture to claim a capability into existence. A
fixture contains a recorded native input, expected normalized envelope or exact
native decision bytes, stderr, and exit status. This is the direct fix for the
conformance manifests that currently claim interaction hooks which do not work.

The second rule: **changing a status from `unsupported` to anything else
requires replacing `evidenceRef` with executable fixtures.** Turning a hard
limit into work is a decision that should leave a trace.

### 4.2 Schema

`connectors/adapters/<agent>/harness-capabilities.yaml`, validated by
`contract/harness-capabilities.schema.yaml`:

```yaml
schemaVersion: 1
adapter: <key>
codec: <connector-owned codec key>
harness:
  name: <display name>
  verifiedVersion: <version actually tested>
  versionRange: <range syntax declared by versionScheme>
  versionScheme: semver | calendar | opaque
integrationShape: callback | extension | controlPlane

binding:
  source: env | payload | api | none
  field: <name>
  status: <one of the four>
  fixture: <required when supported>

decisionHold:
  status: <one of the four>
  timeoutField: <config key>
  timeoutUnit: seconds | milliseconds
  defaultTimeoutSeconds: <n>
  maxTimeoutSeconds: <n | null>

capabilities:
  <capability-id>:
    status: <one of the four>
    native: <native event or endpoint>
    fixtures: [<executable fixture paths, required when supported>]
    reason: <required when unsupported>
    evidenceRef: <stable taxonomy section/source reference when unsupported>
    trackedAs: <required when unverified or not-implemented>

hazards:
  - id: <slug>
    severity: low | medium | high
    summary: <what can go wrong>
    verification: verified | unverified
    mitigation: required | implemented | accepted
    fixture: <required when mitigation is implemented>
    trackedAs: <required when verification is unverified or mitigation is required>

decisionShape:
  codec: <connector-owned codec key>
  allowFixture: <exact-output fixture>
  denyFixture: <exact-output fixture>
  deferFixture: <stdout/stderr/exit fixture>
  neverSend: [<fields this harness rejects or reserves>]
```

The capability id vocabulary is closed and lives in the machine-readable
contract, with generated TypeScript types in core, so the same id means the
same thing across every adapter:

`observe.prompt`, `observe.toolCall`, `observe.toolResult`, `observe.fileEdit`,
`observe.sessionLifecycle`, `decide.shell`, `decide.mcp`, `decide.fileWrite`,
`decide.anyTool`, `decide.universal`, `answer.structuredQuestion`,
`answer.persistentAllow`, `inject.midTurn`, `inject.turnBoundary`,
`inject.nextTurn`, `terminal.concurrentAnswer`, `terminal.statusSurface`.

### 4.3 Worked example — Cursor

Cursor is the useful example because it is the one where a naive reading gets it
backwards: its manifest currently claims a permission hook it does not have,
while the capability it _does_ have is richer than Claude's in one respect.

```yaml
schemaVersion: 1
adapter: cursor
codec: cursor
harness:
  name: Cursor Agent CLI
  verifiedVersion: '2026.07.23-e383d2b'
  versionRange: '>=2026.07.01'
  versionScheme: calendar
integrationShape: callback

binding:
  source: payload
  field: session_id # falls back to conversation_id
  status: unverified
  trackedAs: taxonomy-7.6

decisionHold:
  status: supported
  fixture: fixtures/decision-hold.json
  timeoutField: timeout
  timeoutUnit: seconds
  defaultTimeoutSeconds: 60
  maxTimeoutSeconds: null

capabilities:
  decide.shell:
    status: supported
    native: beforeShellExecution
    fixtures: [fixtures/before-shell-execution.json]
  decide.mcp:
    status: supported
    native: beforeMCPExecution
    fixtures: [fixtures/before-mcp-execution.json]
  decide.anyTool:
    status: supported
    native: preToolUse
    fixtures: [fixtures/pre-tool-use.json]
  decide.universal:
    status: unsupported
    reason: >-
      There is no single event covering every approval. Coverage is per tool
      class, so some approvals will never reach Overlord and the UI must not
      imply otherwise.
    evidenceRef: connector-harness-taxonomy.md#42-what-is-verified
  inject.midTurn:
    status: unsupported
    reason: No mechanism exists to insert a message into a running turn.
    evidenceRef: connector-harness-taxonomy.md#43-unique-challenges
  inject.turnBoundary:
    status: supported
    native: stop
    fixtures: [fixtures/stop-followup.json]
  answer.persistentAllow:
    status: unsupported
    reason: Hook responses are per-call; there is no "always" reply.
    evidenceRef: connector-harness-taxonomy.md#42-what-is-verified
  terminal.concurrentAnswer:
    status: unsupported
    reason: >-
      The native prompt is drawn only after the hook returns, so nobody can
      answer locally while Overlord holds the decision.
    evidenceRef: connector-harness-taxonomy.md#42-what-is-verified

hazards:
  - id: reads-claude-hook-config
    severity: high
    summary: >-
      Cursor resolves hooks from Claude's own project-local, project, and user
      configuration in addition to its own. If plugin-provided hooks are
      expanded, Overlord's Claude hooks may fire inside Cursor sessions and emit
      Claude-shaped decisions into a Cursor-shaped contract.
    verification: unverified
    mitigation: required
    trackedAs: taxonomy-7.1
  - id: allowlist-precedence
    severity: medium
    summary: >-
      Reported upstream that beforeShellExecution allow/ask is ignored when a
      command allowlist entry matches. A remote approval may be a no-op, so
      "we returned allow" is not proof the decision was decisive.
    verification: unverified
    mitigation: required
    trackedAs: taxonomy-7.8
  - id: fail-closed-inverts-fallback
    severity: high
    summary: >-
      Cursor's per-script failClosed converts a hook failure into a block, which
      inverts the core's fail-toward-the-harness rule. Overlord scripts must
      leave it off.
    verification: verified
    mitigation: implemented
    fixture: fixtures/fail-closed-unset.json

decisionShape:
  codec: cursor
  allowFixture: fixtures/decision-allow.json
  denyFixture: fixtures/decision-deny.json
  deferFixture: fixtures/decision-defer.json
  neverSend: [hookSpecificOutput, permissionDecision, decision]
```

### 4.4 What is generated from it

| Artifact                                      | Purpose                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `connectors/adapters/<agent>/CAPABILITIES.md` | Per-adapter page, generated, with a do-not-edit banner                    |
| `connectors/HARNESS-MATRIX.md`                | Cross-adapter matrix replacing the hand-written README section            |
| `cli/src/agent-session/catalog.generated.ts`  | Compiled descriptors/codecs bundled into the CLI                          |
| `GET /api/agent-connectors/v1/capabilities`   | Static catalog projection; diagnostics only, never session control gating |

Generation gets its own deterministic script, invoked by
`scripts/sync-connector-versions.mjs` and `yarn connectors:check`; version sync
does not itself become a schema compiler. The generator also derives the tier
and the deprecated hook-named conformance flags. During the one-release
transition the conformance manifest references the descriptor path and carries
only this generated legacy projection, so there are not two hand-authored
capability sources that can disagree.

**The runtime reads the compiled bundle, not the YAML.** Parsing YAML from disk
on the hook path would violate the latency invariant, and the installed adapter
may be older than the CLI. The installed managed files include a descriptor
digest/version marker; `ovld doctor` compares it with the compiled catalog and
reports drift — which turns "your connector is stale" from an invisible failure
into a diagnosable one.

Web and mobile gate controls on the **effective capability snapshot stored on
the live session channel**, not this static catalog. Installed harness version,
hook trust, connector drift, project policy, and runtime probes may all downgrade
the session below the catalog maximum.

### 4.5 How an agent uses this

`connectors/AGENTS.md` gains one section, placed before "Adding a New Agent
Connector", saying:

> Before writing any code for a harness, read
> `connectors/adapters/<agent>/harness-capabilities.yaml`, or run
> `ovld agent-session capabilities <agent>`. It is authoritative and
> fixture-backed.
>
> - `unsupported` means the harness cannot do it. Do not attempt it. If you
>   believe the cited evidence is now wrong, replace `evidenceRef` and add the
>   executable fixture in the same change that flips the status.
> - `not-implemented` means it is buildable and unbuilt. This is your work.
> - `unverified` means find out first. Write the fixture, then flip the status.
> - `supported` without passing fixtures is a CI failure, not a claim.

That paragraph is the actual deliverable of the documentation request. Everything
else in §4 exists to make it true.

---

## 5. Failure semantics

One table, because this is where the bugs will be.

| Condition                   | Push path                                       | Call path                                                                   |
| --------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| No verified scope/channel   | Exit with no I/O                                | Defer exactly as fixture; native behavior                                   |
| Backend unreachable         | Drop; bounded local diagnostic; degrade channel | Defer; release waiter lease; native behavior                                |
| Channel auth failure        | Drop; mark local setup stale                    | Defer; never retry with the user's broader credential                       |
| Deadline reached            | N/A                                             | CAS `open -> released_to_terminal`, then native behavior                    |
| Malformed native payload    | Drop after local bounded diagnostic             | Defer; no raw payload in logs                                               |
| Formatter throws            | Generic structural card                         | Generic structural card, still decidable                                    |
| Local interrupt during wait | N/A                                             | Best-effort cancel; waiter lease expiry closes controls if signal is lost   |
| Resolution/release race     | N/A                                             | One revision CAS wins; loser re-reads and emits no contradictory decision   |
| Pi, no answer by deadline   | N/A                                             | **Tool proceeds**; remote gating is disabled without explicit policy opt-in |

The last row is the one to keep visible in review. For callback harnesses
"fail toward the harness" normally means a human sees a dialog. For Pi it means
the tool runs. That is a different risk posture: Pi's decision interception is
off by default, requires project-policy opt-in, and the UI names the fail-open
behavior before enabling it.

Every blocking call holds a short server-side waiter lease renewed by long poll.
The request's answer window is bounded below the harness timeout. If the CLI is
killed before its cancellation write lands, lease expiry atomically releases or
cancels the request and disables remote controls. This prevents a card from
remaining answerable after the native prompt is already active.

### 5.1 Security gates before persistence or display

- Native payloads are untrusted model/harness input. Adapter codecs validate
  against a size-bounded schema before normalization; unknown fields are dropped,
  not copied into `details_json` or logs.
- Scope resolution runs before logging, interpreter spawn, filesystem writes, or
  network access. The only pre-gate operation is bounded stdin read plus native
  id/channel lookup from already-known local state.
- Channel credentials travel only through environment/stdin or an authorization
  header, never argv, URLs, descriptor files, events, diagnostics, or crash text.
  The manual-attach credential cache is the narrow exception: owner-only,
  channel-scoped, atomically written, never checkout-local, and deleted on
  channel end. Binding metadata without a credential grants no authority.
- The server applies a second payload allowlist and bounds every summary, option,
  id, sequence, timestamp, and diagnostic code. Formatter output renders as
  escaped plain text; truncation is explicit.
- Human request resolution requires the separate permission-resolution RBAC,
  workspace policy ceiling, project opt-in, revision CAS, and immutable audit
  attribution. Adapter credentials cannot call this surface.
- OpenCode's harness control port binds loopback, uses a per-launch secret, and
  is never projected to the browser/mobile clients. The sidecar accepts only the
  exact instance recorded in the channel bootstrap.
- APNs/realtime summaries follow the parent privacy contract: no credential, raw
  tool input, command, file content, question body, or injected instruction is
  included in a push payload.

---

## 6. Phases

### Phase 0A — Contract and truth (no interaction behavior)

The original order repaired scripts before the runtime and backend commands they
would call existed. Contract and truthful declarations land first:

- Update `CONTRACT.md`, `contract/components.yaml`, the conformance-manifest
  schema, extension points, and database/REST contracts for the new surfaces.
- Reconcile §3 of `connector-hook-standard.md` with the parent channel design:
  a native session id is the only safe harness correlation key, but a verified
  channel/session credential is the authorization and mission scope. Neither
  cwd nor an unverified native id is a binding authority.
- Add the descriptor schema, dedicated generator, executable fixture runner,
  and CI drift check.
- Add descriptors for all five shipped connectors. Antigravity begins
  conservatively as `unverified`; OpenCode's descriptor lands with its connector.
- Generate the legacy conformance capability projection and correct Cursor's
  false universal `PermissionRequest` claim.
- Add `ovld agent-session capabilities` and the `connectors/AGENTS.md` section.
- Extend `ovld doctor` to report installed descriptor digest/version and current
  native-session binding without making a network call for an unbound session.

**Acceptance:** tiers are derived only from passing fixtures; every shipped
connector appears in generated docs; an unrelated unbound session performs no
write, subprocess spawn, network call, or log.

### Phase 0B — Channel bootstrap and runtime skeleton

- Create the channel before launch, pass the scoped credential, bind it during
  protocol attach, and implement the versioned adapter route authorization.
- Add the local `channel.ts`/`bind.ts` gate and the rendered shared-script path.
- Preserve existing PostToolUse touched-file capture until normalized events
  prove equivalent attribution; do not replace working hooks wholesale.
- Add waiter lease and clean process-exit handling before any answerable request
  UI can be enabled.

**Acceptance:** a channel credential can affect exactly one channel, cannot read
mission context or resolve a human decision, and a normal user/session token is
rejected on the adapter route. Pre-attach events bind after attach without using
cwd as authority. A healthy session survives credential lease renewal, while
channel end/loss immediately revokes the credential and removes its local cache.

### Phase 1 — Push, on two shapes at once

Claude (callback) and OpenCode (control plane) ship together deliberately. A
waist built against one shape encodes that shape.

- `envelope.ts`, `redact.ts`, `describe/*` with golden fixtures.
- `event.ts` and the Claude `PostToolUse`/`UserPromptSubmit`/`SessionStart`
  registrations, with an explicit parity test for existing follow-up and
  touched-file attribution.
- The OpenCode sidecar: launch with `--port`, bind loopback only, use a
  per-launch `OPENCODE_SERVER_PASSWORD`, subscribe to `/event`, and re-read
  `/permission` and `/question` on reconnect.

**Acceptance:** the same normalized event reaches the feed from both harnesses;
duplicate/replayed producer ids remain idempotent; the OpenCode path reconciles
state after a killed/restarted sidecar; no raw prompt/tool payload reaches logs.

### Phase 2 — Call

- `window.ts`, `request.ts`, and the connector-owned Claude/Cursor codecs.
- Presence sizing, idle-to-active release, revision CAS, and waiter leases.
- `ovld requests` as the second-terminal surface.
- OpenCode resolution via `POST /permission/{id}/reply`, including the honest
  resolved-elsewhere outcome the callback harnesses cannot produce.

**Acceptance:** a permission approved from the web app pre-empts the Claude
terminal prompt; timeout, interrupt, process kill, backend loss, and a concurrent
remote answer each leave exactly one terminal/request state; an OpenCode answer
in the TUI marks the card resolved elsewhere within one event round trip.

### Phase 3 — Inject

- `inbox.ts`, Claude `asyncRewake`, Pi `sendUserMessage`, OpenCode
  `prompt_async`, and Cursor `stop`/`followup_message`.
- Honest `Delivered` / `Queued(boundary)` / `Unsupported` reporting per adapter,
  backed by acknowledgements where the harness exposes them.

**Acceptance:** no adapter reports `Delivered` for a message the agent has not
received; an emitted input is never automatically retried; Cursor reports
`Queued(turn-boundary)` and says so in the UI.

### Phase 4 — Remaining adapters

Pi's opt-in decision path, then Codex — Codex last because it is the least
verifiable and because the app-server question may make the hook path redundant.
Antigravity remains at its fixture-proven tier until a separate verification
objective upgrades it; no generated UI control is inferred from agent name.

---

## 7. Testing

- **Golden fixtures per formatter**, including adversarial cases: embedded
  newlines and control characters, unicode homoglyphs in paths, truncation-forcing
  lengths, and inputs constructed so a destructive action renders as benign.
- **Dialect conformance**: for each adapter, the exact bytes emitted for allow,
  deny, and defer — including stderr and exit status — asserted against a
  recorded native fixture by executing the compiled codec.
- **The negative test, per adapter**: an unbound session in an unrelated
  directory produces no request, event, network call, subprocess, log, or delay.
- **Descriptor/fixture consistency**: every `supported` fixture executes and
  passes; every `unsupported` has a stable evidence reference; every
  `unverified` has a tracker id; every shipped connector has a descriptor.
- **Tier derivation**: no tier is authored; generated catalog and effective
  session tier equal what fixtures and runtime probes prove.
- **Scope/auth isolation**: a channel credential is accepted only for its own
  channel; user tokens cannot impersonate adapters; adapter tokens cannot
  resolve human decisions or read mission context; native ids and cwd do not
  authorize anything.
- **State-machine races**: resolution vs release, SIGINT vs answer, lost process
  vs waiter-lease expiry, duplicate events, and input lease reclaim run against
  SQLite and Postgres with the same terminal state.
- **Packaging parity**: `ovld agent-setup` installs the descriptor digest and
  rendered fixed-action script; the packaged CLI registry matches the source
  connector assets; `ovld doctor` detects an older installed adapter.
- **Regression parity**: existing touched-file capture and `UserPromptSubmit`
  follow-up attribution remain correct throughout migration.

---

## 8. Contract impact

As set out in §13 of the core document, the implementation requires a contract
version bump before Phase 0B: capability names that describe behavior rather
than Claude hook names, a declared `integrationShape`, a derived
`capabilityTier`, and retirement of the closed four-value `hookTypes` enum in
favor of the normalized event vocabulary. The existing four hook-named flags
stay as generated deprecated aliases for one release.

`contract/harness-capabilities.schema.yaml` is new and referenced from
the connector block in `contract/conformance-manifest.schema.yaml` and
`contract/extension-points.yaml`. The descriptor is the only hand-authored
capability source; the manifest records its path/digest and generated legacy
projection.

The contract also adds the Connector → CLI Agent Session Runtime → REST surface,
the `/api/agent-session-channels/v1/*` adapter route family, its scoped credential
rules, and the separate authenticated human request/capability routes. These were
missing from the first draft even though the current contract sanctions only
Connector → Protocol hooks.

Affected modules: `cli` (doctor, setup, new subcommands and scoped adapter
client), `connectors` (five shipped manifests/descriptors plus new OpenCode),
`packages/core` (pure normalization plus durable state-machine services),
`backend` (adapter/human routes and effective capability projection), `auth`
(channel credential and separate human permissions), `database` (the four
Exchange tables from the parent design, but no persisted derived tier), and
`webapp`/mobile (gate on the live channel snapshot, never agent identifier).

---

## 9. Safe first-release defaults and explicit product gates

The parent design already establishes the safe baseline. The implementation
should be executable without silently choosing broader authority:

1. **OpenCode `always` is hidden in the first release.** Remote controls offer
   allow-once and deny only. Standing permission policy needs its own later
   design, confirmation, audit language, and RBAC review.
2. **Pi remote decisions are off by default.** They require explicit
   workspace-policy ceiling plus project opt-in that names the fail-open timeout.
   Observation and injection can ship independently.
3. **Window defaults are 30 seconds when recently active and 30 minutes when
   away/unknown, capped below the harness timeout.** Idle-to-active releases
   immediately; project policy may set the window to zero. Any different maximum
   is a PM decision before Phase 2, not an adapter constant.
4. **`ovld requests` ships in Phase 2.** It depends on the request state machine,
   scoped authorization, and waiter leases, so Phase 0 cannot safely offer it
   merely because its presentation is cheap.

These defaults are policy ceilings, not evidence claims. Harness verification
may reduce what is offered; it may never widen these controls on its own.
