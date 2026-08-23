# Agent Protocol

## Goal

Port the `ovld protocol` lifecycle so every agent interacts with Overlord through one stable contract, regardless of connector or UI.

## Design Requirements

- Protocol commands are the authoritative agent interface.
- The same operation should be callable from the CLI, future web API, and future MCP surface.
- Drift between surfaces should be treated as a bug.
- Agents must attach first and deliver last.
- Protocol commands must be safe to call from shell hooks and agent runtimes.
- Protocol commands must handle special characters via `--summary-file -`, `--question-file -`, and `--payload-file -`.

## Required Protocol Commands

### Auth And Project Resolution

For MVP, auth commands can be local no-ops or diagnostics, but command names should be reserved for compatibility.

Requirements:

- `auth-status`: report local runtime readiness and whether an interactive local identity or `USER_TOKEN` is being used, without printing token secrets.
- `discover-project`: resolve project from current working directory, explicit directory, or project identifier. When `.overlord/project.json` lists multiple projects, the result is the `isPrimary` project plus additive `linkedProjects`.
- `list-organizations`: deferred until multi-user/multi-org support; can return the local instance workspace in MVP.

`USER_TOKEN` authentication is a modular expansion feature. When enabled, protocol requests may authenticate with a user-owned token that initially confers all permissions of the creating user. Future token scopes should restrict that user's permissions rather than grant additional access.

### Mission Creation And Discovery

Requirements:

- `create`: create a draft mission/objective without attaching. `--inbox`
  explicitly creates an account-owned unassigned capture; ordinary non-executing
  create uses that fallback only after explicit and discovered project resolution
  fail. `prompt` and `record-work` still require a resolved project.
  `--auto-advance` / `--no-auto-advance` map to authoritative Run Queue
  membership (default off). `--objectives-json` items may set per-objective
  `autoAdvance`; the deprecated compatibility projection is derived from live
  queue membership.
- `prompt`: create a mission and attach or queue execution immediately.
- `load-context`: read mission context without creating a session. Optional
  `--objective-id` returns that objective as the current one instead of
  rediscovering the mission's active objective — required on a mission running
  objectives in parallel, where unpinned rediscovery returns
  `ambiguous_active_objective`.
- `list-deliveries`: read one addressed mission's newest-first normalized
  `DeliveryDto[]`, including verification/follow-up text and normalized delivery
  evidence without exposing raw payload JSON.
- `launch-objective`: queue the normal execution request for an objective UUID
  or display id. It requires `--agent` and preserves the existing
  `execution_request:create` authorization, launchability, target-selection,
  sibling, and active-request idempotency rules; it does not attach the calling
  agent or claim a runner request.
- `reorder-future-objectives`: reorder a mission UUID's future objectives using the
  complete desired UUID list in `--ordered-objective-ids-json`. It retains the
  existing `objective:update` authorization and rejects duplicate, missing, or
  non-future ids while returning the full objective list.
- `run-queue`: return all live queues and entries for `--project-id` (UUID,
  slug, or name), `--objective-id`, or `--mission-id`, optionally narrowed with
  `--queue`. It is a read of delivery-driven sequencing state, not a direct
  launch command.
- `reorder-run-queue`: atomically replace one queue's complete entry order.
  Every live entry must appear exactly once; running and dispatched entries
  cannot move. It requires `execution_request:create`.
- `queue-objective`: enqueue or move an objective UUID/display id through the
  existing Run Queue service. Optional `--queue`, `--after`, `--front`, and
  one-based `--position` control placement; entries never select a target.
- `dequeue-objective`: remove an objective UUID/display id from live queue
  membership; an already-unqueued objective is an idempotent no-op.
- `create-run-queue`, `update-run-queue`, `delete-run-queue`, and
  `reorder-project-run-queues`: manage queue definitions through the existing
  Run Queue service. These are `project:update` operations and require a
  full-scope token; mission-lifecycle tokens can still perform entry operations.
- `connect`: create a lightweight session key without full context. Optional
  `--objective-id` pins the session to that objective.
- `search` (with `search-missions` retained as an alias): v1 remains compatible. `--response-version 2` returns the
  versioned cross-workspace envelope and accepts stable `--project-id` values,
  `--resource-key`, `--date-field createdAt|updatedAt|dueDatetime`, inclusive `--from`, and
  exclusive `--to`. `--response-version 3` returns `SearchResponseV3` with
  identifiable objective and delivery matches under each mission. The CLI may
  resolve a human project id/slug/name before it calls the service; REST never
  resolves project names. V2 and v3 operate only within one selected
  organization and report applied filters and truncation.
