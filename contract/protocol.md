# Overlord agent protocol

Part of the Overlord contract. [CONTRACT.md](CONTRACT.md) defines its scope, precedence and change protocol.

Machine-readable command names, flags and response shape versions are in
[protocol-commands.yaml](protocol-commands.yaml).

## Component Registry

### 1. Protocol Layer

**Stable identifier**: `protocol`
**Reference spec**: this document and [protocol-commands.yaml](protocol-commands.yaml); design background (non-normative): [`cli/docs/03-agent-protocol.md`](../cli/docs/03-agent-protocol.md)

Owns:

- All `ovld protocol` subcommand names and their required/optional flags
- The `packages/core/` protocol/service core source package: shared service functions, repository helpers, and generated database types used by protocol, REST, CLI tests, and database harnesses; its read-only local-target/Latch bridge type and pure-helper surface is also consumed by the Desktop Shell bridge implementation and the webapp bridge caller through their declared seam
- Session lifecycle: `attach → (update|heartbeat)* → (ask|deliver)`
- `resolveObjectiveRef`: accepts an objective UUID or `{mission.display_id}.{display_key}` public id (e.g. `coo:756.k7xm`); rejects a bare mission id and a wrong separator (`:`, `|`, `-`). Protocol `attach` accepts optional `--objective-id` (same forms). When `--objective-id` or `--execution-request-id` is present, attach pins to that objective and must not rediscover via mission state. `--mission-id` may be omitted when `--objective-id` is a full display id; an objective UUID still requires it. Unpinned attach that would have to choose among two or more equally ranked active objectives (`executing`, else `launching`, else `pending_delivery`) returns 409 `ambiguous_active_objective` instead of guessing. Session-channel bind never falls back to a mission-wide unbound channel when an objective id is known.
- Opt-in objective parallelism: `missions.allow_parallel_objectives` (default false). When true, two objectives on the same mission may execute concurrently on any resource, including the same one — the Runner Layer separates same-resource pairs with per-objective branch/worktree isolation, and a mission that runs without worktrees shares its single checkout by design. Deliver does not move the mission to `review` while any objective is still `launching` / `executing` / `pending_delivery`.
- Context assembly format returned by `attach`, including additive `displayKey` / `displayId` on `ObjectiveSummary`
- Objective context summaries returned by `attach` and `load-context` include `assignedAgent`, `model`, `reasoningEffort`, and `resourceKey` so agents can verify execution assignment
- `update-objective` accepts optional `--title` to replace or clear a custom objective title independently of instruction text; title edits are allowed in any objective state. `update-objective` and hosted MCP `overlord_update_objective` use the existing `objective:update` authorization and the shared objective service
- `create`, `prompt`, and `add-objectives` return the persisted mission/objective DTOs so callers can verify each objective's assigned agent, model, resource, and queue/auto-advance settings. CLI human-readable creation output echoes those settings; JSON and MCP responses retain their existing structured shapes.
- CLI read selector precedence: `load-context`, `read-context`, `attachment-list`
  and `attachment-download-url` inherit a launch objective only when no mission
  is explicitly selected or its display id matches the objective's parent.
  An explicit mission flag or positional mission otherwise suppresses environment
  and recovered-bootstrap objective fallback; opaque UUIDs require an explicit
  objective to pin a mission-selected read. Explicit objective/mission pairs
  retain service-layer validation. `list-deliveries` remains mission-wide and
  never inherits an objective. Reads never attach or change execution bindings;
  lifecycle and mutation fallback rules are unchanged. This CLI fallback fix
  changes no command signature, response, authorization, schema or contract
  version; Protocol/Core, REST, Auth, Database, connectors, Runner, MCP, Desktop,
  Web, Mobile, Automations and extensions require no implementation changes.
- Delivery payload structure and validation rules
- Versioned delivery-report evidence and deterministic/pending presentation in `deliveries.payload_json`, with optional asynchronous Gemini composition of `presentation` only
- Objective/session-ledger changed-file synchronization, optional update,
  delivery, and record-work declared paths, and bounded session capture
  diagnostics. Accepted changed-file and capture-diagnostic writes
  emit scoped `entity_changes` in the same transaction so the changed-file-first
  REST projection refreshes without scanning a worktree
