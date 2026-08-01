# Agent Session Exchange: Events, Requests, and Control (coo:447)

**Status:** Architecture revision. No implementation in this objective.
**Revised:** 2026-07-30.
**Contract reviewed:** `CONTRACT.md` version 42.
**Depends on:** the execution-target identity work implemented through contract
version 41 in
[`execution-target-identity.md`](./execution-target-identity.md).

This document supersedes the architecture and phasing in the first coo:447
proposal. Its ACP assessment remains valid: ACP is not the transport for an
ordinary Overlord terminal session. The revision incorporates the shipped
execution-target/runner model and a fresh audit of the current connector
capabilities.

## Executive decision

Build a versioned **Agent Session Exchange** in Overlord's backend/service layer.
It is a durable, session-scoped event and control API:

- connector adapters publish normalized session events;
- agents and blocking hooks open answerable requests;
- authenticated humans resolve those requests;
- humans queue instructions for one explicit running session; and
- connector adapters claim and inject those instructions using the best
  mechanism their harness supports.

Do **not** make the persistent runner the interaction broker. The runner should
bootstrap a session channel when it launches an agent and may run a lightweight
per-launch sentinel for liveness and process-exit reporting, but it must not
capture transcripts, interpret harness events, or receive user instructions.

The distinction matters after coo:522:

- an execution target is the user-selected routing identity;
- several native or adopted runner instances may serve that target;
- an execution request selects the target, never one runner instance;
- the runner that wins a claim opens a terminal and then loses ownership of the
  agent's stdio and terminal pane; and
- the `agent_sessions` row created by protocol attach is the durable identity of
  the conversation the user wants to observe or steer.

Therefore user interaction targets an **agent session channel**, not an
execution target and not `claimed_by_runner_registration_id`. The winning runner
registration remains provenance and diagnostics only.

The user interface is deliberately deferred. Once the event, request,
acknowledgement, and capability contracts are real, mission widgets can render
them without inventing semantics in the client.

---

## 1. Questions raised by the objective, with recommended answers

These are the questions that would materially change the architecture. None
blocks revising the plan, so each has a recommended default.

### 1.1 Where should the persistent exchange live?

**Answer: in the backend/service layer, keyed to a session channel.**

The backend already owns durable mission/session state, authorization,
idempotency, the entity-change feed, and Local-versus-Cloud portability. A
runner process is the wrong owner because it is one of potentially several
processes serving a target and stops being involved after terminal launch.

There may be a small local process for liveness, but it is a client of the
exchange rather than the source of truth.

### 1.2 What is the canonical interaction identity?

**Answer: `agent_sessions.id` after attach, with a pre-attach channel ID created
for the launch attempt.**

Harness-native IDs such as Claude's `session_id`, Codex's thread ID, Cursor's
conversation ID, and Pi's session file are aliases. A mission ID is too broad:
one mission can have concurrent or historical sessions. A runner instance is
also too broad: it can launch or serve many sessions.

### 1.3 How are events extracted accurately?

**Answer: only from supported harness hooks/extensions and Overlord's own
protocol operations.**

Do not tail private transcript files, scrape terminal text, intercept
keystrokes, or infer semantic events from process output. Those approaches are
agent-specific but live outside the connector adapters, are unstable, and
cannot provide trustworthy correlation.

The connector maps a native event onto a versioned Overlord envelope. Unknown
or unavailable native events remain explicitly unsupported.

### 1.4 Can Overlord promise every failure from every harness?

**Answer: no. Promise capability-graded coverage.**

Claude Code currently exposes a typed `StopFailure` event for rate limits,
overload, authentication, billing, invalid requests, missing models, server
errors, and max-output-token failures. Codex's documented hook release exposes
session, prompt, permission, tool, compaction, and stop events, but no equivalent
provider-failure event. Cursor likewise does not currently provide a documented
universal provider-failure event.

Overlord can always report channel liveness and process exit for an
Overlord-launched session. It can report a precise provider failure only where
the adapter receives a supported native event.

### 1.5 What does “delivered to the agent” mean?

**Answer: use several states and never collapse them.**

For an inbound instruction:

1. `queued` — durably accepted by Overlord;
2. `leased` — one session adapter claimed it;
3. `emitted` — the adapter returned/invoked the harness-specific injection;
4. `acknowledged` — a later native event proves the harness accepted it; or
5. `failed`, `expired`, or `cancelled`.

Many hooks can prove `emitted` but not `acknowledged`. The API and eventual UI
must say so. “Sent” must never be presented as “the model saw it.”

### 1.6 How is the race between a remote answer and the terminal handled?

**Answer: remote-first inside a bounded window, then a one-way handoff to the
terminal — but the window length is driven by human presence, not by a constant.**

The old plan said “first answer wins.” That overclaims what the harness APIs can
observe. For a native permission prompt, the harness runs the blocking hook
_before_ drawing its terminal dialog:

1. the adapter creates a request and waits for a bounded remote window;
2. a remote resolution during that window is translated into a hook decision;
3. if the window expires, the request atomically becomes
   `released_to_terminal`;
4. only then does the hook return no decision and allow the native prompt to
   appear; and
5. the web/mobile resolution controls disable immediately.

Some harnesses can later report the terminal result; some cannot. In the latter
case Overlord records that the request was released, not whether the human
approved or denied it locally.

For `ovld protocol ask --wait`, there is no simultaneous terminal dialog. The
CLI subprocess is the waiter, so revision CAS is sufficient.

#### 1.6.1 Why the order cannot be reversed

A “terminal gets the first two minutes, then remote takes over” design is not a
policy we are choosing against. The mechanism forecloses it.

