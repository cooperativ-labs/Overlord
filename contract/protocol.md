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
- Objective instructions and summaries (ADR 0059, renamed by ADR 0083): an objective has two texts. The **instructions** are the complete brief the executing agent receives; the **summary** is a short overview for people that is never sent to the agent. `create`/`prompt` take `--objective-instructions` / `--objective-instructions-file` (or positional text) and `--objective-summary` / `--objective-summary-file` for the single-objective form, and per-item `instructions` (required) and `summary` in `--objectives-json`; `add-objectives` takes the same item fields; `update-objective` takes `--instruction-text` / `--instruction-text-file`, `--summary` / `--summary-file` (empty text is Remove) and `--summary-request summarize|regenerate|retry`. The retired `--objective`, `--objective-description[-file]`, `--description[-file]`, `--description-request` and item keys `objective` / `description` are refused with 400 `invalid_input` naming the replacement. Every create and agent summary write checks for a swap and warns, never refuses: a summary at least 3 times as long as its instructions and at least 400 characters (the texts look swapped), or more than 1.5 times and at least 240 characters, or headings, numbered steps or a `Done when:` label over instructions shorter than 400 characters (they may be swapped), is stored as written with an `objective_fields_swapped` warning. Agent summary writes and summary requests are allowed only on `draft` objectives (400 `summary_not_editable`); while a person's removal is in force agent text is not stored (warning `summary_suppressed`) and agent Summarize/Regenerate is refused (409 `summary_suppressed`); only a person's Summarize or Regenerate clears removal. Responses carry advisory `warnings` (`summary_style`, `summary_suppressed`, `objective_fields_swapped`): on each matching created objective for `create`/`add-objectives`, top-level for `update-objective` and `prompt`. The summary is presentation only: `ObjectiveSummary` (attach, load-context, create results) and launch prompts never include it
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
- Run Queue agent operations: `queue-objective`, `dequeue-objective`, `retry-queue-entry`, `run-queue`, `reorder-run-queue`, `create-run-queue`, `update-run-queue`, `delete-run-queue`, and `reorder-project-run-queues` use display-id/project resolution and the existing queue service. Hosted MCP and connector shims expose the same agent surface through `overlord_queue_objective`, `overlord_list_run_queues`, `overlord_reorder_run_queue`, and `overlord_manage_run_queue`. Entry membership, entry ordering, and entry retry require `execution_request:create`; queue-definition lifecycle requires `project:update`. `queue-objective` accepts queue, predecessor, front, and rank placement without selecting an execution target, and prefers an explicit `--queue`, a predecessor's queue, or the objective's current queue first; otherwise it targets the objective's own mission queue, falls back to the project default only when the mission has no queue, and creates the mission queue on demand when neither exists
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
  inbox item only with `--unassigned-to-project` (the former `--inbox` alias is
  retired and refused with 400 `invalid_input`, ADR 0054). Hosted MCP exposes the same deliberate choice as `projectId` or
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
  `attach` must not silently reopen a completed objective, even when it is pinned by
  an objective id or a runner launch request. Resuming uses the new session key for
  subsequent work and preserves the launch request's original session binding.
  After delivery, implementation
  work must not continue until follow-up execution is explicitly started. There is no
  `ovld protocol permission-request` subcommand; permission requests are the agent-session
  Decide capability (`ovld agent-session request`).
- **Queue work.** Runner queue, device, and project-resource operations are management
  surfaces, not part of the agent protocol. Agents never claim queue work through
  `ovld protocol`; a user-facing agent may use `launch-objective` to create the same
  execution request as the existing launch surface.
- **Attach response (ADR 0069).** `attach` and `resume-follow-up` return compact execution
  context (`attach-response-v4`): mission metadata; the full current `objective`;
  `objectives: [{ displayId, state, objective }]` in mission order, excluding the current
  objective and empty-instruction slots; and `directives`, the newest 10 events of this
  objective of types `user_follow_up`, `decision`, and `discussion_summary`, newest first
  (created time descending, id descending to break ties). Filtering occurs before the limit.
  Completed sibling instruction text is capped at 600 characters including `… [truncated]`;
  other siblings retain full text and all siblings retain their real lifecycle state.
  `history`, `previousObjectives` and `futureObjectives` are absent. Full instructions
  and explicit event history remain available through `load-context --objective-id`;
  that read and ordinary `ObjectiveSummary` consumers retain their existing shape.
  The session with `sessionKey`, artifacts, current-objective attachments, shared context,
  optional `projectResources` and mission-summary editing baseline are retained.
  `agentInstructions` names the new context fields and
  is the first top-level key, states that it takes precedence over an installed Overlord
  skill or plugin, and is worded for the caller's connection method: `attach` and
  `resume-follow-up` accept an optional `--connection-method cli|mcp` (default `cli`); MCP
  servers send `mcp`, and the rules then name Overlord MCP tools and payload fields and no
  CLI command or flag. Both forms remind agents working in a writable checkout to use
  the launch-provided `OVERLORD_TMPDIR` when available under that checkout’s `.overlord/tmp/`,
  or create and use `.overlord/tmp/` at the checkout root, and to pass that directory
  explicitly to tools that default to a system temp folder. Runner-launched
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
- **Rare-case instructions.** A rule the agent needs only when a case occurs arrives in
  the response that reports the case, not in `agentInstructions`. The changes reads add
  `instruction` (how to declare missed paths) only when a capture warning needs action:
  `objective-changes` words it by an optional `--connection-method cli|mcp` (default
  `cli`; MCP servers send `mcp`), and the CLI-local `changes` read uses CLI wording.
  `deliver` returns `instruction` with the post-delivery rule worded by the session's
  connection method (CLI: `resume-follow-up` with the delivered ids; MCP: ask the user to
  start follow-up work); when the delivery's mission summary was withheld or omitted it
  leads with the `publish-delivery-summary` step in the same wording.
  A refused attach pinned to a completed objective and an `invalid_session` refusal for its
  delivered key give the same recovery guidance. A protocol session refusal is
  distinct from rejection of the CLI's login credentials.
  `mission_summary_withheld`, `mission_summary_item_skipped` and the publication errors
  state their own next step. `agentInstructions` keeps one pointer per rule.
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
  presentation compose job exactly as a normal `deliver` does (never a mission narrative
  job). It accepts the whole submission as a
  single `--payload-json` / `--payload-file` envelope
  (`{ objective, summary, title, declaredPaths, artifacts, deliveryReport, missionSummary,
  operationId }`), with explicit flags overriding envelope fields. Mission, objective,
  source report and finalization receipt commit in one transaction (ADR 0075).