- Idempotency key scope naming for protocol operations (`protocol.*`)
- In-place mission artifact updates via `ovld protocol update-artifact` / `POST /api/protocol/update-artifact`, which apply the same editable-field and revision rules as REST `PATCH /api/missions/:id/artifacts/:artifactId` without requiring a live session key
- Mid-turn mission artifact creation via `ovld protocol add-artifact` / `POST /api/protocol/add-artifact`, which creates an artifact without a delivery using the same `createArtifact` service as REST `POST /api/missions/:id/artifacts`; an optional session key stamps session/objective provenance when present
- Run Queue agent operations: `queue-objective`, `dequeue-objective`, `retry-queue-entry`, `run-queue`, `reorder-run-queue`, `create-run-queue`, `update-run-queue`, `delete-run-queue`, and `reorder-project-run-queues` use display-id/project resolution and the existing queue service. Hosted MCP and connector shims expose the same agent surface through `overlord_queue_objective`, `overlord_list_run_queues`, `overlord_reorder_run_queue`, and `overlord_manage_run_queue`. Entry membership, entry ordering, and entry retry require `execution_request:create`; queue-definition lifecycle requires `project:update`. `queue-objective` accepts queue, predecessor, front, and rank placement without selecting an execution target, and with no explicit destination targets the objective's own mission queue, creating it on demand before falling back to the project default
- `autoAdvance` is a deprecated compatibility view derived from live Run Queue membership. Protocol creation and update auto-advance options enqueue/dequeue; legacy storage writes retire next release and column removal requires a later contract bump
- Per-item `agent` and `model` launch selection for `create`, `prompt`, and
  `add-objectives`: the optional fields persist to the new objective's existing
  `assigned_agent` and `model` columns; `model` requires a non-empty `agent`,
  while omitted fields preserve the existing project launch-preference defaults.
  All three commands additionally accept `--objective-agent` / `--objective-model`,
  which seed only the items that name no `agent` of their own and are distinct
  from `--agent` (creation provenance, and the attaching agent on `prompt`)
- Explicit project routing for agent-created work: Protocol `create`, `prompt`,
  and `record-work` never infer a project. Normal creation requires
  `--project-id`; the non-executing `create` command may create an account-owned
  inbox item only with `--unassigned-to-project` (or compatibility alias
  `--inbox`). Hosted MCP exposes the same deliberate choice as `projectId` or
  `unassignedToProject: true`; its dedicated inbox tool is explicit by name.

Does NOT own:

- Connector installation (→ Connector Layer)
- Database schema (→ Database Layer)
- Authentication mechanism (→ Auth Layer)
- Runner queue/device/project-resource management commands (→ CLI / Runner / REST Layers)

### Protocol requirements

Command names, flags and response shapes are in
[protocol-commands.yaml](protocol-commands.yaml). These requirements apply across them.

- **Addressing.** Every subcommand that accepts `--mission-id` also accepts
  `--objective-id` (objective UUID or `{mission.display_id}.{display_key}`). An objective
  display id spells its parent mission, so `--mission-id` may be omitted whenever one is
  supplied: the client CLI derives it before sending the request, and the backend derives
  it again from the request body, because hosted MCP and direct REST callers never pass
  through the CLI. An explicit `--mission-id` always wins and must name that objective's
  own mission. An objective UUID names no mission, so `--mission-id` stays required with
  one. The CLI fills `--objective-id` in from `OVERLORD_OBJECTIVE_ID` (and the recovered
  launch bootstrap) on session-scoped subcommands; `update-objective` and
  `discuss-objective` never inherit it. Cross-mission reads do not attach, change
  objective state, update the active mission pointer or session cache, or redirect
  subsequent updates and delivery. The reference grammar lives in `@overlord/contract`
  (`parseObjectiveRef`, `formatObjectiveDisplayId`,
  `missionDisplayIdFromObjectiveRef`) and is re-exported by `@overlord/database`; no
  surface carries a private copy of it.
- **Session lifecycle.** `heartbeat` updates liveness and transient telemetry without
  creating a mission event. `ask` posts a blocking question and stops work. `deliver`
  stores the summary, artifacts, and delivery report, marks the objective complete, and
  moves the mission to review. `hook-event` records connector lifecycle events;
  `UserPromptSubmit` records follow-up user activity without requiring a live session and
  without reopening execution. `resume-follow-up` explicitly reopens a completed objective
  for post-delivery implementation follow-up, reuses that objective rather than adding a
  new one, transitions it to `pending_delivery`, and returns a new session key. A bare
  `attach` must not silently reopen a completed objective. After delivery, implementation
  work must not continue until follow-up execution is explicitly started. There is no
  `ovld protocol permission-request` subcommand; permission requests are the agent-session
  Decide capability (`ovld agent-session request`).