The remote window exists only because the hook is _still blocked_. The hook is
the sole moment at which Overlord can supply a decision, and it is a single
call/response: the adapter is invoked, it may block, and it returns exactly one
verdict. Returning “no decision” to let the terminal go first ends the hook.
Once it has ended:

- the harness draws its own dialog and blocks the session inside its TUI event
  loop;
- there is no further hook, callback, or API by which a late remote answer can
  be delivered into that dialog; and
- Overlord holds no stdio and no terminal pane (§2), so it cannot type into it
  either.

Reversal therefore does not delay the remote path, it deletes it. The two-minute
grace would be followed by an interval in which the web/mobile controls are
visible but unable to affect anything — precisely the dead end this feature
exists to remove.

The obvious workaround — return “deny” to dismiss the native dialog, then
re-request remotely — is worse. A denial is reported to the model as a refusal
and typically changes what it does next; it is not a neutral “ask again later.”

#### 1.6.2 What the terminal user actually sees during the window

They do not see a dialog they could answer. In Claude Code the TUI renders a
`running <hook> hook…` spinner for the duration; the permission prompt is drawn
only after the hook returns. So during the remote window there is nothing to
respond to locally, and the interactive cost is not “a competing prompt” but
“the session appears to stall.”

That reframes the tradeoff. The window is not remote-vs-terminal contention; it
is purely a question of _how long a present user is willing to watch a
spinner_. Two minutes is far too long for someone at the keyboard and far too
short for someone at lunch — which is exactly why a single constant is the wrong
control.

#### 1.6.3 Presence-driven window

Set the window from evidence about where the human is:

| Signal at request creation                                  | Window                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| Local input activity within the last ~60s (user is present) | Short — default 30s, then release to the terminal                    |
| No recent local activity, or no presence source available   | Long — default 30 min, bounded by the configured hook timeout        |
| A remote client opens/views the request during the window   | Extend to the long window (a human is demonstrably engaged remotely) |

Rationale for each branch:

- A present user loses at most a few seconds before their normal prompt appears,
  and gains the remote path for free when they walk away mid-run.
- For an absent user, releasing to the terminal is strictly worse than waiting:
  the native dialog blocks the agent until they return anyway, and the release
  destroys the only channel that could have unblocked it. Holding the hook costs
  nothing that was not already lost.
- View-based extension is the cheap, honest version of “the user is handling it
  remotely.” It requires no new presence source; it uses the request-read
  receipt the mobile/web client already has to send.

Presence source: Overlord Desktop can report system idle time (Electron
`powerMonitor.getSystemIdleTime()`) on its existing device heartbeat, and the
launch sentinel (§2.3) can forward it for that device. When no presence source
is available — headless targets, AgentPod, a machine with no desktop app — the
correct default is the long window, because an unattended target is the
away case by definition.

Both defaults are project-level settings, not constants, and both are bounded
above by the adapter's configured hook timeout so the harness never aborts the
hook out from under us.

#### 1.6.4 What if they do try to respond in the terminal?

Three cases, all of which must be explicit rather than emergent:

1. **They return to the keyboard during a long window.** Local activity is a
   release trigger, not just an initial input. The desktop heartbeat reporting a
   transition from idle to active causes the backend to mark the open request
   `released_to_terminal`; the adapter's next long-poll response tells it to
   return no decision, and the native prompt appears within one poll interval
   (target ≤2s). Touching the machine collapses the window. This is the direct
   answer to the reversal request: the user does get terminal-first behavior
   whenever they are actually at the terminal, without giving up the remote path
   when they are not.
2. **They press the interrupt key during the hook.** Treat this as cancellation
   of the operation, not as a local approval. The request moves to `cancelled`,
   a late remote resolution is rejected by revision CAS, and the UI shows
   `cancelled (interrupted locally)` rather than a stale open control. The exact
   harness behavior on interrupt during a blocking hook must be captured as a
   recorded fixture in Phase 0 before Phase 3 relies on it; the state machine is
   correct either way, but the observed-outcome labelling depends on what the
   harness reports.
3. **They answer the native dialog after release.** Remote controls are already
   disabled. If the harness later emits an event proving the outcome, record it
   as `resolution_observed`; if not, the request stays `released_to_terminal`
   with an unknown local outcome. Never infer the local answer.

A user who wants terminal-first unconditionally should get it as a setting —
project-level `remote_permission_window = 0` — rather than as a reversed default
that cannot deliver the second half of its promise.

### 1.7 Who may send instructions and approve tools remotely?

**Answer: separate the permissions and make remote tool approval opt-in.**

- `agent_session:message` permits answers and follow-up instructions.
- `agent_permission:resolve` permits tool approval/denial.

Remote permission resolution should be disabled by default, enabled by a
workspace policy ceiling and then per project, and initially support only
allow-once and deny. Persistent “always allow” changes harness policy and is not
portable: Claude supports permission updates, while Codex explicitly reserves
but does not currently support `updatedPermissions`.

### 1.8 Should tool calls be stored?

**Answer: metadata-only and off by default.**

Tool lifecycle events are useful for a live diagnostics view, but raw inputs and
outputs have the highest secret and volume risk. An opt-in policy may store tool
name, native call ID, lifecycle state, duration, and a bounded redacted summary.
It must not store command bodies, file contents, model output, or MCP payloads by
default.

### 1.9 Which session receives an unsolicited instruction?

**Answer: exactly one explicit session.**

There is no `session_id = null` meaning “whichever agent is live.” If a mission
has two active sessions, the caller must select one. Convenience behavior may
auto-select only when exactly one input-capable session exists.