- **Mission summary (ADR 0060, ADR 0076).** `attach` and `resume-follow-up` return a
  top-level `missionSummary` editing baseline for summary-enabled missions:
  `contentRevision`, `evidenceRevision`, the `narrative` freshness envelope, the current
  `headline` and `summary`, `author` (`agent`, `gemini`, `deterministic`, or null when no
  prose exists), up to 60 `openItems` (`id`, `kind`, objective display id, `text`,
  `blocking` for human actions), `totalOpenItems` and `truncated`. Blocking human actions
  precede other items; within each group newest delivery then report order applies.
  `load-context` and `connect` never carry it, and the seen marker stays operator-only.
  `deliver` and `record-work` accept an optional
  `missionSummary { baseContentRevision, baseEvidenceRevision, headline, summary,
  closeItems }` in the payload envelope or through `--mission-summary-file`; headline and
  summary travel together, and `closeItems` may travel alone. Input is validated before
  any write (400 `invalid_input`); on `deliver`, prose requires `baseContentRevision`.
  Close entries close open same-project items under ADR 0079 target authorization, with agent provenance
  and a required reason; other ids produce bounded warnings and never reject the
  delivery. Style issues come back as advisory warnings.
- **Agent-only narrative (ADR 0076).** Only agents with execution context write mission
  headline and summary; no model or deterministic composer exists, and nothing repairs
  missing prose. `mission_summaries.evidence_revision` is the narrative basis: it advances
  under the mission lock on every accepted delivery (and record-work), explicit
  `resume-follow-up`, objective reopen, and source-delivery deletion. Progress,
  heartbeats, questions, item closes or restores, and presentation rewrites never move it
  and grant no publication authority. Every accepted delivery of a summary-eligible
  mission creates one publication opportunity (`delivery_summary_publications`) bound to
  the new evidence revision, its originating member and, for `deliver`, its session; it
  supersedes older outstanding opportunities of the mission. Inline prose publishes only
  when both bases equal the pre-delivery state under the mission and summary locks.
  Otherwise (stale content, stale evidence, no evidence base from an older client, or no
  prose) the delivery and valid closes are accepted, existing text stays, and the
  opportunity remains outstanding; `missionSummary.publication { id, available,
  withheldReason }`, a fresh `baseline` and the instruction say how to publish. 409
  `mission_summary_conflict` never rejects a delivery. `record-work` keeps its new-mission
  exception: its prose publishes at creation without a base, and without prose it gets a
  sessionless opportunity bound to its originating member.
- **Delivery summary publication (ADR 0076).** `delivery-summary-context` reads one
  opportunity (`publication { available, state, supersededReason, … }`, a fresh baseline
  and an instruction); `publish-delivery-summary` publishes one reconciled narrative with
  a required caller-retained operation id and both bases. Authority is live
  authentication, current membership and project scope, `event:create`, the same
  originating member and, for a session-bound opportunity, the original session key of
  the session that delivered; that delivered, ended session is accepted for these two
  commands only (an ended undelivered or deleted session is invalid), and no other
  ended-session update, close or edit authority follows. One successful publication per
  opportunity: the same operation id and content replays (`replayed: true`); anything else
  after success is 409 `mission_summary_already_published`. Stale bases are 409
  `mission_summary_conflict` with the current baseline and consume nothing; a superseded
  opportunity is 409 `mission_summary_publication_superseded`; unknown, foreign or
  out-of-scope ids are 404 `mission_summary_publication_not_found`. There is no deadline,
  timer, expiry job or attempt limit: an opportunity valid after a month can publish after
  a month with fresh bases and current authority. Agents retry a conflict once and then
  report that the summary is not updated; they never deliver again or resume follow-up
  only to provide prose. Older clients that ignore these fields still deliver; their
  mission prose stays absent or outdated until an agent publishes.

## Interaction Surfaces