- **Queue work.** Runner queue, device, and project-resource operations are management
  surfaces, not part of the agent protocol. Agents never claim queue work through
  `ovld protocol`; a user-facing agent may use `launch-objective` to create the same
  execution request as the existing launch surface.
- **Attach response.** `attach` returns mission metadata; current objective metadata,
  including objective ID, instruction text, and optional `resourceKey`; all objective IDs,
  states, and optional `resourceKey` values in order; the session object with
  `sessionKey`; history/events relevant to the mission; artifacts; attachments visible to
  the active objective; shared context; `projectResources` when available; concise
  `agentInstructions`; and pending objective information when relevant. Runner-launched
  agents carry `OVERLORD_EXECUTION_REQUEST_ID` and `OVERLORD_OBJECTIVE_ID`, which the CLI
  forwards as `--execution-request-id` and `--objective-id` so the backend pins that
  objective and links `execution_requests.launched_session_id` to the created session.
  `attach` and `load-context` accept an optional `executionTargetId` so context assembly can
  resolve project resource paths for that target. `projectResources` entries are
  `{ resourceKey, label, isPrimary, isCurrent, path, state }`: `path` is absolute on the
  session's execution target when known and null when the target is unknown or has no row
  for that logical resource; `state` mirrors the latest target resource observation for
  that row, or `unknown`.
- **Update.** `update` phases are `draft`, `execute`, `review`, `deliver`, `complete`,
  `blocked`, and `cancelled` (`UPDATE_PHASES`); its event types are `update`,
  `user_follow_up`, `alert`, `discussion_summary`, and `decision` (`UPDATE_EVENT_TYPES`).
- **Changed-file tracking.** Changed-file capture is mechanical, not agent-enumerated.
  Connector callbacks append bounded metadata to an owner-only objective/session ledger;
  `update`, `changes`, and `deliver` drain it through `sync-changes`. A native edit path
  records `declared_edit` (Native) evidence only when the connector codec decodes a
  successful outcome; failed, blocked, and cancelled calls add no path, and unknown and
  partial outcomes record `outcome_unavailable` / `outcome_partial`. Shell callbacks record
  `shell_activity_unverified` and other pathless callbacks `direct_path_unavailable`;
  neither claims a path. No worktree-wide VCS delta is used as attribution. Paths an agent
  declares (shell, script, and generator outputs, deletes, and both rename endpoints that
  capture missed) are recorded as `agent_declared` (Declared) before the lifecycle request
  and never downgrade native evidence. Ledger insertion rejects absolute paths outside the
  checkout, parent traversal, symlink escapes, ignored and Overlord-managed paths, and
  oversized input; only normalized workspace-relative paths, source, observation time,
  bounded hook health, and session capture binding/callback state reach the backend.
  Changed files are upserted by objective, resolved resource, and normalized path across
  sessions; repeated observation refreshes the last observed time. There is no per-file
  explanation input: change-rationale and changed-file payload fields
  (`changeRationales`, `changedFiles`, `noFileChanges`, `skipRationaleFor`,
  `observedDirtyPaths`) are rejected with `invalid_input`. Missing paths or capture gaps
  produce bounded warnings and never reject the lifecycle transition.
  CLI `attach` sends `--capture-binding bound` only when `OVERLORD_OBJECTIVE_ID` names the
  attached objective and `unbound` when it is absent (any caller-supplied value is
  replaced). The CLI-local `ovld protocol changes --objective-id …` returns
  `LocalObjectiveChangesDto` (scope `local_objective_sessions`, this directory's ledgers,
  synced and pending rows, 200-row cap, `coverage: unavailable` when no local session
  matches) and is never sent to the backend: it drains, snapshots, then finalizes, and
  prints exactly `LocalObjectiveChangesDto`; a foreign mission/objective pair or a
  `--session-key` that is not a local session of the objective is rejected.
- **Delivery.** A summary is the only required delivery content; delivery-report
  evidence and artifacts are optional annotations. The CLI drains objective-ledger
  evidence before delivery; sync warnings, unavailable hooks, and missing paths never
  reject delivery. Each deferred-work item `{ title, change, location, doneWhen }` is
  bounded to 80, 400, 200, and 200 characters respectively (`DEFERRED_WORK_LIMITS`), and
  all four fields are required. The protocol stores a deterministic presentation
  immediately; delivery does not wait for an AI provider.