### 1.10 How are objective-launch prompts excluded?

**Answer: explicit launch correlation, not text matching.**

The channel bootstrap records a launch kind and a launch-prompt ID. The adapter
classifies the injected objective prompt as `objective_launch`; the server does
not project it as a human `user.prompt` event. Later terminal prompts are
captured normally. Turn-number heuristics remain only a compatibility fallback.

---

## 2. Why the persistent runner is not the broker

The current runner is persistent only in the queue-claim sense:

1. `ovld runner supervise` long-polls the execution queue.
2. Any healthy runner serving the selected target may claim.
3. The winner prepares the worktree and launches a command.
4. For Terminal/iTerm, `spawnSync` waits for AppleScript to open the terminal,
   not for the coding agent to exit.
5. The launched agent later attaches, linking
   `execution_requests.launched_session_id`.

The runner therefore has neither the agent's stdio nor a durable terminal pane
handle. Keeping an in-memory `missionId → runner` routing map would be wrong in
four ways:

- a restarted runner would lose it;
- an adopted runner could win the next target-level claim;
- manual `ovld launch` sessions need the same feature without a queue runner;
  and
- virtual targets do not use the local runner at all.

`execution_requests.claimed_by_runner_registration_id` is still valuable. The
session channel copies it as launch provenance so diagnostics can say which
runner opened the session. It is never used to route an input.

### The runner's legitimate role

The runner/manual-launch path should do only three new things:

1. prepare a session channel before starting the agent;
2. export its ID and a short-lived, channel-scoped bootstrap credential; and
3. wrap the terminal invocation with a small sentinel that heartbeats while the
   agent process is alive and reports a best-effort exit.

The sentinel does not parse output and does not claim inputs. Closing the
terminal kills it; if its exit report is lost, the backend channel lease
expires. This gives honest process/channel presence without turning a runner
registration into a session address.

The sentinel heartbeat is also the natural carrier for the human-presence signal
that sizes the remote permission window (§1.6.3): when Overlord Desktop is
running on that device it can attach a coarse system idle time
(`powerMonitor.getSystemIdleTime()`), bucketed rather than exact. Presence is
advisory only — it changes how long Overlord waits before handing a decision
back to the terminal, and never changes what a decision means. Its absence is
treated as “away,” which is the safe default for headless and AgentPod targets.

---

## 3. Recommended architecture

```text
                         human REST clients
                   web / desktop / mobile / API
                              │
                 resolve request / queue input
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                  Agent Session Exchange                      │
│  channels · normalized events · requests · inbound inputs    │
│  auth · idempotency · leases · audit · entity-change feed    │
└─────────────────────────────┬────────────────────────────────┘
                              │
             protocol CLI / versioned adapter API
                              │
                 ┌────────────┴────────────┐
                 ▼                         ▼
       per-launch sentinel          connector adapter
       heartbeat + process exit     hooks / extension
                                    normalize + inject
                                               │
                                               ▼
                                     terminal coding agent
```

The exchange is one core service, not one table per harness and not one API per
event kind. Harness-specific translation stays under
`connectors/adapters/<agent>/`.

### 3.1 Session-channel bootstrap

Add an `agent_session_channels` row before the agent starts.

For a queued local launch, the backend creates it when the request transitions
to `launching` and returns a bootstrap object to the runner. For manual
`ovld launch`, the CLI calls the same service through a launch-preparation REST
route. A virtual gateway places the same scoped bootstrap material into the
realized environment.

The runner exports:

```text
OVERLORD_SESSION_CHANNEL_ID
OVERLORD_SESSION_CHANNEL_TOKEN
OVERLORD_SESSION_LAUNCH_KIND
OVERLORD_SESSION_LAUNCH_PROMPT_ID
```

The raw token is:

- short-lived and stored hash-only server-side;
- scoped to this one channel;
- allowed to create events/requests, await request resolutions, claim inputs,
  acknowledge inputs, and heartbeat;
- unable to read other mission data, resolve a human permission, or perform
  normal mission mutations.

Protocol `attach` binds the channel to the new `agent_sessions.id` in the same
transaction that links the execution request. Pre-attach events remain attached
to the channel and become session events when binding completes.

### 3.2 Channel identity and state

`agent_session_channels` is one active root channel per Overlord agent session.
Subagent IDs appear on events but are not independently steerable in the first
version.

Suggested fields:

| Field                                                      | Purpose                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `id`, workspace/project/mission/objective IDs              | Resource-derived authorization and pre-attach correlation          |
| `session_id`                                               | Nullable until protocol attach, then unique                        |
| `execution_request_id`                                     | Launch correlation when queue-launched                             |
| `execution_target_id`                                      | Target provenance, never routing for inputs                        |
| `runner_registration_id`                                   | Winning runner provenance, never routing                           |
| `agent_identifier`, `adapter_key`, `adapter_version`       | Translation owner                                                  |
| `native_session_id`                                        | Harness alias, also copied to `agent_sessions.external_session_id` |
| `capabilities_json`                                        | Effective runtime capability snapshot                              |
| `state`                                                    | `preparing`, `online`, `degraded`, `ended`, `lost`                 |
| `last_heartbeat_at`, `ended_at`, `end_reason`, `exit_code` | Presence and bounded diagnostics                                   |
| normal timestamps, soft delete, revision                   | Lifecycle and CAS                                                  |

`online` means the sentinel or a connector listener is renewing the channel
lease. It does not imply the model is actively generating. `lost` means the
lease expired without a clean end.

### 3.3 Normalized event envelope