### Agent → Protocol (Primary Mission Surface)

- **Transport**: Subprocess CLI invocation of `ovld protocol <command>`
- **Authentication**: Session key passed as flag or environment variable
- **Required sequence**: `attach → (update|heartbeat)* → (ask|deliver)`
- **Response format**: JSON on stdout; non-zero exit on error
- **Attachment download**: when the current objective has attachments, attach and resume-follow-up `agentInstructions` add an Attachments section. In CLI wording it gives each attachment's `ovld protocol attachment-download-url --mission-id <id> --objective-id <id> --attachment-id <id> --output <path>` command and the `attachment-list` command for other objectives; in MCP wording it states that no Overlord MCP tool downloads them. The launch prompt does not list attachments: it carries only the mission and objective ids, the instruction not to load the Overlord skill, the execution directive and the attach command. The optional CLI-only `--output` flag downloads the attachment through the CLI's authenticated backend client and writes it to a new local file; it never exposes the user's token to the agent or places it in a URL. Without `--output` the URL response is unchanged; the URL alone is not a public link.
- **Advisory evidence recovery**: `sync-changes` also accepts an ended, delivered session for advisory evidence recovery. The caller still needs current workspace membership and event permission; mission, objective and resource remain pinned to that session. Deleted sessions and ended sessions without a delivery remain invalid. Recovery does not reopen the session or objective or rewrite the delivery summary or report.
- **Inbox capture**: `ovld protocol create --unassigned-to-project` (the `--inbox` alias is retired, ADR 0054) creates an account-owned unassigned capture. Protocol `create`, `prompt`, and `record-work` never infer a project from the current directory or other discovery: a normal mission/objective creation supplies an explicit `--project-id` (or MCP `projectId`), and only non-executing `create` may instead supply the explicit unassigned intent flag (MCP `overlord_create_mission` `unassignedToProject: true`; `overlord_create_inbox_item` is already explicit intent). `--project-id` cannot be combined with that flag. `prompt` and `record-work` cannot create inbox items, so they reject an omitted project reference.
- **Project references**: Protocol `--project-id` and MCP `projectId` accept a project UUID, slug, or name; names match case-insensitively across the caller's live memberships. Because slugs and names are unique per workspace rather than per organization, a reference matching in more than one workspace returns the structured `project_selection_required` result — `{ status, message, projectRef, projects[] }`, each project `{ id, name, slug, workspaceId, workspaceName, workspaceSlug }` — instead of a 409, and `--workspace-id` / `workspaceId` (id, slug, or name) narrows the retry.
- **Shell-special content**: Must use `--summary-file -` / `--payload-file -` with stdin heredoc
- **Delivery evidence**: `deliver` accepts an optional versioned `deliveryReport.agentReport` object. Its `humanActions`, `tradeoffsMade`, `knownRisks`, `deferredWork`, and `assumptions` fields are advisory agent evidence, normalized to empty arrays when absent. Malformed advisory items are discarded independently with bounded warnings; evidence, change tracking, and model availability never delay delivery. Human actions must exclude Git operations and routine review/testing; the protocol applies this exclusion before persistence. Each human action carries a required `action`, expected `reason` and `category`, optional `blocking`, and optional `command`, `verify`, and `link` (HTTP(S) URL or repository-relative path only) that are preserved verbatim through normalization and composition. A human action whose `blocking` is `true` is a required follow-up step (the delivered work does not function until a person completes it), not a question the agent asked; blocking questions remain exclusively `ask` mission events. Deferred work is recommended new work outside the current mission, written by the agent as `DeferredWorkInputV1` objects (`title`, `change`, `location`, `doneWhen`); a string item, an over-long or missing field, or an unknown key is rejected with `invalid_input`. Each stored item (`DeferredWorkV1`) is the input plus a stable delivery-local `id`: `deferred-work-<index>-<digest>`, where `index` is the zero-based position in the normalized agent report and `digest` is the first 16 hex characters of the SHA-256 of the UTF-8 JSON text of `[title, change, location, doneWhen]` with each field trimmed; `contract/delivery-report-v1-fixtures.json` pins the derivation. Nothing rewrites an item: `presentation.deferredWork` is the eligible subset of the agent objects, with their ids, after dropping items that restate planned sibling objectives, leftover current-objective work, or human follow-up. Known risks are likewise never rewritten: `presentation.knownRisks` is always `agentReport.knownRisks`, because a risk's mission-item identity is a digest of its text. The stored `deliveryReport.presentation` begins as an immediate deterministic fallback and is marked `pending` when a compose job is enqueued; a background worker may later replace only `presentation` with a Gemini-composed or `fallback` result, and in every outcome it appends the deterministic path-derived `deterministic_rule` actions (migrations, env examples, deployment configs, dependency manifests, CI workflow files) that the agent and model did not already cover; each carries the triggering path as `link` and `sourceRef` and a generic `verify` step. The original delivery summary remains immutable.

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
- **Transport**: Shell scripts invoking `ovld protocol hook-event` for follow-up activity or the local-only `ovld protocol capture-change` command for file evidence, or harness `mcp_tool` hooks calling a connector-bundled **local** stdio MCP server whose hook tools forward the rebuilt native payload on stdin to the same `ovld` commands (ADR 0087). A hook tool holds no logic of its own: it gates, rebuilds the payload, spawns a fixed command, and answers with that command's `hookOutput` or decision as exactly one JSON object (`{}` at minimum). Each connector declares its per-hook failure policy
- **Native hook mode**: `ovld protocol hook-event --agent <key> --payload-file -` decodes the native payload with the connector codec and prints `hookOutput`, the exact harness answer. `--hook-type Stop` is read-only and returns `deliveryStatus { needed, reason }`; the reminder is answered at most once per protocol session and objective and never when `stop_hook_active` is set. It is also not answered while the payload reports a running background task (Claude `background_tasks`): the harness wakes the agent when that work ends, and the reminder belongs to the Stop that follows (ADR 0088). A prompt the harness writes itself (Claude `<task-notification>`) is not a user follow-up and records nothing. The connector codec maps the native event to the canonical hook type, so Antigravity `PreInvocation` (`lastUserInput`) is a `UserPromptSubmit`; because it repeats before every model call, a prompt from such a per-invocation event is recorded only when it differs from the last one recorded for the conversation. The Stop answer is `{decision: "continue", reason}` for Antigravity and `{decision: "block", reason}` for Claude and Codex, and Antigravity `continuation_active` and `fullyIdle: false` skip it like `stop_hook_active` and running background tasks. `--hook-output` prints only the `hookOutput` object, for a shell hook that passes it through (ADR 0090)
- **Hook binding**: the launch environment names the mission and objective. Otherwise the **native-session index** (`<global data dir>/native-session-index/<sha256(agent \0 native session id)>`, owner-only, holding working directory, mission and objective, no secret), written by `attach`, `connect` and `resume-follow-up` when the harness exports its session id (`CLAUDE_CODE_SESSION_ID`; for Codex, when no Claude id is exported, `CODEX_SESSION_ID` or else `CODEX_THREAD_ID`, ADR 0093) or `--agent` and `--external-session-id` are given, and by the `codex-app-server` sidecar for its thread while it runs, and removed at delivery, may locate a binding for follow-up and Stop hooks. The protocol session key still comes only from the owner-only session-key cache. The index never feeds file capture, and the working directory never selects a binding. The launch environment binds only the session Overlord launched: a hooks server that detects a nested harness session (a session started from a tool of another session, which inherits its environment; Claude: an inherited `CLAUDE_PID` that is not the server's parent) uses no launch binding for follow-up, Stop or decision hooks, and may still bind through the index under the nested session's own native id. File capture keeps the launch objective, because the nested session edits the same checkout for it (ADR 0088). Subagent and fork hooks carry the parent's native session id and bind to the parent's session
- **Rule**: Hook scripts must not write to the database directly; use protocol commands only
- **Scope**: file capture requires an explicit objective identity and its attached protocol session. The working directory is only the normalization root and never selects an objective. An unbound callback performs no attribution.
- **Direct edit capture**: a post-tool callback must pass its connector key, and may append `declared_edit` evidence (source only; quality is retired in version 165) only when that connector's compiled codec normalizes the event as `file.edited` with an exact path. The CLI bounds the normalized workspace-relative path and applies `.overlordignore` before writing the owner-only objective/session ledger. Generic path-key parsing is forbidden; known read-only callbacks are silent, while mutation-capable, shell, unmapped, and no-path callbacks record bounded unavailable health and claim no path.
- **Mutation-window foundation (retired in version 165)**: the paired-window
  vocabulary (`window_observed`, quality, overlap, tool windows) has no writer and
  is removed from the wire and storage. `mutationHooks` classifications remain
  connector descriptor metadata only; no connector runs a worktree-wide delta or
  synthesizes attribution. A `paired` claim proves matching native session, call,
  workspace-root, tool, outcome, and direct-path fields in recorded pre/post payloads;
  `post-only` proves only completion-side evidence; `unsupported` records why no usable
  pair is evidenced. The descriptor generator executes these fixtures and rejects a
  classification that lacks the required proof.
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
  no event, no database row, and no observable delay. A harness-started, connector-bundled local
  hooks server process may run in an unbound session only if it does no I/O, logging, spawn or
  network call before its per-call gate (ADR 0087)
- **One surface per session**: a harness process that a control-plane supervisor drives (the
  `codex-app-server` sidecar's private `codex app-server`) is started with an allowlisted
  environment that carries no user token, channel credential, mission or objective scope, plus
  `OVERLORD_CONTROL_PLANE_SURFACE=<adapter key>`. Every Overlord callback hook exits 0 before
  reading stdin, writing or spawning when that marker is set, so a harness the supervisor
  observes and answers for is never also captured or decided through hooks (ADR 0091)
- **Control-plane answers**: a control-plane supervisor answers a harness approval only with a
  decision the harness offered for that request, never a standing grant, and closes its request
  as resolved elsewhere when the harness reports that another client answered first. When the
  channel stops honoring its credential, or the supervisor is signalled, it interrupts the
  harness's running turn before it lets go of the session (ADR 0091). It also stops when the
  channel heartbeat reports its objective `complete` or `deleted`, or its session `delivered` and
  its thread idle for 15 minutes (ADR 0092)
- **Control-plane launch**: a Codex objective launched in app-server mode (`harnessMode =
  appServer`, `OVERLORD_CODEX_APP_SERVER=1`, or that project launch env var) mints a
  `launch_kind = 'control_plane'` channel before the agent starts, stages its credential in the
  owner-only cache, starts the supervisor detached, and attaches any terminal with
  `ovld agent-session attach`; protocol attach inside the thread binds the channel by objective.
  Every other launch mints no channel. A launch that cannot use the mode falls back to the
  terminal launch with a warning (ADR 0092)
- **Failure rule**: the harness's own behavior is the floor. Timeout, backend error, missing
  binding, auth failure, or malformed response all return _no decision_, which yields the
  harness's native prompt. No failure path may manufacture an approval, and a decision call must
  never retry with a broader credential. The core still returns no decision on every internal
  failure. A connector **may** register a decision hook with harness-level fail-closed behavior
  (Claude `onFailure: "block"`) only for sessions it launched and bound; then a failure to reach
  the local hook tool denies and never approves (ADR 0087)
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
  `agent_requests` row for the attached session, opening the session's correlation-only channel
  when it has none (ADR 0065; a session whose channel already ended gets no row), links its id from the
  `ask` event payload, and supports bounded structured options plus an explicit no-free-text
  choice mode. `AgentRequestDto.delivery` is the sole answerability projection: `latch` when
  a live Latch provider session on a reachable target can receive the answer, otherwise
  `read_only` with one of `no_latch_session`, `latch_session_exited`, `target_offline`, or
  `request_closed` (a control-plane request projects as described in the next rule); it also
  projects the application state and observation time. Outside control-plane channels, human
  `POST /api/agent-requests/:id/resolve` is available only for `question` and `choice`,
  retains revision CAS and native permission/retry retirement, validates text/options
  against the request, and fails `409 request_not_deliverable` unless delivery mode is
  `latch`. Resolving a deliverable question records an `answer` mission event, returns its
  agent session to `execute`, clears the blocking-question seen marker, enqueues
  `mission.unblocked`, marks delivery `emitted`, and uses `sendLatchMessage` on the resolved
  target. Answer delivery queues it with `operationId = agent_requests.id` for the first attempt
  and `<id>.<attempt>` for a redelivery, which is both Latch's idempotency key and the row a
  completion post-hook records against (`accepted → applied`, `refused → not_applied`,
  `ambiguous → unknown`). Recording an answer and delivering it are separate facts (ADR 0065):
  `resolved: true` means recorded, and `delivery.stage` (`recorded`, `queued`, `dispatched`,
  `confirmed`, `unconfirmed`, `failed`) with `attempt`, `failureCode`, `failureMessage`,
  `canRedeliver`, `confirmationRequired` and `sessionState` reports the rest. Resolve waits at
  most about 25 seconds: a job no runner has claimed is then withdrawn and is `failed`
  (`not_dispatched`), a job a runner holds stays `dispatched` and its outcome arrives as an
  `agent_request` entity change (`changedFields: ['application_state']`, `revision` unchanged).
  A claimed job that expires without a report is `unconfirmed`, never `failed`. Every delivery
  carries a five-minute deadline. `POST /api/agent-requests/:id/redeliver` (`session:attach`)
  starts another attempt for the recorded answer under an `expectedAttempt` compare-and-set: after
  `failed` always, after `unconfirmed` only with `confirmUnconfirmed: true`, and then only after
  the runner has asked Latch for the earlier attempt's receipt. Overlord never resends on its
  own. A session last observed `exited` never receives an answer; a `lost` session on a reachable
  target is attempted and Latch's reply decides. Feed question items additively expose `agentRequestId` and delivery mode; an
  ask with a later matching answer is no longer unseen.
  A person may dismiss an open request's notification with
  `POST /api/agent-requests/:id/dismissal` and restore it with `DELETE` on the same path
  (`session:read`, ADR 0063). Dismissal is per workspace member, bound to the request
  revision, and exposed as additive `dismissed`/`dismissedAt` on human reads; it never
  changes the request, its delivery, the blocking-question seen marker, or answerability.
- **Answering control-plane requests (ADR 0094)**: a request on a `launch_kind = 'control_plane'` channel
  projects `delivery.mode = 'control_plane'` while it is open and the channel is live
  (`preparing`, `online`, `degraded`), otherwise `read_only` with `request_closed` or
  `channel_ended`. Its `question`, `choice` and `permission` requests are answered through
  `POST /api/agent-requests/:id/resolve` with no Latch delivery: the supervisor that holds the
  card's waiter lease reads the resolution through its channel credential and answers the
  harness, and `delivery.stage` stays `recorded` until it records the request's application
  (then `confirmed` for `emitted` or `applied`, `failed` for `not_applied`, `unconfirmed` for
  `unknown`). A `permission` request is answerable only by the member who created the channel
  (`agent_session_channels.created_by_workspace_user_id`, the launching member): anyone else sees
  `read_only` with `not_session_owner` and resolve answers `403 not_session_owner`. It is
  answered only with exactly `{ optionId }` or `{ decision }` naming one of its own options (stored
  as `{ optionId }`), never with text or extra fields (`400 invalid_resolution`). An ended channel answers `409 request_not_deliverable`, and
  `/redeliver` refuses every control-plane request (`409`). Session inputs remain closed for
  every channel (`POST /api/agent-session-inputs` answers `410`)

### Replay-safe finalization (ADR 0075)

`deliver` and `record-work` are finalizations: each acceptance commits, in the same
transaction as its delivery, an immutable `delivery_finalizations` receipt holding the
canonical digest of the validated semantic request and the accepted result. Receipts live
as long as their delivery; they are not request-cache entries and nothing expires them.

- **Operation id.** Both accept an optional caller-retained `operationId` (`--operation-id`
  or the envelope field; 8-128 characters of letters, digits, `.`, `_`, `:` or `-`). It is
  a non-secret reference scoped to the workspace member and operation kind, never a
  credential, and never stored in the delivery payload.
- **Digest.** The digest covers the validated semantic input: resolved scope ids, summary,
  artifacts, normalized declared paths, payload (delivery report), verification and
  follow-up text, mission summary input and, for record-work, objective, title and
  assignee. It excludes session keys and other secrets, capture diagnostics, timestamps
  and server-derived presentation. Object keys are sorted; array order is preserved.
- **Replay.** With an operation id, the service first resolves the caller's current
  membership, permission and project scope, then looks up the caller's receipt before
  requiring a live session. The same id and digest returns the stored result with
  `replayed: true` and writes nothing, also after the session ended or the objective
  completed. The same id with a different digest, mission or session answers 409
  `delivery_operation_conflict`. Revoked access, a project moved out of a token's scope or
  a deleted mission makes the replay fail like any other request; a stolen id grants nothing.
- **One finalization per session.** Under the mission lock the service rechecks scope,
  the operation receipt and the session's live, undelivered state. A session that already
  delivered answers 409 `delivery_already_accepted` with `details.deliveryId`, whether or
  not the request had an operation id and whether or not the historical delivery has a
  receipt (receipts are not backfilled). A unique index on the receipt's session is the
  storage backstop.
- **Record-work.** Before a mission exists there is nothing to lock: concurrent requests
  with the same operation id serialize on the receipt's unique index; the loser's whole
  creation (mission, objective, delivery, items) rolls back and it answers from the
  winner's receipt. Without an operation id each call creates new work: the server cannot
  tell a retry from intentionally separate identical work and never deduplicates by text.
- **Durable side effects.** Run Queue dispatch, the next-draft `awaiting_approval` event,
  the awaiting-review notification and its dispatch job, webhooks, live-activity refresh
  and the delivery-presentation compose job are written in the finalization transaction,
  each deduplicated by the accepted delivery because a replay writes nothing. A failure
  after commit cannot turn an acceptance into an apparent rejection. Queue selection and the
  rule that other active objectives keep the mission executing are unchanged.
- **Receipt read.** `delivery-receipt` (`--delivery-id` or `--operation-id` with optional
  `--operation-kind deliver|record_work`) returns `{ receipt }` to the member who
  finalized, in current scope, after session end; anything else is 404
  `delivery_receipt_not_found`. A not-found read does not prove that a concurrent attempt
  cannot commit: retry the same operation id. MCP exposes `overlord_delivery_receipt`.

**Client retry identity.** The logical attempt, not the request text, owns the id:

- The CLI persists an owner-only attempt record (operation id, kind, semantic request
  digest and addressed scope; no raw body, no session key, no token) under the Overlord
  home before sending. Re-running the same command after a timeout or restart reuses the
  pending attempt's id. `--retry-operation <id>` resumes a named attempt and refuses a
  different request body; `--new-operation` starts a new attempt, which is how
  intentionally identical `record-work` is recorded twice. An identical `record-work`
  whose attempt was already accepted is refused locally unless one of those flags says
  which is meant. `--operation-id <id>` uses a caller-retained id directly. If the attempt
  cannot be persisted, `record-work` requires an explicit `--operation-id` for the strong
  guarantee and `deliver` proceeds with a warning (the one-finalization-per-session rule
  still prevents a second delivery). The CLI never mints a new id for a retry.
- MCP `overlord_deliver_session` and `overlord_record_work` take `operationId` in typed
  input. The caller chooses it before the first invocation and reuses it on every retry
  of that attempt. An id generated inside a tool handler per invocation gives no retry
  guarantee, so the tools never generate one.
- Later narrow publication operations (planned narrative publication) follow the same
  convention: a caller-retained operation id per logical attempt, persisted before
  sending by the CLI, reused on retry, and replayed from a durable receipt.

### Durable draft report evidence (ADR 0078)

An executing agent may record provisional report evidence while it works and seal it
once at delivery. Drafts are opt-in: sessions that never write one keep the full-report
`deliver` behavior and need no extra call.

- **Ownership.** Each protocol session owns at most one draft
  (`delivery_report_drafts`), created by its first batch. Only the live, undelivered
  session, called by the workspace member who owns it, may write it (otherwise 403
  `report_draft_forbidden`). Distinct objectives and sessions have separate drafts; a
  follow-up session starts a fresh draft.
- **Batches.** `update` accepts `reportDraft { operationId, expectedRevision,
  operations }` (`--report-draft-json`, `--report-draft-file` or the `reportDraft` field
  of `--payload-json`; never stored in the event payload). `--summary` is optional with a
  batch. `operationId` (8-128 characters as for finalization) is the caller-retained batch
  identity, separate from entry ids: the caller chooses it before sending and reuses it for
  every retry of the batch; neither the CLI nor an MCP handler mints one.
  `expectedRevision` is the draft revision the batch was prepared against (0 before the
  first batch). `operations` holds 1-50 operations, at most one per entry:
  `upsert { entryId, kind, content }`, `withdraw { entryId, reason <= 280 }` or
  `import { sourceDraftId, sourceEntryId, entryId? }`. Entry ids are stable client ids
  (1-100 characters, letters, digits, `.`, `_`, `:`, `-`); an entry's kind never changes.
  Kinds are the closed set `human_action`, `tradeoff`, `known_risk`, `deferred_work`,
  `assumption`; content reuses the delivery-report input schemas and bounds, with
  `{ text }` for risks and assumptions. Unknown fields, kinds or values answer 400
  `invalid_input` before any read or write.
- **Atomicity and replay.** Under the mission lock, a batch applies all of its operations
  or none, increments the draft revision once, and writes in the same transaction an
  immutable `delivery_report_draft_batches` receipt (operation id, canonical digest of the
  batch's semantic request, result revision, attributable event id) and one ordinary
  `update` mission event whose payload carries only bounded batch metadata
  (`reportDraft { draftId, operationId, revision, upserted, withdrawn, imported }`), never
  entry text. Before the revision check and before requiring a live session, the service
  looks up the receipt: the same id and digest returns the original `eventId` and
  `reportDraft { revision, replayed: true, currentRevision }` without writing, so a lost
  response followed by later batches never overwrites them or duplicates the event; the
  same id with a different request answers 409 `report_draft_operation_conflict`. A replay
  after sealing or session end is a currently authorized receipt read and never regains
  update authority. A stale `expectedRevision` applies nothing and answers 409
  `report_draft_conflict` with `details { currentRevision, draft }`.
- **Bounds.** At most 12 active entries per kind; withdrawn entries stay readable as audit
  data and do not count. A draft retains at most 1,000 accepted batches and 1,000 distinct
  entry ids; beyond either bound new writes answer 409 `report_draft_limit_exceeded` while
  receipt replays, reads and finalization still work. Nothing is pruned, so every accepted
  batch replays for the life of the draft.
- **Inspection.** `report-draft` (`--session-key`, mission or objective scope, optional
  `--draft-id`, `--include-withdrawn`; `mission:read`) returns `{ draft, revision,
  inspection, abandoned, limits }`. For the caller's own open draft, `inspection` is the
  normalized, eligibility-filtered report `deliver` would seal now, each active entry's V1
  reference and any exclusion warnings (Git or routine-QA human actions, deferred work kept
  out of out-of-mission work). It works after session end. `--draft-id` reads an abandoned
  (session ended unsealed) or sealed draft of the same objective; another live session's
  open draft is 404 `report_draft_not_found`. MCP exposes `overlord_report_draft`.
- **Attach.** `attach` and `resume-follow-up` add an optional compact `reportDraft
  { current, abandoned }` baseline: the attaching execution's own open draft (revision,
  active and withdrawn counts) on re-attach of the same session, and up to five abandoned
  drafts of the objective. A replacement execution may import selected abandoned entries
  explicitly with `import`; it never inherits the old session's write rights and never
  seals the old draft.
- **Seal.** `deliver` takes `reportDraft { expectedRevision, operations? }`
  (`--report-draft-json|file`, the payload field, or `--expected-draft-revision <n>`). When
  the session has a draft, a missing or stale revision answers 409 `report_draft_conflict`
  before any write, so a resumed older client cannot silently ignore recorded evidence.
  Inside the finalization transaction the service applies the final operations, then
  builds the authored V1 report from the active entries in position order followed by
  `deliveryReport` items whose canonical kind and content match no active entry. Entries
  are amended or removed only through their ids, never by omission. More than 12 items of a
  kind answers 409 `report_draft_limit_exceeded`; nothing is truncated or chosen by a
  model. Normalization and eligibility are the ones shared with record-work and non-draft
  deliveries; V1 item ids and digests follow the existing position rules. Acceptance
  records each active entry's V1 reference (`sealedRef`), seals the draft and links the
  delivery; the response adds `reportDraft { draftId, revision, sealed, activeEntries,
  refs }`. A failed delivery leaves the draft open; a replayed delivery returns the
  original sealed result and cannot reseal or change it. Sealed drafts, their entries and
  batch receipts are immutable in both database editions.
- **No live meaning.** Draft entries are not `mission_items`, not delivery-local item refs,
  not human obligations and not composer input. They cannot close or supersede anything,
  never change seen state and never complete an objective. Only the accepted delivery's
  report creates items, and the existing reconciliation and supersede services own them.
  `record-work` stays sessionless and rejects `reportDraft` with 400 `invalid_input`.
- **Operator projection.** `GET /api/objectives/{id}/report-drafts` (`mission:read`)
  returns the objective's newest 20 drafts with active and withdrawn entries, read-only.
  Draft writes and seals append `delivery_report_draft` entity changes scoped to the
  objective.

### Agent mission item inspection and closure (ADR 0073)

`mission-items` and `close-items` require an attached live session key matching the
mission. Mission resolution enforces workspace and project scope. Reads require
`mission:read`; closure requires `event:create`. No new token scopes are granted.
Both accept `--mission-id` or an objective display id through `--objective-id`.

- `mission-items --limit 60 --offset 0` reads open items, including untrimmed text,
  full `detail` (suggestion `change`, `location`, `doneWhen`; action `command`, `verify`),
  source objective/delivery ids and resolution metadata. Returns `{ missionId, items,
  total, limit, offset, truncated, nextOffset }`; total counts all matching live-delivery
  open items. Limit is an integer 1..200, default 60; offset is a nonnegative integer,
  default 0. Ordering matches the baseline. Follow nextOffset until null. Paging is a
  live read: restart at zero after concurrent changes and finish inspection before closing.
- `close-items --close-items-json <array>` or `--close-items-file <path|->` accepts
  1..50 delivery close entries (`id`, `status: done|dismissed`, required reason <=280).
  Validation and skipped-entry warnings are identical to delivery; repeated calls support
  larger batches. Returns the delivery mission-summary write result, without prose or a
  lifecycle transition. Attribution is agent plus the attached objective; delivery id is
  null because no delivery is created. Each changed item emits the usual entity change.
  Ended or delivered sessions must resume follow-up before closing.

MCP exposes `overlord_mission_items` (`missionId` or `objectiveId`, `sessionKey`,
`limit`, `offset`) and `overlord_close_items` (same scope and key, `closeItems`).
Attach instructions name the read and closure by the caller's connection method.


### Cross-mission item decisions (ADR 0079)

The existing standalone close-items command and delivery/record-work
`missionSummary.closeItems` accept items of any live mission in the source project.
Entries remain `{ id, status: done|dismissed, reason }`, 1..50 per standalone call,
reason required and at most 280 characters. Invalid input is 400 `invalid_input`
before writes. Prose and its content/evidence bases concern the source mission only.
Publication accepts no closeItems.

Own entries retain their current rights. Foreign entries require mission:update
intersected with token consent; denial yields `forbidden` for those entries while own
closes and delivery proceed. Workspace/project/token-scope violations, unknown ids
and deleted sources are `not_found`. The old `other_mission` agent skip is removed.
Agents remain open-only: closed or superseded items yield `not_open` or `superseded`.
Foreign person-restored rows yield `restored_by_person`. Repeated ids yield `duplicate`.
Skipped warnings retain code `mission_summary_item_skipped` and itemId/message, adding
`problem` and, for scoped closed/restored rows, `currentStatus` and `resolvedBy`.

Results keep closedItemIds and warnings and add
`targets: [{ missionDisplayId, closed }]`, successfully closed foreign entries grouped
and sorted by mission display id. Every close records resolving mission, objective,
session when attached, and delivery when available. Standalone decisions get their
first accepted delivery link once; sessionless record-work uses its new delivery id.
Resolver reads and delivery `closedElsewhere` follow the live data projection rules
in data/README.md and OpenAPI; accepted reports and receipts stay immutable.

No item action changes the target's narrative/publication state or schedules narrative
work. Stale/missing/absent prose still accepts valid closes (ADR 0076); draft CAS and
validation failure still roll back unaccepted work (ADR 0078). Retry uncertain delivery
with the same operation id/body for the original receipt without repeat writes. Accepted
withheld prose uses fresh publication bases and its own retained publication operation
id, containing prose only. Lock order and changed-set retry are in architecture.md.

### Project item discovery (ADR 0081)

`project-items` / MCP `overlord_project_items` requires `mission:read` and a live,
undelivered attached session matching the addressed mission and optional objective.
The `project_automation` preset is denied; ADR 0076 grants no discovery authority.
Only accepted live open items in that workspace and project qualify. Draft report
observations never enter results or counts. Own-mission rows are excluded unless
`--include-own-mission` is set.

`--kind` is comma-separated (`risk,human_action,suggestion`). `--query` is a
case-insensitive substring of text and suggestion change/location/doneWhen, at
most 200 characters, never an id lookup. `--path` is comma-separated repo-relative
ranking evidence (max 200 paths, 1000 characters each), added to the objective's
live ledger. Paths reject absolute paths and dot traversal; they do not filter
out unmatched rows. Limit is 1..100 (default 20), offset non-negative (default 0).

The version-1 response and scan/paging bounds are specified in
`protocol-commands.yaml`; `total` counts filtered rows within the newest 2,000-row
scan, and `scanTruncated` signals more eligible rows outside it. `ledger.paths`
is the number of loaded ledger rows (bounded by objective-changes);
`ledger.captureGap` is true for capture warnings or a truncated ledger.
Restart pagination after concurrent writes. Read full details through an
authorized mission read; verify before closing via standalone `close-items` or
delivery `missionSummary.closeItems`. Retain the delivery operation id and
semantic body for uncertain-response replay. Accepted withheld prose uses fresh
publication bases and a separate retained publication operation id; publication
never receives closes.

Compact attach adds only `missionSummary.otherMissionOpenItems`, an exact count
of other missions' accepted live open items. Only a positive count adds discovery
guidance, in the connection method's CLI or MCP vocabulary. Lists stay out of attach.