- **Record-work.** `record-work` records work already completed without an attached
  session: it creates a mission directly in review with a completed objective, stores a
  delivery summary, artifacts and the delivery report if provided, records a
  `changed_files` row with `agent_declared` provenance and no resource for every explicit
  `declaredPaths` entry, stores delivery and changed-file records without an
  `agent_sessions` row (session attribution is null), and enqueues the standard delivery
  compose job exactly as a normal `deliver` does. It accepts the whole submission as a
  single `--payload-json` / `--payload-file` envelope
  (`{ objective, summary, title, declaredPaths, artifacts, deliveryReport }`), with explicit
  flags overriding envelope fields.

## Interaction Surfaces

### Agent → Protocol (Primary Mission Surface)

- **Transport**: Subprocess CLI invocation of `ovld protocol <command>`
- **Authentication**: Session key passed as flag or environment variable
- **Required sequence**: `attach → (update|heartbeat)* → (ask|deliver)`
- **Response format**: JSON on stdout; non-zero exit on error
- **Attachment download**: objective launch context lists each attachment's authenticated HTTPS URL and an `ovld protocol attachment-download-url --attachment-id <id> --output <path>` command. The optional CLI-only `--output` flag downloads the attachment through the CLI's authenticated backend client and writes it to a new local file; it never exposes the user's token to the agent or places it in a URL. Without `--output` the URL response is unchanged; the URL alone is not a public link.
- **Advisory evidence recovery**: `sync-changes` also accepts an ended, delivered session for advisory evidence recovery. The caller still needs current workspace membership and event permission; mission, objective and resource remain pinned to that session. Deleted sessions and ended sessions without a delivery remain invalid. Recovery does not reopen the session or objective or rewrite the delivery summary or report.
- **Inbox capture**: `ovld protocol create --unassigned-to-project` (with `--inbox` retained as its compatibility alias) creates an account-owned unassigned capture. Protocol `create`, `prompt`, and `record-work` never infer a project from the current directory or other discovery: a normal mission/objective creation supplies an explicit `--project-id` (or MCP `projectId`), and only non-executing `create` may instead supply the explicit unassigned intent flag (MCP `overlord_create_mission` `unassignedToProject: true`; `overlord_create_inbox_item` is already explicit intent). `--project-id` cannot be combined with that flag. `prompt` and `record-work` cannot create inbox items, so they reject an omitted project reference.
- **Project references**: Protocol `--project-id` and MCP `projectId` accept a project UUID, slug, or name; names match case-insensitively across the caller's live memberships. Because slugs and names are unique per workspace rather than per organization, a reference matching in more than one workspace returns the structured `project_selection_required` result — `{ status, message, projectRef, projects[] }`, each project labelled with its workspace — instead of a 409, and `--workspace-id` / `workspaceId` (id, slug, or name) narrows the retry.
- **Shell-special content**: Must use `--summary-file -` / `--payload-file -` with stdin heredoc
- **Delivery evidence**: `deliver` accepts an optional versioned `deliveryReport.agentReport` object. Its `humanActions`, `tradeoffsMade`, `knownRisks`, `deferredWork`, and `assumptions` fields are advisory agent evidence, normalized to empty arrays when absent. Malformed advisory items are discarded independently with bounded warnings; evidence, change tracking, and model availability never delay delivery. Human actions must exclude Git operations and routine review/testing; the protocol applies this exclusion before persistence. Each human action carries a required `action`, expected `reason` and `category`, optional `blocking`, and optional `command`, `verify`, and `link` (HTTP(S) URL or repository-relative path only) that are preserved verbatim through normalization and composition. A human action whose `blocking` is `true` is a required follow-up step (the delivered work does not function until a person completes it), not a question the agent asked; blocking questions remain exclusively `ask` mission events. Deferred work is recommended new work outside the current mission, written by the agent as `DeferredWorkInputV1` objects (`title`, `change`, `location`, `doneWhen`); a string item, an over-long or missing field, or an unknown key is rejected with `invalid_input`. Each stored item (`DeferredWorkV1`) is the input plus a stable delivery-local `id`: `deferred-work-<index>-<digest>`, where `index` is the zero-based position in the normalized agent report and `digest` is the first 16 hex characters of the SHA-256 of the UTF-8 JSON text of `[title, change, location, doneWhen]` with each field trimmed; `contract/delivery-report-v1-fixtures.json` pins the derivation. Nothing rewrites an item: `presentation.deferredWork` is the eligible subset of the agent objects, with their ids, after dropping items that restate planned sibling objectives, leftover current-objective work, or human follow-up. The stored `deliveryReport.presentation` begins as an immediate deterministic fallback and is marked `pending` when a compose job is enqueued; a background worker may later replace only `presentation` with a Gemini-composed or `fallback` result, and in every outcome it appends the deterministic path-derived `deterministic_rule` actions (migrations, env examples, deployment configs, dependency manifests, CI workflow files) that the agent and model did not already cover; each carries the triggering path as `link` and `sourceRef` and a generic `verify` step. The original delivery summary remains immutable.