Adapters publish `AgentSessionEventV1`:

```jsonc
{
  "schemaVersion": 1,
  "eventId": "adapter-stable-id",
  "producerSequence": 42,
  "occurredAt": "2026-07-30T06:00:00.000Z",
  "kind": "permission.requested",
  "severity": "notice",
  "actionability": "permission",
  "nativeEvent": "PermissionRequest",
  "nativeTurnId": "turn_...",
  "nativeCallId": "call_...",
  "subagentId": null,
  "correlationId": "adapter-correlation-id",
  "origin": "terminal",
  "summary": "Bash needs approval",
  "payload": {
    "toolName": "Bash",
    "safeDescription": "Run the project test command"
  }
}
```

Rules:

- Delivery is at least once. Unique
  `(channel_id, adapter_key, event_id)` makes replay idempotent.
- `producerSequence` orders one adapter producer. Arrival order is not treated
  as a perfect causal order across producers.
- Gaps are recorded and surfaced in diagnostics; they do not block later
  events.
- The adapter redacts first and the server applies a second bounded allowlist.
- Raw transcript paths may be used locally for correlation but are never sent
  or persisted.
- Unknown namespaced kinds are stored and render generically; core kinds are
  documented in the contract.
- Payload and summary sizes are bounded before persistence.
- Full tool input/output, credentials, diffs, and file contents are rejected.

Core event kinds:

| Class                   | Kinds                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| Session                 | `session.started`, `session.resumed`, `session.heartbeat`, `session.ended`, `session.lost`                    |
| User input              | `user.prompt`, `user.input_queued`, `user.input_emitted`, `user.input_acknowledged`                           |
| Requests                | `agent.question`, `permission.requested`, `permission.released_to_terminal`, `permission.resolution_observed` |
| Failure/notice          | `provider.failure`, `session.warning`, `agent.needs_input`, `agent.completed`                                 |
| Optional tool telemetry | `tool.started`, `tool.succeeded`, `tool.failed`                                                               |

The event-kind vocabulary should be open and namespaced for connector-specific
additions. The structural envelope is versioned and closed.

### 3.4 Mission timeline projection

Do not add a new `mission_events.type` for each native event. The current closed
vocabulary already supports the durable mission narrative:

| Session exchange event                 | Mission event projection |
| -------------------------------------- | ------------------------ |
| terminal `user.prompt`                 | `user_follow_up`         |
| Overlord `user.input_queued`           | `user_follow_up`         |
| `agent.question`                       | `ask`                    |
| `permission.requested`                 | `permission_request`     |
| `provider.failure` or serious warning  | `alert`                  |
| important channel lifecycle transition | `status_change`          |
| tool telemetry                         | no projection by default |

The normalized session event is the detailed source; the mission event is the
bounded notable summary. Both are written in one transaction when a projection
is required. The input row, rather than a second event, carries its later
delivery state. Objective launch prompts produce neither a `user.prompt`
projection nor a duplicate `user_follow_up`.

This avoids widening the mission event enum merely to mirror every harness
event and keeps existing push/realtime consumers compatible.

---

## 4. Answerable requests

Use one `agent_requests` model for blocking questions, permissions, structured
choices, and retry/continue decisions. It supersedes the
documented-but-unmigrated `permission_requests` table.

### 4.1 Request shape

Suggested fields:

| Field                                                   | Purpose                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| workspace/project/mission/objective/session/channel IDs | Scope                                                              |
| `source_event_id`                                       | Event that created the request                                     |
| `kind`                                                  | `question`, `permission`, `choice`, `retry`                        |
| `native_request_id`, `native_call_id`                   | Adapter correlation                                                |
| `summary`, `details_json`                               | Bounded and redacted                                               |
| `options_json`, `allows_free_text`                      | Renderable response contract                                       |
| `status`                                                | `open`, `resolved`, `released_to_terminal`, `expired`, `cancelled` |
| `resolution_json`, `resolved_by_workspace_user_id`      | Human decision and attribution                                     |
| `resolved_at`, `expires_at`, `revision`                 | CAS and lifetime                                                   |
| `window_expires_at`, `window_basis`                     | Presence-driven remote window and why it was chosen (§1.6.3)       |
| `first_viewed_at`, `released_reason`                    | View extension; `timeout`, `local_activity`, `policy`              |
| `application_state`                                     | `pending`, `emitted`, `applied`, `not_applied`, `unknown`          |
| `application_observed_at`                               | Adapter acknowledgement when available                             |

Options retain the useful ACP idea that the agent/adapter supplies stable option
IDs and the client returns only one ID:

```json
[
  { "optionId": "allow_once", "label": "Allow once", "kind": "allow_once" },
  { "optionId": "deny", "label": "Deny", "kind": "deny_once" }
]
```

Do not expose option kinds the effective adapter cannot apply. In particular,
`allow_always` is absent for Codex until its documented
`updatedPermissions` support becomes real.

### 4.2 Blocking `ask`

`ovld protocol ask --wait` remains the most portable request mechanism:

1. create the normal `ask` mission event plus an `agent_requests` row;
2. enqueue the existing `agent_question` push;
3. long-poll for a bounded interval;
4. print the resolution on stdout when answered;
5. return `waiting` so the agent can re-poll after one server hold; or
6. return `expired` and fall back to the current parked/review behavior after
   the overall deadline.

While the channel is live and waiting, the objective remains executing and the
mission remains in its execute column. The actionable request is presentation
state, not a new objective state. Only final timeout or session loss uses the
existing stop/review behavior.

This works in every harness that can run a shell command and read stdout.

### 4.3 Native permission requests