- `discuss-objective`: mark a draft objective submitted. Optional
  `--objective-id` names which draft when a mission holds more than one; the
  objective must be in `draft` state.
- `add-objectives`: append ordered objectives to a mission. Each JSON/file item
  may select its `agent` and `model` (`model` requires `agent`); omitted fields
  retain project launch-preference defaults. It uses the same `autoAdvance` JSON
  field and `--auto-advance` / `--no-auto-advance` Run Queue mapping as create.
- `update-objective`: maps `--auto-advance` / `--no-auto-advance` to queue
  membership and can edit instruction text on draft/future objectives. The
  returned `autoAdvance` field is deprecated and derived from `queueEntry`.
- `record-work`: record already-completed chat work as a review mission with completed objective and delivery record.

### Addressing A Mission Or An Objective

Every subcommand that accepts `--mission-id` also accepts `--objective-id`
(objective UUID or `{mission.display_id}.{display_key}`).

An objective **display** id spells its parent mission — `coo:756.k7xm` contains
`coo:756` — so `--mission-id` may be omitted whenever one is supplied. The
client CLI derives it before sending the request, and the backend derives it
again from the request body, because hosted MCP and direct REST callers never
pass through the CLI. An explicit `--mission-id` always wins and must name that
objective's own mission.

An objective **UUID** names no mission, so `--mission-id` stays required with
one.

```bash
ovld protocol attach --objective-id coo:756.k7xm
ovld protocol update --objective-id coo:756.k7xm --summary "..."
ovld protocol deliver --objective-id coo:756.k7xm --summary "..."
```

This is what makes reconnection work on a mission running more than one
objective: the mission id alone no longer identifies a unit of execution, and
commands that rediscover "the active objective" return
`ambiguous_active_objective` until one is named.

The CLI fills `--objective-id` in from `OVERLORD_OBJECTIVE_ID` (and the
recovered launch bootstrap) on session-scoped subcommands, so an Overlord-launched
agent rarely types it. `update-objective` and `discuss-objective` deliberately
never inherit it: on the first, the id names the row being mutated, and on the
second, the environment points at the executing objective when the command wants
a draft.

The reference grammar lives in `@overlord/contract`
(`parseObjectiveRef`, `formatObjectiveDisplayId`,
`missionDisplayIdFromObjectiveRef`) and is re-exported by `@overlord/database`;
no surface carries a private copy of it.

### Session Lifecycle

Requirements:

- `attach`: start the working session and return full context. Optional `--objective-id` (UUID or `{mission.display_id}.{display_key}`) pins the session to that objective. When `--objective-id` or `--execution-request-id` is present, attach must not rediscover another objective from mission state. `--mission-id` is required only when it cannot be derived (see [Addressing](#addressing-a-mission-or-an-objective)).
- `update`: post progress, discussion/decision events, optional change rationales, and follow-up execution transitions.
- `heartbeat`: update liveness and transient telemetry without creating a mission event.
- `ask`: post a blocking question and stop work.
- `deliver`: finish work, store artifacts/rationales, mark objective complete, and move mission to review.
- `hook-event`: record connector lifecycle events such as `UserPromptSubmit` and future `Stop`. `UserPromptSubmit` records follow-up user activity without requiring a live session and without reopening execution.
- `resume-follow-up`: explicitly reopen a completed objective for post-delivery implementation follow-up, returning a new session key.
- `permission-request`: record that an agent asked for tool permission.

### Shared Context And Attachments

Requirements:

- `read-context`: read persistent shared context.
- `write-context`: write persistent shared context.
- `add-artifact`: create a mission artifact during a turn without delivering
  (same rules as REST `POST /api/missions/:id/artifacts`). Requires `--type`,
  `--label`, and at least one of `--content-text`/`--content-text-file` or
  `--external-url`. Optional `--session-key` stamps session/objective
  provenance; optional `--objective-id` does the same when there is no live
  session, and `--session-key` wins when both are present. Delivery may still
  attach additional artifacts later.
- `update-artifact`: revise an existing mission artifact's label, Markdown
  content, and/or HTTP(S) URL in place (same rules as REST
  `PATCH /api/missions/:id/artifacts/:artifactId`). Requires
  `--expected-revision` for optimistic concurrency; does not require a session
  key so a later objective or follow-up can update an artifact created earlier.
- `attachment-list`: list visible objective attachments.
- `attachment-prepare-upload`: prepare an attachment upload.
- `attachment-finalize-upload`: finalize an uploaded attachment.
- `attachment-download-url`: get a download URL or local file path reference.
- `attachment-upload-file`: one-command local attachment upload.

For the SQLite/local MVP, attachments can use local file storage instead of signed URLs, but keep the command contract compatible.

### Runner, Device, And Project Resource Management

Runner queue/device/project-resource operations are not part of the agent
protocol. They are management surfaces:

- `ovld runner once|start|status|clear|clear-all` uses `/api/runner/*` REST
  endpoints to claim and update execution requests.
- `ovld create-project` and `ovld add-cwd` use project REST endpoints to create
  projects and register checkout paths.

Agents should treat objective execution as: attach to a mission, report progress,
ask when blocked, and deliver. They should not claim queue work through
`ovld protocol`. A user-facing PM agent may use `launch-objective` to create the
same execution request as the existing launch surface, but it still may not
claim queue work.

## Attach Response Requirements

`attach`, `connect`, and `prompt` should accept optional native session
attribution with `external-session-id`. When the flag is omitted, the CLI may
auto-detect known agent session IDs from harness environment variables or
connector hook caches and store the result in `agent_sessions.external_session_id`.
Runner-launched agents may also carry `OVERLORD_EXECUTION_REQUEST_ID` and
`OVERLORD_OBJECTIVE_ID`; the CLI forwards them as `--execution-request-id` and
`--objective-id` during `attach` so the backend pins that objective and can link
`execution_requests.launched_session_id` to the created session. When either pin
is present, attach must not rediscover another objective from mission state.
`attach` and `load-context` also accept optional `executionTargetId`; the CLI
uses it when it knows the local execution target so context assembly can resolve
project resource paths for that target. This is additive and may be omitted.

`attach` must return:

- Mission metadata.
- Current objective metadata, including objective ID, instruction text, and
  optional `resourceKey`.
- All objective IDs, states, and optional `resourceKey` values in order.
- Session object with `sessionKey`.
- History/events relevant to the mission.
- Artifacts.
- Attachments visible to the active objective.
- Shared context.
- `projectResources` when available: the project's logical resources resolved
  for the relevant execution target.
- Concise `agentInstructions` with workflow guidance and pointers to structured fields.
- Pending objective information when relevant.

`projectResources` entries have this shape:

```ts
{
  resourceKey: string;
  label: string | null;
  isPrimary: boolean;
  isCurrent: boolean;
  path: string | null;
  state: string;
}
```

`path` is absolute on the session's execution target when known, and null when
the target is unknown or has no row for that logical resource. `state` mirrors
the latest target resource observation for that row, or `unknown`.

The agent instructions should include:

- Mission ID.
- Objective ID.
- Objective title or fallback label.
- Project identifier/name.
- Where to find the objective body and related context in the structured JSON.
- Required protocol workflow instructions.
- A `Project Resources` section when the project spans multiple logical
  resources. It identifies the current resource and sibling resources available
  on the same execution target, and instructs agents to treat siblings as
  read-only context unless a future objective launches in that resource.

## Update Requirements

`update` fields:

- `session-key`
- `mission-id`
- `summary` or `summary-file`
- `phase`
- `event-type`
- `payload-json`
- `external-url`
- `external-session-id`
- `begin-follow-up-work`
- `follow-up-intent`
- `change-rationales-json` or `change-rationales-file`

Post-delivery discussion vs execution:

- Connector `UserPromptSubmit` hooks should call `hook-event` for ordinary user
  follow-up messages. This appends `user_follow_up` activity and does not change
  objective state.
- When the user explicitly asks for more implementation after delivery, agents
  should call `resume-follow-up` to create a new live session and transition the
  completed objective to `pending_delivery`.
- A bare `attach` must not silently reopen a completed objective.
- `resume-follow-up` reuses the existing completed objective rather than adding
  a new objective when the user is asking for a correction or update to the
  delivered work.

Changed-file tracking requirements:

- Changed-file capture is mechanical, not agent-enumerated. Connector callbacks append bounded
  metadata to an owner-only objective/session ledger; `update`, `changes`, and `deliver` drain it
  through `sync-changes`.
- Capture requires an explicit objective-bound session. CWD only normalizes paths and never
  selects an objective.
- A direct native edit path records `declared_edit` / `direct` evidence. Shell/no-path callbacks
  record unavailable health and claim no path. No worktree-wide VCS delta is used as attribution.
- A paired connector may record `window_observed` / `window` only after strict fixtures and the
  installed runtime prove matching pre/post semantics. No shipped connector currently does.
- Ledger insertion rejects absolute, parent-traversal, out-of-workspace, ignored, or oversized
  paths. Only normalized workspace-relative paths and bounded source, quality, overlap, window,
  and hook-health metadata reach the backend.
- Changed files are upserted by objective and normalized path across sessions. Session/resource
  fields retain last-observer provenance.
- Agents may add optional rationale annotations during update or delivery. Missing or malformed
  optional evidence produces bounded warnings and never rejects the lifecycle transition.

Supported phases:

- `draft`
- `execute`
- `review`
- `deliver`
- `complete`
- `blocked`
- `cancelled`

Supported event types:

- `update`
- `user_follow_up`
- `alert`
- `discussion_summary`
- `decision`

## Delivery Requirements

`deliver` must support:

- `summary`
- `artifacts`
- `changeRationales`
- `payload-json`
- `payload-file`
- `payload-json.deliveryReport` / `payload-file.deliveryReport` (optional versioned agent evidence)

Delivery rules:

- A summary is the only required delivery content. Rationales and delivery-report evidence are
  optional annotations.
- Do not store generic `file_changes` artifacts as a substitute for structured rationales.
- The CLI drains objective-ledger evidence before delivery. Sync warnings, unavailable hooks,
  missing paths, and missing rationales never reject delivery.
- Delivery accepts no changed-file, observed-dirty-path, no-file-change, or rationale-skip input.
- Delivery is the final review boundary, but it should not be the first time Overlord learns which files changed during the session.
- Delivery moves the active objective to `complete`.
- Delivery moves the mission to review unless another explicit status is requested later.
- Delivery may trigger auto-advance for the next objective.
- After delivery, implementation work must not continue until follow-up execution is explicitly started.
- `payload-json` / `payload-file` may include `deliveryReport: { schemaVersion: 1, agentReport }`.
  `agentReport` accepts `humanActions`, `tradeoffsMade`, `knownRisks`, `deferredWork`,
  and `assumptions`; each missing array becomes `[]`. Human actions are for concrete
  work outside the agent's completed changes and must never include Git actions or
  routine review/testing. The protocol stores a deterministic presentation immediately;
  delivery does not wait for an AI provider.

### Change Ledger Preflight

`ovld protocol changes --objective-id <display id>` synchronizes the explicitly bound
objective ledger and reports local evidence/health still pending. It does not inspect or classify
the shared worktree and it never invents rationale or skip payloads.

## Record-Work Requirements

`record-work` exists for work already completed in the current chat without an attached session.

Requirements:

- Create a mission directly in review.
- Create a completed objective.
- Store a delivery summary.
- Store artifacts and change rationales if provided.
- Record a `changed_files` row for every rationale's `filePath` plus any explicit
  `--changed-files-json` entry, so the review panel matches a normal delivery even when prose is
  omitted.
- Store delivery and changed-file records without requiring an `agent_sessions` row; session attribution is null for `record-work`.
- Enqueue the standard delivery compose job so the Gemini delivery summary runs exactly as it does for a normal `deliver`.
- Accept the whole submission as a single `--payload-json` / `--payload-file` envelope (`{ objective, summary, title, changeRationales, changedFiles, artifacts }`), with explicit flags overriding envelope fields.
- Do not use it for in-progress work.

The exact submission format is documented in the shared connector reference at
`connectors/core/overlord-mission/reference/record-work.md`.

## Acceptance Criteria

- Agents can complete the full lifecycle using only `ovld protocol`.
- `attach` gives enough context for a new agent session to continue work without reading prior chat.
- Follow-up messages from hooks are preserved as events.
- Delivery with missing required rationale fields fails with a useful error.
- Protocol payloads can be sent via stdin to avoid shell quoting failures.
- Local MVP command names remain compatible with future HTTP/MCP surfaces.