### Protocol → Database (Service Layer)

- **Transport**: Service layer function calls within ACID transactions
- **Rule**: No direct table writes from protocol handlers; use the service layer
- **Concurrency**: Optimistic compare-and-set via `revision`; zero-row update = `409` conflict
- **Change feed**: `entity_changes` appended in same transaction as domain mutation
- **Effect queue**: `enqueueWebhookEvent()` (`packages/core/service/webhook-events.ts`) appends matching `outbox_messages` rows in the same transaction as the domain mutation — a second shared-single-writer rule alongside `insertEntityChange`, called from both the protocol service core and the REST data layer so no origin path silently skips webhook delivery
- **Idempotency**: Protocol-scope idempotency keys in `idempotency_keys`
- **Execution-target provisioning**: Service functions reached from protocol lifecycle, discovery, observation, launch-settings writes, or any read may only _look up_ the acting machine's execution target; reads must tolerate `null` and writes that require one must fail with `no_execution_target_registered`. Creating a `local` `execution_targets` row is reserved for the two explicit declaration paths (`register-target` and eligible machine-local checkout linking), which are the only callers permitted to reach the declaration primitive
- **Leased-target lifecycle**: `execution_targets.lifecycle_kind = leased` is an explicit declaration-time policy for a disposable independent local target. A lease expiry only removes eligibility/reachability; it cannot itself delete links, preferences, access, or a target. Lease renewal and cleanup are compare-and-set service operations; cleanup is a durable backend worker which rechecks target revision/policy and active claims before using the normal deletion cascade.
- **Runner-instance registration**: `execution_target_runner_registrations` rows are written only by an authorized runner claim/heartbeat for an execution target that already exists, is `local`, is `active`, and is accessible to the authenticated member. Upserting a runner instance never creates, re-enables, or renames its target. Local target reachability is derived from these rows; `devices.last_seen_at` is consulted only for a target that has never had one

### Connector → Protocol (Hook Surface)

- **Hooks**: harness-native lifecycle callbacks declared by the connector descriptor
- **Transport**: Shell scripts invoking `ovld protocol hook-event` for follow-up activity or the local-only `ovld protocol capture-change` command for file evidence
- **Rule**: Hook scripts must not write to the database directly; use protocol commands only
- **Scope**: file capture requires an explicit objective identity and its attached protocol session. The working directory is only the normalization root and never selects an objective. An unbound callback performs no attribution.
- **Direct edit capture**: a post-tool callback must pass its connector key, and may append `declared_edit` evidence (source only; quality is retired in version 165) only when that connector's compiled codec normalizes the event as `file.edited` with an exact path. The CLI bounds the normalized workspace-relative path and applies `.overlordignore` before writing the owner-only objective/session ledger. Generic path-key parsing is forbidden; known read-only callbacks are silent, while mutation-capable, shell, unmapped, and no-path callbacks record bounded unavailable health and claim no path.
- **Mutation-window foundation (retired in version 165)**: the paired-window
  vocabulary (`window_observed`, quality, overlap, tool windows) has no writer and
  is removed from the wire and storage. `mutationHooks` classifications remain
  connector descriptor metadata only; no connector runs a worktree-wide delta or
  synthesizes attribution.
- **Privacy boundary**: native payloads, file contents, diffs, raw commands,
  transcript content or paths, environment values, fingerprints, and absolute
  host paths never cross this adapter surface.