The adapter translates the normalized resolution back into the harness's exact
hook output.

For Claude and Codex today:

- allow once and deny are supported;
- no decision means fall through to the normal terminal prompt;
- the adapter's remote window is presence-driven (§1.6.3) and is always bounded
  below the harness hook timeout, so the harness never aborts the hook first;
- while blocked, the adapter long-polls, so a release triggered by local
  activity surfaces the native prompt within one poll interval rather than at
  window expiry;
- timeout, backend error, missing channel, or auth error never grants
  permission; and
- remote resolution is disabled when the request becomes
  `released_to_terminal` or `cancelled`.

If a later tool/permission event proves the decision took effect, the adapter
sets `application_state = applied`. Otherwise it remains `emitted` or
`unknown`; the UI must not infer execution.

The first implementation must not offer persistent permission updates.

---

## 5. Inbound session instructions

`agent_session_inputs` is a durable queue for user-authored instructions sent
from Overlord to one session.

Suggested fields:

| Field                                           | Purpose                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| workspace/mission/objective/session/channel IDs | Exact target                                                                    |
| `kind`                                          | `instruction`, `retry`, `continue`                                              |
| `body`                                          | Bounded user text                                                               |
| `created_by_workspace_user_id`                  | Audit actor                                                                     |
| `status`                                        | `queued`, `leased`, `emitted`, `acknowledged`, `failed`, `expired`, `cancelled` |
| `lease_id`, `lease_expires_at`                  | One adapter consumer at a time                                                  |
| `emitted_at`, `acknowledged_at`                 | Honest delivery milestones                                                      |
| `attempt_count`, `last_error_code`              | Bounded diagnostics                                                             |
| normal timestamps, soft delete, revision        | Lifecycle and CAS                                                               |

Rules:

- the session is required;
- enqueue is idempotent by a caller-supplied key;
- lease expiry permits reclaim only before `emitted`;
- after `emitted`, automatic retry is forbidden because duplicate model
  instructions are worse than an honest unknown;
- cancellation is allowed only while `queued`;
- expired/offline sessions reject new input instead of silently queueing it;
- inputs that are queued while a briefly degraded channel is still within its
  grace window show that state explicitly; and
- an injected message echoed through `UserPromptSubmit` is correlated back to
  the input row rather than recorded as a second human prompt.

“Try again” and “continue” are convenience intents, not magic backend commands.
The adapter translates them into a normal user instruction at a supported
injection boundary.

### 5.1 Injection by harness

| Harness     | Active-turn path                                     | Portable fallback                                                    | Initial capability          |
| ----------- | ---------------------------------------------------- | -------------------------------------------------------------------- | --------------------------- |
| Claude Code | `asyncRewake` command hook waiting on session inputs | `Stop` decision block; `PostToolUse` context drain                   | active-turn + turn-boundary |
| Codex       | none: async hooks are parsed but not supported       | `Stop` continuation; `PostToolUse` feedback/context at tool boundary | turn/tool-boundary          |
| Pi          | resident extension calls supported message APIs      | before-agent/turn extension events                                   | active-turn where verified  |
| Cursor      | none currently verified                              | `stop` follow-up message; tool hooks where supported                 | turn-boundary               |
| Antigravity | none currently verified                              | no injection until a stable native output contract is tested         | observe-only                |

The runtime capability snapshot, not the connector name alone, controls which
path is offered. If a harness upgrade removes a mechanism, setup/doctor and
channel registration downgrade the capability rather than letting messages
disappear.

---

## 6. Capability contract

The existing flat connector capability flags are not expressive enough. Add a
versioned `agentInteraction` block to connector conformance manifests and
snapshot its effective runtime form onto the session channel.

Illustrative shape:

```yaml
agentInteraction:
  schemaVersion: 1
  events:
    sessionLifecycle: guaranteed
    userPrompt: guaranteed
    question: protocol_only
    permissionRequest: guaranteed
    providerFailure: best_effort
    toolLifecycle: optional
  controls:
    requestReply: synchronous_wait
    permissionDecision: allow_once_deny
    inputInjection: turn_boundary
  permissionOptionKinds:
    - allow_once
    - deny_once
```

Allowed support levels are:

- `guaranteed` — a supported, installed native event with conformance tests;
- `best_effort` — known gaps or native failure modes;
- `protocol_only` — available only when the agent explicitly uses Overlord's
  protocol primitive;
- `optional` — policy-disabled by default; or
- `none`.

Setup/doctor must check:

- the installed harness version supports every claimed event/output;
- hook files are present, executable, trusted/enabled where the harness
  requires trust, and point at real protocol commands;
- channel bootstrap variables reach the agent;
- the adapter can round-trip a synthetic event without persisting secrets; and
- capability downgrades are reported, not hidden.

### 6.1 Current verified matrix

| Capability             | Claude                          | Codex                                                    | Cursor                   | Pi                                              | Antigravity              |
| ---------------------- | ------------------------------- | -------------------------------------------------------- | ------------------------ | ----------------------------------------------- | ------------------------ |
| Session start/end      | native                          | native                                                   | session hooks available  | native extension events                         | partial                  |
| Terminal user prompt   | `UserPromptSubmit`              | `UserPromptSubmit`                                       | `beforeSubmitPrompt`     | `input`                                         | `PreInvocation` mapping  |
| Permission observation | native                          | native                                                   | shell/MCP hooks          | `tool_call` gate possible                       | `PreToolUse` observation |
| Permission resolution  | allow/deny + permission updates | allow/deny; no permission updates                        | unverified               | extension can block; remote round-trip to spike | none                     |
| Provider/API failure   | typed `StopFailure`             | no documented equivalent                                 | no documented equivalent | provider/agent events to spike                  | none                     |
| Tool lifecycle         | broad native coverage           | broad local-function coverage with documented exceptions | shell/MCP/file hooks     | native                                          | partial                  |
| Active-turn input      | `asyncRewake`                   | no async hook support                                    | unverified               | extension path                                  | none                     |
| Turn-boundary input    | `Stop`                          | `Stop`                                                   | stop follow-up           | extension path                                  | unverified               |

Sources checked for this revision:

- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
- [Codex lifecycle hooks](https://learn.chatgpt.com/docs/hooks)
- [Pi extension events](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Cursor `beforeSubmitPrompt` hook](https://cursor.com/marketplace/hooks/beforesubmitprompt)
- [Cursor `beforeShellExecution` hook](https://cursor.com/marketplace/hooks/beforeshellexecution)

The implementation spike must test the installed target versions, because a
static online document is not a substitute for an adapter conformance fixture.

---

## 7. Persistence, realtime, and retention

### 7.1 Tables

Add these core tables in both SQLite and Postgres:

1. `agent_session_channels`
2. `agent_session_events`
3. `agent_requests`
4. `agent_session_inputs`

Retire the documented-but-never-migrated `hook_events` and
`permission_requests` designs in the same contract-first change. Their useful
roles are subsumed:

- sanitized hook events become normalized `agent_session_events`; and
- permissions become one kind of `agent_requests`.

There are no deployed rows to migrate, but the removal is still a contract
change and must be explicit.

### 7.2 Change feed and realtime

Every channel/request/input mutation appends `entity_changes` in the same
transaction. Event insertion appends an entity change and, when notable, the
bounded `mission_events` projection.

The existing SSE stream invalidates:

- the mission event list for notable summaries;
- the active session/channel list;
- the session event cursor;
- request state; and
- input delivery state.

Postgres may use `LISTEN/NOTIFY` as a wake hint for request waits and input
claims. SQLite uses bounded polling. As with runner claims, notifications never
replace durable rows, authorization, CAS, or leases.

### 7.3 Retention

Recommended default:

- mission event projections: existing mission-history retention;
- actionable requests and inputs: retained with the mission;
- normalized non-tool session events: 90 days, operator-configurable;
- optional tool telemetry: 7 days;
- no transcript, raw tool payload, or model stream retention.

Pruning is an explicit maintenance job and leaves request/input audit records
intact. Retention is a PM policy choice but does not change the API shape.

---

## 8. API and protocol surfaces

Names are proposed; implementation must update the contract before adding them.

### 8.1 Connector/agent protocol commands

Prefer three generic commands over one command per native hook:

| Command                         | Purpose                                     |
| ------------------------------- | ------------------------------------------- |
| `ovld protocol session-event`   | Publish one `AgentSessionEventV1` envelope  |
| `ovld protocol session-request` | Create/await/observe one normalized request |
| `ovld protocol session-input`   | Claim/emit/acknowledge an inbound input     |

`hook-event` remains a compatibility shim for existing
`UserPromptSubmit` installations and delegates to `session-event` when a channel
is available. The dead connector calls to `permission-request` are replaced by
`session-request`; do not add a permission-only subsystem simply because old
scripts guessed that command name.

`ask` gains `--wait`, `--timeout-seconds`, and structured options by delegating
to the same request service.

### 8.2 Human REST surface

| Route                                       | Purpose                                        | Permission                                                    |
| ------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| `GET /api/missions/:id/agent-sessions`      | Active/historical channel capability and state | `mission:read`                                                |
| `GET /api/agent-sessions/:id/events`        | Cursor-paginated normalized events             | `mission:read`                                                |
| `GET /api/agent-sessions/:id/requests`      | Request history/actionable requests            | `mission:read`                                                |
| `POST /api/agent-requests/:id/resolve`      | Revision-CAS response                          | `agent_session:message` or `agent_permission:resolve` by kind |
| `POST /api/agent-sessions/:id/inputs`       | Queue one session instruction                  | `agent_session:message`                                       |
| `POST /api/agent-session-inputs/:id/cancel` | Cancel a queued input                          | `agent_session:message`                                       |

### 8.3 Channel bootstrap and sentinel surface

The existing runner `launching` transition additively returns a channel
bootstrap. Manual launch uses a resource-derived session-channel preparation
route. The channel-scoped API supports:

- registration/credential exchange;
- heartbeat;
- event batch append;
- request create/wait/application acknowledgement;
- input claim/emitted/acknowledged/failed; and
- clean channel end.

This should be a versioned route family such as
`/api/agent-session-channels/v1/*`. A channel credential can access exactly one
channel. Human session/token auth cannot masquerade as an adapter, and a channel
credential cannot resolve its own permission request.

---

## 9. Security and privacy

Remote agent control is more sensitive than ordinary mission editing.

Required controls:

1. Separate message and permission-resolution RBAC permissions.
2. Workspace policy ceiling plus per-project opt-in for remote permission
   decisions.
3. Allow-once and deny only in the first release.
4. Revision CAS and immutable resolver attribution on every request.
5. Audit log entries for permission resolution, input enqueue/cancel, adapter
   application, and channel credential failure.
6. Short-lived, hash-only channel credentials scoped to one channel.
7. No credentials, raw tool inputs, question text, or command text in APNs
   payloads.
8. Adapter-side redaction plus server-side allowlists and size limits.
9. No transcript upload or private transcript-path persistence.
10. Fail toward the terminal: a remote timeout yields the native prompt, never
    an implicit allow.
11. Input injection is disabled for ended/lost channels and capability-checked
    at enqueue time.
12. Enterprise hook-trust/managed-hook policy is respected; Overlord never
    bypasses it silently.

---

## 10. Phasing

Each phase is independently testable and does not require mission widgets.

### Phase 0 — Contract and connector truth

- Update `CONTRACT.md`, `contract/components.yaml`,
  `contract/protocol-commands.yaml`, `contract/extension-points.yaml`, the
  conformance schema, and the database schema contract first.
- Replace inaccurate flat capability claims with the versioned interaction
  capability block.
- Correct existing connector scripts that invoke nonexistent commands or hook
  types.
- Make failures observable in bounded `~/.ovld/logs` diagnostics.
- Add setup/doctor checks for hook trust, executability, native version, and
  command existence.
- Record fixtures for what each harness does when the user interrupts during a
  blocking permission hook, since §1.6.4 case 2 labels the outcome from that.

**Outcome:** the shipped manifests describe reality before new behavior relies
on them.

### Phase 1 — Channels and normalized events

- Add channel/event tables and dual-dialect migrations.
- Prepare/bind a channel across queue launch, manual launch, and protocol
  attach.
- Add the launch sentinel heartbeat/exit wrapper.
- Add `session-event` and event ingestion/projection.
- Implement session lifecycle and terminal user-prompt capture for Claude and
  Codex first.
- Exclude objective-launch prompts by launch correlation.

**Outcome:** Overlord has a real-time, session-scoped event record without
transcript mirroring.

### Phase 2 — Answerable `ask`

- Add `agent_requests`.
- Implement `ask --wait` with bounded holds and overall expiry.
- Add human list/resolve REST routes and revision CAS.
- Prove Local/SQLite and Cloud/Postgres wait behavior.

**Outcome:** the existing `agent_question` push no longer leads to a dead end.

### Phase 3 — Remote permission decisions

- Implement the presence-driven remote window, view-based extension, and one-way
  terminal handoff, including early release on local activity.
- Add Claude and Codex permission translators.
- Add project opt-in, RBAC, audit, and allow-once/deny policy.
- Reconcile `application_state` from later native events where possible.
- Spike Pi and Cursor resolution semantics before declaring support.

**Outcome:** supported sessions can be approved remotely without weakening the
native terminal fallback.

### Phase 4 — Session instructions

- Add the input queue, leases, and delivery state machine.
- Add Claude `asyncRewake` as the active-turn fast path.
- Add Claude/Codex/Cursor Stop-boundary delivery.
- Implement Pi's extension-native input path.
- Add echo correlation and capability-aware enqueue validation.

**Outcome:** users can send follow-ups, retry, and continue instructions with
honest latency/delivery status.

### Phase 5 — Failures and optional tool telemetry

- Add Claude `StopFailure` normalization.
- Verify Pi provider/agent failure events.
- Report only liveness/process loss for harnesses with no typed failure event.
- Add opt-in metadata-only tool lifecycle events and retention.

**Outcome:** the session view surfaces every event the adapter can guarantee
without pretending unsupported failures were observed.

### Phase 6 — Mission widgets and mobile

Only after the contracts above stabilize:

- design an activity/session widget registry;
- render request-specific response controls;
- add a capability-aware session composer;
- add permission and failure push categories;
- add authenticated actionable mobile notifications; and
- decide whether session events live inline with mission activity or in a
  filtered subview.

This phase is intentionally a separate product-design objective.

---

## 11. Contract impact and module impact

This design extends multiple stable surfaces and cannot be implemented under
contract version 42 unchanged.

### 11.1 Required contract changes

| Change                                                     | Contract artifacts                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| Agent Session Exchange ownership and channel identity      | `CONTRACT.md`, `contract/components.yaml`                   |
| Session-channel adapter/sentinel REST surface              | `CONTRACT.md` interaction surfaces and REST ownership       |
| Generic session protocol commands and `ask` flags          | `contract/protocol-commands.yaml`                           |
| Four new core tables; retirement of two unmigrated designs | database schema contract and both dialect migrations        |
| Versioned connector interaction capability block           | extension points and conformance-manifest schema            |
| New approved native hook types used by adapters            | `contract/extension-points.yaml` where not already approved |
| New open event/request/input vocabularies                  | schema contract controlled vocabularies                     |
| New RBAC permissions                                       | RBAC config/types and schema-contract vocabulary docs       |
| Channel credential scope and audit rules                   | Auth/REST interaction contract                              |

No new `mission_events.type` is required for the proposed first version.

### 11.2 Module impact

| Module                     | Impact                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` / protocol | Channel binding, event normalization service, request/input state machines, projection, idempotency, CAS                                       |
| `backend`                  | Versioned channel API, human session/request/input REST routes, Postgres wake hints, resource-derived auth                                     |
| `database`                 | Four tables in SQLite/Postgres, generated types, conformance tests, retirement of unmigrated table specs                                       |
| `cli` / runner             | Channel preparation, scoped env, terminal sentinel wrapper, generic protocol commands; runner registration remains provenance only             |
| `connectors`               | Per-agent native event translators, request decision outputs, input injection adapters, capability manifests and fixtures                      |
| `auth`                     | Channel credential scope; `agent_session:message` and `agent_permission:resolve`; audit attribution                                            |
| `webapp`                   | Later consumer of session/event/request/input DTOs; no architecture ownership                                                                  |
| `desktop`                  | No new native logic; consumes REST like the webapp and continues to supervise the existing runner service only                                 |
| mobile sibling resource    | Later REST/actionable-notification consumer; never receives channel credentials                                                                |
| virtual gateways           | Pass channel bootstrap into the realized agent environment or implement the same versioned adapter surface; never route through a local runner |

### 11.3 Contract invariants retained

- Protocol attach/deliver remains the only agent lifecycle that completes an
  objective.
- Runner claiming remains target-level.
- Runner registrations remain non-addressable diagnostics/liveness records.
- Connectors do not write database tables directly.
- REST and protocol use the same service layer.
- Local and Cloud use the same logical API and persistence contract.
- Mobile and browser clients are never execution targets.

---

## 12. Rejected alternatives

### Put the exchange in `ovld runner supervise`

Rejected because the runner does not own the terminal session, may restart, may
not be the only runner serving the target, and does not exist for every manual
or virtual launch.

### Route messages to `claimed_by_runner_registration_id`

Rejected because contract v40/v41 explicitly makes runner instances
non-addressable. The column records who won the launch claim; it is not a
session mailbox.

### Tail Claude/Codex/Cursor transcript files

Rejected because the formats are private/unstable, capture secrets and full
model content, and cannot reliably distinguish displayed, accepted, retried,
and failed interactions.

### Proxy every agent through a PTY

Rejected for this launch mode. It would make Overlord the terminal/process host,
substantially changing failure, signal, TTY, and resume behavior. That is the
same architectural direction as adopting ACP as the primary transport and
violates the requirement to preserve the ordinary terminal interface.

### AppleScript/tmux keystroke injection

Rejected because it is platform/session-manager specific, races with the user,
has no reliable acknowledgement, and cannot read semantic outcomes.

### A mission-wide inbound queue

Rejected because missions can have multiple sessions and harnesses. A message
must not land in whichever adapter happens to poll first.

### “First answer wins” across remote and terminal

Rejected as a universal claim. Native prompts generally appear only after hooks
return, and some harnesses cannot report the eventual terminal decision. The
bounded remote window plus explicit terminal handoff is observable and honest.

### Terminal-first window, then remote (reversed order)

Rejected because it is unimplementable, not merely undesirable. Overlord can
only supply a decision while the permission hook is blocked, and letting the
terminal go first requires returning from that hook — after which the harness
draws its own dialog and there is no remaining path for a late remote answer
(§1.6.1). The reversed design would show remote controls that cannot act.

The underlying goal — a user away from the machine answering asynchronously,
without a present user being made to wait — is met instead by the presence-driven
window in §1.6.3 plus early release on local activity in §1.6.4.

### A single fixed remote window for every request

Rejected because the correct wait depends entirely on whether a human is at the
terminal. Any constant is simultaneously too long for a present user watching a
hook spinner and too short for an absent one. `remote_permission_window = 0`
remains available as an explicit terminal-first opt-out.

### One table/endpoint per native hook

Rejected because it leaks harness vocabulary into core, duplicates request
semantics, and makes every new connector a schema change.

### Design the chat/widget UI now

Rejected for this objective. A UI designed before capability and delivery-state
semantics will either promise a full transcript or label `emitted` as
`delivered`. Both are product bugs.

---

## 13. Acceptance criteria for the architecture

An implementation following this plan is complete only when:

1. two runners serving one target cannot consume or redirect each other's
   session inputs;
2. channel/session correlation survives runner restart and backend restart;
3. queued, emitted, and acknowledged input states are distinguishable;
4. objective-launch prompts never appear as human follow-ups;
5. a terminal-entered prompt is captured once with native session/turn
   correlation;
6. duplicate and out-of-order adapter events are safe and diagnosable;
7. a remote permission timeout always falls through to the terminal without
   allowing the action;
8. web/terminal permission races use explicit release semantics, and a request
   released to the terminal can never afterwards be resolved remotely;
9. local input activity during an open remote window releases the request to
   the terminal within one adapter poll interval, and a local interrupt marks
   it cancelled rather than approved;
10. precise provider failures appear only for adapters that declare and prove
    them;
11. raw transcripts, credentials, tool bodies, and file contents are absent
    from database rows, logs, realtime DTOs, and push payloads;
12. ended/lost sessions reject new instructions;
13. Local SQLite and Cloud Postgres pass equivalent service/state-machine tests;
14. connector conformance tests use recorded native fixtures for every claimed
    event and decision output;
15. setup/doctor detects missing, disabled, untrusted, stale, and unsupported
    hooks;
16. manual local, queued local, adopted AgentPod, and virtual-target launches
    all bind the same logical session-channel contract; and
17. the mission still completes only through normal protocol delivery.

---

## 14. Remaining PM policy choices

These do not block architecture or Phase 0/1:

1. **Remote permission default.** Recommendation: workspace-disabled by
   default, workspace admin enables the ceiling, project owner enables the
   project, and only allow-once/deny ship initially.
2. **Remote permission window lengths.** Recommendation: 30s when local activity
   was seen within the last 60s, 30 min otherwise, extended to the long value
   once a remote client views the request, with `0` available as an explicit
   terminal-first opt-out and every value capped below the adapter's hook
   timeout. See §1.6.3.
3. **Detailed event retention.** Recommendation: 90 days for non-tool session
   events and 7 days for optional tool metadata, with mission projections and
   request/input audit retained normally.
4. **Tool telemetry default.** Recommendation: off, with metadata-only opt-in.
5. **Input grace period on a degraded channel.** Recommendation: reject when
   already `lost`; allow a visibly queued input for up to two missed heartbeat
   intervals while `degraded`, then expire it without emission.

These defaults can be changed without moving the exchange into the runner or
altering the channel/session identity.