- **Follow-up capture**: `UserPromptSubmit` records `user_follow_up` activity even when the original delivery ended the session; it must not reopen implementation work by itself

### Connector → CLI Agent Session Runtime → REST (Agent Session Surface)

The Connector → Protocol hook surface above carries **mission lifecycle** activity. This is a
separate, narrower surface for **session interaction** — observing what an agent is doing,
answering a decision it is blocked on, and injecting an instruction into it.

- **Transport**: a connector integration (a callback script, an in-process extension, or a
  supervised control-plane sidecar) hands the harness's **native payload** to
  `ovld agent-session <action> --agent <key> --payload-file -`. The CLI then calls the
  versioned `/api/agent-session-channels/v1/*` route family. Adapters make **zero** network
  calls; one privacy review therefore covers every connector instead of one review per connector
- **Authentication**: the CLI presents a channel-scoped, hash-stored
  `OVERLORD_SESSION_CHANNEL_TOKEN` bound to exactly one session channel — never the user's
  broad `USER_TOKEN`. A channel credential can affect only its own channel; it cannot read
  mission context, cannot resolve a human decision, and is rejected on human routes. A normal
  user or session token is rejected on the adapter route family. Credentials travel only through
  environment, stdin, or an authorization header — never argv, URLs, descriptor files, events,
  diagnostics, or crash text
- **Binding authority**: a native session id is a **correlation alias only**. Authorization and
  mission scope come from the verified channel/session credential. The working directory may
  help _locate_ an existing local binding but never creates one and never authorizes an event,
  because cwd answers "which project is this?" and every decision here is session-scoped
- **Scope gate ordering**: scope resolution runs before logging, interpreter spawn, filesystem
  write, or network access. The only permitted pre-gate operation is a bounded stdin read plus a
  native-id/channel lookup in already-known local state. An unbound session produces no request,
  no event, no database row, and no observable delay
- **Failure rule**: the harness's own behavior is the floor. Timeout, backend error, missing
  binding, auth failure, or malformed response all return _no decision_, which yields the
  harness's native prompt. No failure path may manufacture an approval, and a decision call must
  never retry with a broader credential
- **Payload reduction happens on the machine, before transmission.** Raw native payloads are
  never persisted: no transcripts or transcript paths, no raw tool input or output, no file
  contents, no environment variables. What is persisted is the native session id, a normalized
  tool name, a bounded redacted summary derived by a deterministic formatter, option ids and
  labels, timestamps, and resolver attribution. Follow-up prompt text is the one deliberate
  exception, persisted in full for bound sessions because the activity feed exists to show it
- **Capability gating**: what a surface may offer for a session is the effective capability
  snapshot on the live channel — never the static catalog, and never the agent identifier.
  Installed harness version, connector drift, project policy, and runtime probes may all
  downgrade a session below its catalog maximum
- **Human surfaces are a separate auth family.** Listing, answering, and enqueuing use ordinary
  authenticated session/token auth plus resource-derived RBAC. A channel credential can never
  present itself as a human actor, and a human credential can never impersonate an adapter
- **Answerable questions and answer delivery**: `ovld protocol ask` creates an answerable
  `agent_requests` row when the attached session has a bound channel, links its id from the
  `ask` event payload, and supports bounded structured options plus an explicit no-free-text
  choice mode. `AgentRequestDto.delivery` is the sole answerability projection: `latch` when
  a live Latch provider session on a reachable target can receive the answer, otherwise
  `read_only` with one of `no_latch_session`, `latch_session_exited`, `target_offline`, or
  `request_closed`; it also projects the application state and observation time. Human
  `POST /api/agent-requests/:id/resolve` is available only for `question` and `choice`,
  retains revision CAS and native permission/retry retirement, validates text/options
  against the request, and fails `409 request_not_deliverable` unless delivery mode is
  `latch`. Resolving a deliverable question records an `answer` mission event, returns its
  agent session to `execute`, clears the blocking-question seen marker, enqueues
  `mission.unblocked`, marks delivery `emitted`, and uses `sendLatchMessage` on the resolved
  target. Answer delivery queues it with `operationId = agent_requests.id`, which is both
  Latch's idempotency key and the row a completion post-hook records against
  (`accepted → applied`, `refused → not_applied`, `ambiguous → unknown`; a timeout leaves
  `emitted`). Feed question items additively expose `agentRequestId` and delivery mode; an
  ask with a later matching answer is no longer unseen.
