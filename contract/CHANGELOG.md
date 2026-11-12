# Contract changelog

Every contract version is recorded here, newest first. The first `## [` heading
is the current version and must equal [VERSION](VERSION); `yarn version:contract`
writes its skeleton. Dates use ISO 8601 and describe the contract change, not
merely the files edited.

## [168.0.0] - 2026-11-12

### Changed

- The contract moved from the root `CONTRACT.md` into `contract/`: the entry
  point [CONTRACT.md](CONTRACT.md), the topic documents
  [architecture.md](architecture.md), [protocol.md](protocol.md),
  [authorization.md](authorization.md) and [conformance.md](conformance.md),
  the schema contract at [data/README.md](data/README.md) (moved from
  `database/docs/09-database-schema-contract.md`), this changelog and
  [decisions/](decisions/README.md) (ADRs 0001–0010). Specification text was
  moved without rewording; only relative links changed.
- The "Version N Change Summary" sections became the `## [N]` entries below,
  verbatim and sorted newest first.
- The rule is now that code and contract land together (ADR 0010), replacing
  "contract first".

### Version

- `168.0.0` is contract version 168 written as Semantic Versioning in the new
  [VERSION](VERSION) file (ADR 0001). Nothing on the wire, in the protocol, in
  stored data or in behaviour changed. Conformance manifests declare a strict
  Semantic Version of the same major that is not newer than `VERSION`
  (ADR 0009); the manifests in this repository were restamped to `168.0.0`.

---

> **Provenance boundary.** Every entry below this line, `## [168]` and earlier,
> is the verbatim "Version N Change Summary" from the former root `CONTRACT.md`.
> These entries are provenance and are **not normative**: where one disagrees
> with a current contract document, the current document wins
> ([CONTRACT.md](CONTRACT.md) section 3). Versions 1–94 are not retained here
> and survive only in git history; summaries for versions 98, 100 and 102 never
> existed in the file. Paths and section names inside these entries are as
> written at the time.

## [168]

Inbox item attachments (coo:1197). Profile-owned Inbox captures can carry files
before they become missions. Additive only; no existing route or field changes
meaning.

- **Database.** `attachments` gains nullable `inbox_item_id` (FK to
  `inbox_items`, `ON DELETE SET NULL`) and the partial index
  `idx_attachments_inbox_item_created` on both editions (migration
  `20261026100000_inbox_item_attachments`). An Inbox attachment keeps NOT NULL
  `workspace_id`/`storage_bucket_id` — its bytes live in the owner's storage
  workspace: the workspace of the item's earlier attachments, else the request's
  active workspace, else the owner's oldest membership granting
  `attachment:create` (409 when the owner belongs to no workspace) — with null
  project, mission, and objective.
- **REST.** `GET/POST /api/inbox/:id/attachments` and
  `DELETE /api/inbox/:id/attachments/:attachmentId` mirror the objective
  attachment routes (raw body, percent-encoded `x-upload-filename`,
  `MAX_ATTACHMENT_BYTES`; DELETE returns the remaining list) but are authorized by
  Inbox item ownership (`404` for another profile) plus `attachment:create` on
  the storage workspace for uploads. `GET /api/storage/attachments/:storageKey`
  serves an unpromoted Inbox file only to the item's owner. Workspace-scoped
  attachment service reads/writes exclude rows with `inbox_item_id`. Like Inbox
  items, Inbox-stage attachment writes emit no `entity_changes`.
- **Promotion.** `POST /api/inbox/:id/promote` re-points every active attachment
  to the created mission's first objective (sets project, mission, objective,
  clears `inbox_item_id`, bumps revision, records an `attachment` update change)
  in the same transaction that creates the mission and consumes the item. Files
  stored in another workspace are first copied into the destination workspace's
  `attachments` bucket under its canonical key; the source object is removed
  after commit, and copies are discarded if promotion fails. An attachment added
  between the copy and the transaction makes promotion return `409` (retry).
- **Deletion.** `DELETE /api/inbox/:id` and account deletion tombstone the
  capture's attachments and remove remote stored objects after commit (local
  buckets keep historical on-disk behavior, as for objective attachments).
- **Contract package.** `InboxItemDto.attachmentCount` (active files) and
  `ObjectiveAttachmentDto.inboxItemId` (null outside the Inbox) are additive.

Impact: backend, database (both editions), the contract package, and the web
Inbox fixtures change together. Mobile (OverlordMobile) and the web composer
adopt the routes in follow-up objectives; existing clients ignore the additive
fields. CLI, MCP, protocol, connectors, automations, auth, runner, and webhooks
are unchanged.

## [167]

Mission summary validation (coo:1202): `MissionSummaryRiskDto` and both arms of
`MissionSummarySuggestionDto` now include required `deliveredAt`, the original
source delivery timestamp. The operator read projects it from the delivery row;
it is not model output or persisted summary JSON. Web and iOS use this timestamp
for new-since-visit dots, even when the source is older than the capped delivery
feed or superseded in latest-per-objective evidence. Promoted suggestions remain
compact and never carry a new dot.

Impact: contract DTOs, the backend summary projection, web and mobile derivations,
and their shared fixtures change together. Database storage, core worker refs,
automations, auth, CLI, MCP, connectors, webhooks, and agent packets are unchanged.
The summary remains an operator-only surface with the existing parity exemption.

## [166]

Mission summary (coo:1202, phase 2 of
`planning/feature-plans/mission-summary-section-implementation.md`) and
agent-written structured deferred work. Single breaking cutover: no aliases,
dual acceptance, or legacy decoders.

- **Structured deferred work.** `DeliveryAgentReportInputV1.deferredWork` is
  `DeferredWorkInputV1[]` (`title` ≤ 80, `change` ≤ 400, `location` ≤ 200,
  `doneWhen` ≤ 200 characters, all required and non-blank, no other keys;
  `DEFERRED_WORK_LIMITS`). `DeliveryAgentReportV1.deferredWork` and
  `DeliveryPresentationV1.deferredWork` are `DeferredWorkV1[]`, the input plus a
  stable delivery-local `id`: `deferred-work-<index>-<digest>`, where `index` is
  the zero-based position in the normalized agent report and `digest` is the
  first 16 hex characters of the SHA-256 of the UTF-8 JSON text of `[title,
change, location, doneWhen]` with each field trimmed.
  `contract/delivery-report-v1-fixtures.json` pins the derivation. `deliver`
  and `record-work` (Protocol, CLI `--payload-json|file`, hosted and local MCP)
  reject a string item, an over-long or missing field, or an unknown key with
  `invalid_input`; there is no string compatibility.
- **The deferred-work rewrite is reversed.** The Version 139 rule (coo:986) that the
  compose-delivery automation rewrites each deferred-work item as a standalone
  objective statement (and may add items) is withdrawn. The composer no longer
  receives deferred work, and its response schema has no `deferredWork`.
  `presentation.deferredWork` is the eligible subset of the agent items,
  verbatim and with the agent ids: `filterDeferredWork` still drops items that
  restate planned objectives or human follow-up, comparing `title` + `change`,
  and never edits an item. The index-marked composed id is retired.
- **`DeliveryDeferredWorkItemDto`** is `{ actionId, title, change, location,
doneWhen, resolution }`; `action` is removed. `actionId` equals the item's
  `DeferredWorkV1.id`. The deferred-work resolution routes keep their paths,
  bodies, and authorization. Promotion through `POST /api/objectives` or `POST
/api/missions` uses `title` as the title and, as the instruction, `change`, a
  blank line, `Location: {location}`, a blank line, `Done when: {doneWhen}`.
- **Historical deferred work is dropped.** Migrations in both editions clear
  historical `agentReport.deferredWork` and `presentation.deferredWork` arrays,
  delete their `human_action_resolutions` rows, preserve every other report
  field and delivery, and refresh the affected delivery search documents. Old
  ids are not remapped and the legacy presentation-text id match is removed.
- **`mission.delivered` webhook payload.** The full envelope's `delivery.report`
  carries the new `deferredWork` object shape in both `agentReport` and
  `presentation`. Thin envelopes are unchanged. Webhook consumers that read
  deferred work must move to the object shape.
- **Mission summary eligibility.** `missions.summary_enabled` (Bool, NOT NULL,
  default true) is set false for every mission that exists at migration time.
  Every creation path after the cutover (REST, Protocol `create` / `prompt`,
  `record-work`, MCP, inbox promotion, scheduled duplicates) is eligible through
  the column default without per-path code. Ineligible missions get no summary
  row and no compose job, now or later. Clients learn eligibility only from the
  summary read envelope; `MissionDto` and `MissionDetailDto` do not change.
- **Storage.** `mission_summaries` (one row per eligible mission, replaced in
  place: `revision`, `requested_generation`, `completed_generation`, `status`
  `pending | composed | fallback`, `headline`, `summary_markdown`, `risks_json`,
  `suggestions_json` as references only, `source_delivery_id`, `generated_by`,
  `generated_at`, `model`) and `mission_summary_seen` (one row per mission and
  workspace user). Writing a summary row appends `entity_changes` with
  `entity_type = mission_summary` (open vocabulary), `entity_id` = the mission
  id, and the mission id set. A seen write appends no entity change.
- **Compose job.** `worker_jobs` gains core type
  `overlord.mission.summary.compose.v1` with payload `{ missionId }`. Each
  trigger increments `requested_generation`, sets `pending`, bumps the revision,
  and emits the entity change in the transaction of the write it follows,
  keeping prior content. Triggers: a delivery presentation persisted as
  `composed` or `fallback`; a deferred-work resolution create or delete; an
  agent request of kind `question` or `choice` on creation and on every
  transition out of `open`; an objective reopening. Publication is guarded by
  the captured generation, so a trigger during generation causes a fresh pass.
- **REST.** `GET /api/missions/:id/summary` (mission read authorization)
  returns `MissionSummaryResponse`: `{ eligible: false, summary: null,
evidence: null, watermark: null, seenAt: null }` for an ineligible mission,
  else `{ eligible: true, summary: MissionSummaryDto | null, evidence:
MissionSummaryEvidenceDto, watermark, seenAt }`. Evidence (latest current-run
  delivery per objective, its human actions, and source rows, deleted
  objectives included) is selected in the database before any limit, capped at
  `MISSION_SUMMARY_EVIDENCE_LIMIT` with pre-cap `totals` and `truncated` flags.
  Suggestions are projected at read time from the source delivery's deferred
  work and resolution: open items carry every field, promoted items only
  identity, title, and resolution, dismissed items and items whose delivery is
  no longer current-run are omitted. `watermark` is the newest `deliveredAt` of
  the current-run deliveries the response draws on or `createdAt` of an open
  `question` or `choice` request. `PUT /api/missions/:id/summary/seen` takes
  `{ watermark }`, rejects a value later than the caller's current evidence
  maximum or any value on an ineligible mission with `invalid_input`, stores
  `max(existing, watermark)` per workspace user, and returns `{ seenAt }`. The
  evidence maximum is the newest `delivered_at` of any live delivery or
  `created_at` of any `question` or `choice` request of the mission, whatever
  its status, so answering a request or reopening an objective after the read
  cannot reject the acknowledgement of evidence that was displayed.
- **Operator surface only; MCP parity exemption.** The summary, its evidence,
  and the seen marker are never sent to agents. `load-context`, the attach
  mission packet, hosted and local MCP tools, and CLI protocol commands do not
  expose them, now or later. The two routes are exempt from the REST/MCP parity
  that PM-management surfaces otherwise follow (Version 101).

Module impacts: Contract (this bump: DTOs, fixtures). Database (both
migrations, Kysely types). Protocol/Core (strict deferred-work schemas, id
derivation, compose job, triggers, read projection). REST (two routes, the
resolution DTO shape). Automations (delivery composer loses deferred work,
writing rules; new mission-summary composer). CLI and MCP (payload validation,
catalog, connector and shared-skill guidance). Webhooks (payload shape). Web,
Desktop, and Mobile (structured deferred work, summary section). Runner and
Auth are unaffected.

Status: contract only (coo:1202.y02v). Storage, routes, the deferred-work data
cutover, composer, worker, connectors, and clients land in the later objectives
of coo:1202; nothing here ships the feature.

## [165]

Breaking cutover for objective change tracking (coo:1199; single user, no
aliases, dual writes, or compatibility DTOs). A delivery explains the outcome
and rationale in its summary; **Files changed during this objective** is a
separate compact, cumulative list grouped by resource. Per-file rationale,
VCS status, current-diff state, and window/quality/overlap metadata are removed.

- **`FileChangeDto`** is exactly `id`, `missionId`, `objectiveId`,
  `resourceKey | null`, `filePath`, `source`, `observedAt`, `hookHealth | null`.
  `createdAt` is renamed `observedAt` (last observation). `source` is
  `declared_edit` (at least one successful native observation), `agent_declared`
  (declaration only), or `null` (historical provenance unknown — shown as
  Unknown, never relabelled native). Clients derive the basename. The list is
  not a Git diff, a delivery snapshot, proof of exclusive ownership, or proof
  that every edit was captured.
- **Identity** is one row per objective + session-resolved resource + normalized
  path (`idx_changed_files_active_objective_resource_path`). The resource comes
  from the authorized session, never a caller claim; sessionless `record-work`
  declarations use a null resource. Equal relative paths in different resources
  are distinct; two objectives may each associate the same physical path. Native
  evidence is never downgraded by a later declaration; a repeated observation
  extends first/last observation times and replays of an idempotency key are
  ignored. `sync-changes` accepts only `filePath`, `idempotencyKey`, `source`
  (`declared_edit | agent_declared`), `observedAt`, `hookHealth`; `quality`,
  `overlap`, `toolWindowId`, and `window_observed` are rejected per item.
- **Declared paths.** `update`, `deliver`, and sessionless `record-work` accept
  `declaredPaths` (`--declared-paths-json|file`): bounded canonical path strings,
  stored `agent_declared` and never gating the operation. Deleted/renamed targets
  are valid. `changeRationales`/`--change-rationales-*` and `changedFiles`
  (`vcsStatus`)/`--changed-files-*` are retired and rejected with `invalid_input`.
- **Capture diagnostics** are persisted on the session
  (`agent_sessions.capture_binding_state | capture_callback_observed_at |
capture_health_json`): `bound | unbound | unknown` binding (configuration
  evidence only, set by `attach --capture-binding` or `sync-changes` capture
  input), the earliest accepted callback (even a harmless read), and bounded
  per-code first/last health aggregates. Known gap codes
  (`CAPTURE_GAP_CODES`) are sticky. Writes are authorized by the session key,
  idempotent, and emit an `agent_session` entity change in the same transaction.
  Objective warnings (`CaptureWarningCode`) are derived across all sessions so a
  newer healthy session never hides an earlier gap.
- **Two distinct reads, no collision.** CLI-local `ovld protocol changes
--objective-id …` returns `LocalObjectiveChangesDto` (scope
  `local_objective_sessions`, this directory's ledgers, synced and pending rows,
  200-row cap, `coverage: unavailable` when no local session matches). It is
  never sent to the backend. The server read is Protocol `objective-changes`
  (`POST /api/protocol/objective-changes`), hosted MCP `overlord_changes`, and
  REST `GET /api/missions/:id/file-changes?objectiveId=`, returning
  `ObjectiveFileChangesDto` (scope `server_objective`, `{ items, total, limit,
truncated, capture }`). The objective is validated against the addressed
  mission before SQL and filters before count and limit. It needs no attach and
  cannot see unsynchronized local evidence. `objective-changes` is a mission-read
  Protocol subcommand on the `project_automation` allowlist alongside
  `list-deliveries`; REST `file-changes` without `objectiveId` keeps the
  mission-wide `MissionFileChangesDto` page, which clients must never partition
  by objective. A blank or repeated `objectiveId` is rejected with 400.
- **MCP parity.** Hosted `overlord_changes` and the generated local shim forward
  to Protocol `objective-changes` (the local shim through the CLI passthrough of
  the same backend subcommand, never the CLI-local `changes` read).
  `overlord_update_session`, `overlord_deliver_session`, and
  `overlord_record_work` accept `declaredPaths` (string array, `agent_declared`)
  and no longer publish `changeRationales` or `changedFiles`.
- **Storage.** Migrations `20261024120000_changed_files_resource_provenance`
  (SQLite and PostgreSQL) add `changed_files.source|hook_health|sync_keys_json`,
  drop `vcs_status|current_diff_state|observed_metadata_json`, drop
  `change_rationales`, and add the session capture columns. Provenance is mapped
  only where reliable (latest native observation → `declared_edit`; a single
  generator declaration or sessionless record-work → `agent_declared`;
  everything else, including window evidence, → `null`). Historical migrations
  are unchanged.
- **Webhook envelope** drops `changeRationales`; `changedFiles` items become
  `{ filePath, resourceKey, source }`. Delivery composition no longer reads
  rationale rows.

- **CLI ledger and local read (coo:1199.tndc).** The objective/session ledger is
  schema v3: rows carry only `idempotencyKey`, `filePath`, `source`
  (`declared_edit | agent_declared`), `observedAt`, `hookHealth`, `syncedAt`,
  plus per-session `capture` (`bindingState`, `callbackObservedAt`). A v2 ledger
  is upgraded once under the ledger lock: idempotency keys and sync markers are
  kept, the v2 generator-declaration marker becomes `agent_declared`, and window
  rows are dropped (never promoted) with `legacy_window_evidence_discarded:<n>`
  health. `update`/`deliver` `--paths` (comma list) and `--paths-file` (JSON
  string array) append `agent_declared` rows normalized against the session
  checkout before the drain; rejected paths are reported on stderr and never
  block. Local binding/storage failure must not reject explicit declarations:
  the CLI can normalize them in memory and submit `agent_declared` batches via
  the existing authenticated `sync-changes` surface, whose session determines
  objective and resource. It reports failures without blocking delivery. Local
  binding retention limits apply per objective, not to the lifetime number of
  objectives in a checkout; manifests remain byte-bounded. Under retention or
  byte pressure, attach prunes oldest delivered retry bindings only after their
  ledgers can be removed without losing unsynchronized evidence. Live bindings
  for other objectives and unsynchronized retries are retained; exhausted storage
  produces an explicit warning rather than a silent capture failure. Attach and local
  changes reads diagnose unavailable binding/storage on stderr; unavailable
  reads include `unknown_binding` and a diagnostic health code in the existing
  fields. This CLI repair changes no stable interface or contract version;
  backend, database, connectors, and other clients are unchanged.
  CLI `attach` sends `--capture-binding bound` only when
  `OVERLORD_OBJECTIVE_ID` names the attached objective and `unbound` when it is
  absent (any caller-supplied value is replaced); differently spelled ids are
  resolved against the attach response locally and synced as capture input. The
  first accepted scoped callback (including a harmless read) is recorded
  separately from edit evidence. Capture diagnostics travel once per drain via
  `sync-changes --capture-json` when changed. `ovld protocol changes` drains,
  snapshots, then finalizes, and prints exactly `LocalObjectiveChangesDto`; a
  foreign mission/objective pair or a `--session-key` that is not a local
  session of the objective is rejected. Top-level `ovld changes status
--objective-id` uses REST `file-changes?objectiveId=` (server filters before the
  cap); `ovld changes rationales`, `ovld mission rationales` (now `ovld mission
file-changes`), and the `rationales` JSON alias are removed, and
  `--change-rationales-*`/`--changed-files-*` are rejected client-side on
  `update`, `deliver`, and `record-work`.

- **Connector outcome gating (coo:1199.1cqh).** The codec dialect gains
  `outcomeExitCodePrefix` (decode a leading `<prefix><n>` line of a text result;
  0 → `ok`, else `error`), numeric `outcomePath` values (exit codes), and
  `successOnly: true` (a fixture- and source-backed guarantee that the harness
  emits the event only for successful calls; seals `ok` when nothing was
  decoded). Absent or unrecognized results stay unknown, never success. Patch
  extraction also reduces `*** Move to:` headers, so renames keep both
  endpoints. `capture-change` appends native `declared_edit` evidence only for a
  `file.edited` event whose outcome is `ok`; `blocked` appends nothing,
  `error`/`cancelled` record `outcome_partial`, unknown records
  `outcome_unavailable`, shell records `shell_activity_unverified`, and other
  no-path callbacks record `direct_path_unavailable`. Every scoped callback,
  including a harmless read, still records callback observation. The local
  ledger evicts non-gap health before any `CAPTURE_GAP_CODES` entry. Adapter
  declarations: Claude `PostToolUse` and Cursor `postToolUse` are `successOnly`
  (failures go to the unregistered `PostToolUseFailure`/`postToolUseFailure`);
  Codex `PostToolUse` decodes `tool_response` via `Exit code: `. OpenCode keeps
  its status mapping and registers no capture; Pi and Antigravity register no
  capture. No raw payload, tool output, or patch text is persisted.

- **Delivery composition and report provenance (coo:1199.j1qg).**
  `DeliveryEvidenceSource` is `agent | deterministic_rule`; `change_rationale`
  is retired from `HumanActionV1.source`, and `TradeoffMadeV1.source` is only
  `agent`. The compose worker and `compose-delivery` automation input carry no
  per-file prose: the model receives the agent summary, report facts, objective
  context, recent events, and deterministic candidate actions (whose `link` /
  `sourceRef` may name a path). Its instruction forbids describing files or
  inferring behavior, impact, tests, or verification from a path name, and
  tradeoffs may cite only agent tradeoff ids. Raw-summary fallback and
  path-derived `deterministic_rule` actions are unchanged. Migration
  `20261024130000_delivery_reports_retire_change_rationale` (SQLite and
  PostgreSQL) removes persisted presentation items whose provenance was
  `change_rationale`, so historical reports keep parsing under the strict
  read schema; legacy top-level payload keys such as `changeRationales` remain
  inert, never-read history. Pending compose jobs need no migration: a job
  carries only its delivery id and rereads the migrated report.
- **Agent guidance.** Attach `agentInstructions`, the shared
  `overlord-mission` skill (0.7.0), CLI help, and docs tell agents to read the
  captured evidence once, declare only known shell/script/generator outputs,
  deletes, and both rename endpoints that capture missed, and summarize by
  behavior or component. There is no exhaustive enumeration gate and no
  shared-worktree diff. Delivery-time snapshots are deferred; every list is
  labelled cumulative.

`sync-changes` also accepts an ended, delivered session for advisory evidence
recovery. The authenticated caller still needs current workspace membership and
event permission; mission, objective and resource remain pinned to that session.
Deleted sessions and ended sessions without a delivery remain invalid. Recovery
does not reopen the session/objective or rewrite the delivery summary/report.

Status: contract, storage, service, REST/Protocol/MCP, the CLI ledger and
reads, connector outcome gating, delivery composition, webhooks, agent guidance,
web/desktop and mobile use the new shapes. Coordinated installation and database
migration are required; repository validation is not production rollout.

## [164]

One implementation per workflow across the service, REST, MCP, CLI, and desktop
modules (duplicate-functionality review, 2026-10-23).

- **MCP tool catalog**: tool names, titles, descriptions, input/output schemas,
  and safety annotations are defined once in `@overlord/contract/mcp-tools`
  (`packages/contract/src/mcp-tools.ts`). Hosted MCP projects it and adds MCP
  Apps widget `_meta`; the local connector shim's `tools` array is generated
  from it (`yarn connectors:mcp-tools`, enforced by `connectors:check`) and
  omits `outputSchema`, because the shim forwards Protocol output unwrapped.
  The local shim gains the drifted inputs the contract already promised
  (`agent`/`model` on `overlord_add_objectives` items, typed delivery-report
  arrays, the `dateField` enum, strict human-action items) plus
  `readOnlyHint`/`destructiveHint`/`openWorldHint` annotations. All additions
  are additive; no tool was renamed or removed.
- **REST delegates to the shared service layer**: mission schedule preview,
  read, upsert, and clear, the scheduled-duplicate mission number, profile
  metadata reads/merges, default status seeding, and top-of-column board
  position each have one implementation in `packages/core/service`. REST keeps
  its RBAC check and DTO mapping only. The scheduled duplicate now allocates
  its mission number atomically, like every other mission create. Schedule
  validation errors keep their HTTP status and `error` text and additionally
  carry `code: validation_error`.
- **Fix**: `GET /api/missions/:id/objectives` addressed by a mission display id
  returns that mission's objectives instead of an empty list.
- **Desktop shared helpers**: Desktop resolves the per-user data directory
  through the Database package's `local-paths` and normalizes backend URLs with
  the Contract package helper, so the shell, CLI, and backend agree on
  `OVLD_HOME` (a relative value is resolved to an absolute path everywhere).
  Desktop already bundled `packages/core`; its registry entry now declares the
  `protocol` and `database` dependencies it imports.

Module impacts: MCP and Connector share one catalog (connector package
versions advance to 0.3.53; re-run `ovld agent-setup <agent>` to pick up the
richer local schemas). REST changes no route, request, or success shape.
Protocol/Core gain exports only, and drop an unused `listProjects` that ignored
token project scope. CLI and Desktop change no command or bridge surface.
Database, Auth, Runner, Web, Mobile, Automations, and extensions retain their
interfaces and storage. No migration is required.

## [163]

Objective title editing and assignment visibility (coo:1174.91tr). Protocol
`update-objective` adds optional `--title`, allowing agents to set or clear an
objective's custom title without changing its instruction text. Hosted MCP
`overlord_update_objective` accepts the matching optional `title` input. Both
surfaces use the existing `objective:update` authorization and shared objective
service. Objective context returned by Protocol `load-context`/`attach` now
includes `assignedAgent`, `model`, and `reasoningEffort` alongside its existing
resource key, making the selected agent, model, thinking level and resource
visible to CLI and MCP consumers.

Module impacts: Protocol/Core enrich the objective context projection and expose
the existing title update capability; CLI adds the title flag and documents
assignment fields; hosted MCP and the local connector MCP shim add the matching
title input and receive the enriched context response. Connector package
versions advance to 0.3.52. REST, Database, Auth, Runner, Desktop, Web, Mobile,
Automations and extensions retain their interfaces and storage. No migration is
required.

## [162]

Bounded Compose objective history (coo:1166.ww5f): authenticated
`GET /api/objective-transcript` returns `ObjectiveTranscriptPageDto` across the
caller's active-organization memberships with both `mission:read` and
`objective:read`, restricted by token project scope before selection. Live
objectives of live missions in live, active projects qualify, including old
completed missions. Private profile Inbox captures are never included.

`limit` defaults to 50, accepts 1–100. History is newest first by immutable
`(created_at, id)`; opaque versioned `before` cursors select strictly older
rows. `after` selects strictly newer rows, oldest first, with `nextAfter` for
draining new creates without skipping an intervening page. `nextBefore` is
present only when another older page exists; `newestCursor` is the newest
returned key (null for an empty page). Cursors are positions, never authorization
grants or snapshots. `before`, `after` and `ids` are mutually exclusive. Invalid
inputs return 400. `ids` is a comma-separated set of 1–100 objective UUIDs:
revalidate just those rows, no pagination; omitted IDs mean absent or no longer
authorized and must be removed locally, without disclosing why. No count query
or per-objective hydration is performed. Full instruction text is retained;
the bound is rows, not bytes, and a single instruction can still be large.

Every item includes objective identity/revision, creation provenance, assignment,
instruction/title/state/resource key, and current mission/project presentation
metadata. Consumers deduplicate by objective ID and sort chronologically for
display. Use `after` for creates and bounded `ids` revalidation for loaded rows
after notices/reconnect, including late edits, deletions, mission/project moves
and authorization changes. A permission expansion needs a fresh history walk;
an access/account/organization change discards prior cursors and cached rows.
The existing sequence-based `/sync/changes`/realtime feed remains authoritative
for changed IDs, including same-timestamp or backdated creates which may precede
an `after` position. Buffer/replay it around initial loading and revalidate its
named IDs; a transcript cursor alone is not a change-log cursor.
The existing owner-only `/api/inbox` stays separate: re-read its authoritative
capture set after local mutations/reconnect; promotion removes its capture ID
and introduces the created objective ID. Reconcile optimistic mission creates
against returned objective IDs, never text. See
`docs/objective-transcript.md` for mobile compatibility and refresh requirements.

Module impacts: REST adds the read and authorization adapter; Core owns the
bounded SQL projection; contract package adds DTOs; Database adds the partial
history index `idx_objectives_transcript_created` on `(workspace_id, created_at, id)`
on both editions (migration `20261021090000_objective_transcript_index`). Mobile gains an optional read
surface for its next integration objective; existing clients remain compatible.
Web, Desktop, Auth, Protocol, CLI, MCP, Runner, Connector, Automations and
extensions retain their interfaces. No deployment is implied.

## [161]

Desktop performance capture (coo:1165.4bn0) adds the optional, feature-detected
`window.overlord.diagnostics.{getStatus,record,reveal}` bridge. Only the main
shell document may invoke these fixed operations. One recording runs for 15
seconds in Electron main, survives settings navigation, and records Chromium
JavaScript/rendering events plus process CPU/memory samples. Capture is opt-in,
uses a bounded trace buffer, and replaces only the previous local capture. No
arbitrary path, trace configuration, debugger command or remote upload is exposed.
The settings panel explains that traces may contain URLs and function names.

Module impacts: Desktop owns recording and local files; Web adds a diagnostics
panel when the bridge is available and uses compositor-friendly status animation
in Feed, mission objectives and board/list/calendar card overlays. REST, Core, Database, Auth, Protocol, CLI,
Runner, MCP, Connector, Mobile and Automations retain their interfaces.

## [160]

Remove My Missions (coo:1134.s83a). The Web/Desktop aggregate board is retired;
Feed is the default landing page. Legacy `/user` and `/workspace` links redirect
to Feed, and their mission links redirect to the Feed mission drawer with search
parameters preserved. `GET /api/workspace/my-missions` and
`PATCH /api/workspace/my-missions/order` are removed, along with `MyMissionDto`,
`MyMissionsResponse`, `MyMissionReorderRequest` and the `MY_MISSIONS_*` column
vocabulary. Cross-project/workspace personal interleaving has no replacement.

Migration `20261008100000_remove_my_mission_positions` drops the obsolete
`my_mission_positions` table in SQLite and PostgreSQL. It discards personal board
order only; missions, project board positions, assignments and status history
are retained. Core delivery places review missions using their project board
position and no longer maintains personal positions; REST project moves no
longer cascade into the retired table. Historical migrations remain unchanged.

Module impacts: Web and Desktop consume the simplified SPA; REST and the
contract package remove the two endpoints and their dedicated DTOs; Database
removes the table and Core removes its ordering writes. Inbox/Feed reads,
workspace membership authorization, project mission/status APIs, mobile Live
Activities and push snapshots retain their independent projections. Mobile,
Auth, Protocol command shapes, CLI, MCP Server, Connector, Runner, Automations
and extensions require no implementation changes. External clients of the
retired endpoints must use project mission APIs or Inbox/Feed instead.

## [159]

Owner-only chat diagnostics (coo:1125.b0m5). Application settings adds a
browser-local `overlord.chatDiagnostics` toggle, default false. When enabled the
chat screen polls `GET /api/chat/threads/:id/diagnostics?after=<seq>` (default 0,
nonnegative safe integer), returning `ChatDiagnosticPageDto` with `entries`,
`nextCursor` and `hasMore`, at most 100 entries in ascending per-thread sequence.
Each entry has `seq`, `threadId`, nullable `runId`/`attemptId`, `kind`, `createdAt`
and arbitrary JSON `payload`. Kinds are open diagnostic labels, not chat event kinds.
The route uses the same live membership, owner and organization gates as chat;
foreign callers get 404 and Local gets `chat_unavailable`. Responses are no-store.

`chat_diagnostics` stores append-only observations: provider SDK request bodies,
every streamed SDK chunk, full generate responses, stream completion and original
errors (including retry and summary failures), private chat events with raw tool,
run and attempt state at the transition, worker failures, and thread-associated
REST request/response/error bodies (excluding the diagnostics poll itself). Capture
is independent of the display setting. It starts at upgrade; older exchanges cannot be recovered.
Payloads are neither redacted nor truncated; content is rendered as escaped text.
This endpoint is the explicit exception to the curated-chat privacy and source
projection rules: the owner can inspect previously observed content, including
thought signatures, tool output and subsequently revoked source content. Provider
SDK inputs/outputs are captured; transport authorization headers and credential
store envelopes are not SDK message content and are not separately copied.
Diagnostics never enter ordinary snapshots, SSE, global logs, search, webhooks or
provider history. No diagnostic read invokes tools or changes a run's authorization.
History lasts for the thread lifetime and cascades on owner/thread deletion.

Performance observations (coo:1127.w09e) use this same private diagnostic surface.
Provider observations may add monotonic SDK-consumption timestamps and byte sizes;
`performance.attempt` records bounded numeric aggregates for diagnostic transaction
completion, thread-lock acquisition, source checks, tool dispatch/receipt joins,
text commit, provider rounds and reported usage. Timings never contain content and
never enter global logs. SDK arrival means consumption from the SDK iterator, not
network arrival. Transaction completion is measured after the awaited transaction;
transaction-return spans under ambient nesting do not prove an outer commit. The
production worker invokes the runtime outside an enclosing transaction.
Each resumed attempt is measured separately; complete-run wall time comes from the
durable run timestamps. Missing usage stays missing rather than becoming zero.
Browser first-text paint is a foreground rendering opportunity measured locally,
scoped to account/backend/thread/run and cleared on scope change; it is not a server
clock or a guarantee that pixels reached a display. No browser telemetry endpoint is
added, and diagnostics capture remains independent of the display toggle.

Module impacts: Core adds an internal numeric measurement scope; Backend uses it
and retains the aggregates in existing owner-private diagnostics. Web and Desktop's
shared SPA measure locally; Mobile needs no change. Database, REST DTOs/routes,
Auth, Protocol, CLI, MCP Server, Connector, Runner, Automations and extensions have
no interface/schema change. The open diagnostic kind/payload vocabulary is unchanged;
no contract version bump or migration is required.

Summary coverage and context budgets (coo:1127.158y) refine the Gemini runtime's
_Summaries_ and _Limits_ below: summary-covered messages are replaced by the summary in
new provider requests, summary generation uses its own bounded instruction/output,
coverage names the last message actually summarized, and a token-counted input budget
with model headroom ends gathering through the existing `allowance_exhausted` path.
Module impacts: Core resolves summary coverage by storage order and accepts the
explicit coverage boundary on its internal summary write (validated to belong to the
thread and not precede the previous boundary). Backend selects the prefix, generates
summaries and enforces the budget; `CHAT_GEMINI_INPUT_TOKEN_LIMIT` is additive operator
configuration. Database schema, REST DTOs/routes, closed failure/outcome vocabularies,
checkpoint schema, Web, Desktop, Mobile, Auth, Protocol, CLI, MCP Server, Connector,
Runner, Automations and extensions are unchanged; the context-policy version enters the
config digest, so checkpoints written before it recover through fresh generation. No
contract version bump or migration is required.

The Gemini static-prefix cache (coo:1127.0904) refines the runtime below: the exact
system instruction and declarations of small tool-enabled requests may be referenced
through an owner-keyed explicit cache, with inline requests for larger prompts, closing
and summary requests. Cache operations are captured in the owner's private diagnostics;
the config digest, checkpoints, authorization and public interfaces are unchanged and
`CHAT_GEMINI_STATIC_CACHE=off` disables it. No contract version bump or migration is
required.

The Web diagnostics viewer (coo:1127.q59w) windows its rows: every retained entry stays
reachable by scrolling, only rows near the viewport are in the DOM, expanded rows keep their
state while scrolled out of view, and JSON is pretty-printed only while a row is expanded.
Polling pauses while the document is hidden and resumes from the same ordered cursor when
visible; a thread/account change restarts at cursor 0. Capture, paging, retention and the
diagnostics route are unchanged; Web/Desktop SPA only, no contract version bump.

**Module impacts.** Database: additive `chat_diagnostics` table and index on both
editions, migration `20261007070000_chat_diagnostics`. Core: sequence allocation,
owner-only paged reads and raw event observations; no run/lease semantics change.
Backend/REST: additive diagnostics route, SDK exchange and worker-error capture.
Contract package: additive diagnostic DTOs. Web: Application toggle and a live,
paged log with complete expandable JSON. Desktop Shell consumes the same SPA.
Mobile may consume the optional endpoint but needs no changes. Auth, Protocol,
CLI, MCP Server, Connector, Runner, Automations and extensions have no interface
change. Storage grows with observed exchanges; no content-size cap is imposed.

## [158]

Knowledgebase all-workspaces access for the assistant (coo:1117.3p8q). A person can
turn on, per Knowledgebase connection in Connected accounts, "Let the assistant edit
notes in all authorized workspaces". With it on, every assistant run reads and writes
any workspace in the connection's `authorizedWorkspaces` without a per-message
`knowledgebaseWrite` grant; with it off (the default) v154 behavior is unchanged.

- **Persistence.** `account_connections.assistant_write_scope` (text, not null,
  default `per_request`, closed: `per_request`, `all_workspaces`), migration
  `20261006120000_account_connections_assistant_write_scope` on both editions.
  Existing rows become `per_request`, so nobody's access widens on upgrade.
- **DTO.** `AccountConnectionDto.assistantWriteScope:
AccountConnectionAssistantWriteScope` (always `per_request` for providers other than
  `knowledgebase`). New `ACCOUNT_CONNECTION_ASSISTANT_WRITE_SCOPES` and
  `UpdateAccountConnectionBody` (`{ expectedRevision, assistantWriteScope }`).
- **Route.** `PATCH /api/connections/:id` (Cloud-only, like the rest of the
  organization-scoped routes) changes a live Knowledgebase connection the caller owns
  and returns its DTO. `not_found` for a missing, foreign or disconnected row;
  `invalid_request` for another provider, an unknown key or value; `stale_revision`
  when `expectedRevision` is not the current `revision`. A change bumps `revision`.
- **Enforcement.** The outbound MCP client reads the connection row on every call.
  Under `all_workspaces` it declares the reviewed write tools for that connection
  without a grant and admits a write naming any workspace the connection is authorized
  for (refreshed from `list_workspaces` once when unknown, as for reads); anything else
  is still `workspace_not_authorized`. Turning the setting off refuses the next write
  (`write_not_authorized`) even for tools a running run already declared. Writes keep
  every tool-policy v2 guard, bound, sequential ordering, and `uncertain` handling.
  `ChatRunDto.knowledgebaseWrite` still reports only a per-message grant (null here).

**Impact.** Database: one additive column on both editions. Backend: connections
module (`update`, DTO projection), routes (`PATCH`), outbound MCP client, chat tool
gateway (write-tool descriptions name the scope). Web: Connected accounts toggle; the
composer drops the per-message picker for an all-workspaces connection and says edits
are allowed. Mobile (OverlordMobile) can ignore the new DTO field; it gains the setting
only if it adds the same toggle. REST otherwise, Auth, Protocol, CLI, MCP Server,
Connector, Runner, Automations, and Desktop Shell have no interface change.

## [157]

Knowledgebase source-check traffic (coo:1117.rf2w). The upstream MCP server limits
each `(token subject, client)` pair to 120 tool calls per minute, and its
`get_related` access check accepts one node at a time. Overlord therefore keeps
the existing single-flight behavior and extends the per-owner positive source
check cache from 15 to 30 seconds. The owner's connection row is still checked
on every source check; upstream node revocation is observed within 30 seconds.
There is no new route, tool, DTO, or persistence change.

**Impact.** Backend account connections only: `source-check.ts` reduces repeated
upstream `get_related` calls for the same source, with a maximum 30-second delay
to observe upstream node revocation. REST, Database, Auth, Protocol, CLI, MCP
Server, Connector, Runner, Automations, Desktop Shell, Web, and Mobile have no
interface or implementation change.

## [156]

Zero-setup Knowledgebase connection (coo:1121.w16e). A person opens Connected accounts,
clicks Connect, signs in to Knowledgebase, approves access and returns connected. No
operator sets a Knowledgebase variable and no one generates a key. This version changes
the configured-server policy and the key ring; there is no new route, DTO field,
migration or column, and the OAuth flow, tool policy, `knowledgebaseWrite` grant
(per-message Allow edits) and owner/organization scoping are unchanged.

**Configured-server policy.** One deployment still talks to exactly one Knowledgebase
MCP resource, chosen by the operator, never by a user:

- `KNOWLEDGEBASE_MCP_URL` unset (or blank) means the standard server,
  `https://knowledge.chaselubitz.com/mcp` (`DEFAULT_KNOWLEDGEBASE_MCP_URL` in
  `backend/connections/config.ts`). Before v156 unset meant `not_configured`.
- An HTTPS URL is an operator override, validated at startup as before (HTTPS, no
  credentials). A malformed override turns the provider off rather than the backend.
- `off`, `none`, `disabled` or `false` turns the provider off (`not_configured`, no
  Client ID Metadata Document).
- Egress is unchanged: the backend reaches only the server's origin plus
  `KNOWLEDGEBASE_EGRESS_ORIGINS` over HTTPS, without following redirects. The standard
  server's authorization server shares its origin, so the default needs no extra
  origin.
- There are no per-user custom servers. Existing rows keep their `server_url`; one live
  connection per `(owner, organization, provider, server_url)` is unchanged.

**Platform key.** The key ring (v153) gains a platform entry:

- It is derived with HKDF-SHA256 from the deployment-provisioned `BETTER_AUTH_SECRET`
  (at least 32 characters), under a label used only for account connections.
- Its id is `platform-<16 hex>`, a one-way fingerprint of the derived key. The id changes
  whenever the secret changes.
- `platform-*` ids are reserved: `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY_ID` cannot take one
  (it falls back to `k1`, like the other reserved ids).

The key used to seal new credentials is:

- For Knowledgebase: the explicit current key (`ACCOUNT_CONNECTIONS_ENCRYPTION_KEY`),
  else the platform key.
- For a profile-scoped provider: the explicit current key, else its v153 fallback key,
  else the platform key. Deployments that already set a key behave exactly as in v155.

Knowledgebase reads an envelope under the current or the platform key. When a row is
under the other one, the module re-seals it in place under the write key. A re-seal is
guarded by key id and credential revision, and changes neither the token nor the
credential revision. So adding a dedicated key later re-seals platform-sealed rows on
next use, and no one reconnects.

When a row's key is absent from the ring:

- An explicit-key row while no explicit key is configured, or a platform row while no
  platform key is derived: `unavailable` (503 from use), and the envelope is kept.
  Restoring the variable restores access.
- A platform row while a different platform key is derived (the secret was rotated), or
  an explicit-key row under a replaced key: `reauthorization_required` with
  `credential_unreadable`, and the credential is erased, exactly as in v152/v153.

Profile-scoped rows follow the same rule for `platform-*` ids. Everything else in the
v153 rule is unchanged. The platform key, the secret and every credential stay inside
the backend; DTOs, logs, realtime, URLs and agent processes never see them. At startup
the backend logs only the server origin, whether it is the default or an override, and
the key source.

**Availability.** `GET /api/connections?scope=all` reports Knowledgebase `available`
on a Cloud deployment with `BETTER_AUTH_SECRET` and no Knowledgebase variables. The
reasons and their wire values are unchanged:

- `not_configured`: the operator turned the provider off.
- `encryption_not_configured`: there is neither an explicit key nor a platform key.
- `not_offered_on_edition`: Local.

**Impact by module.**

- Backend (account connections): `config.ts` gains the default and the off switch;
  `keyring.ts` gains the platform key; `service.ts` gains reads under ring keys and the
  in-place re-seal. Startup logs Knowledgebase readiness without secrets.
- REST, Database, Auth, Protocol, CLI, MCP Server, Connector, Runner, Automations,
  Desktop Shell: no interface change. There is no migration, and `credential_key_id`
  additionally admits `platform-*` values. `BETTER_AUTH_SECRET` keeps its meaning;
  rotating it without a dedicated key now also asks Knowledgebase owners (and
  platform-sealed profile connections) to reconnect.
- Web (Connected accounts): no API change. A row now shows:
  - a busy "Opening Knowledgebase…" Connect button while the browser leaves;
  - why an unfinished sign-in stopped (`authorization_denied` → cancelled);
  - the server host and shared workspaces of a connected Knowledgebase account;
  - actionable text for unavailable reasons, which never names a variable;
  - a retry when the listing fails.

  Callback notices say what happened and what to do next.

- Mobile (OverlordMobile): no change required. Its rows read the same availability.
- Operators: `.env.*.example` and the public Integrations guide document the
  zero-setup default and the optional overrides.

## [155]

Feature handoff and mission-read interoperability for the unified Knowledgebase
connection (per:202.5h64, connector objective C2 in the Knowledgebase plan
`docs/features/KNOWLEDGEBASE_OVERLORD_CONNECTOR.md`). Still one Knowledgebase account
connection and one outbound MCP client; no Feature backend, reverse credential store,
scheduler, or token export. Feature plan:
`planning/feature-plans/chat-agent-request-routing-phase-c-connections.md` → "C2 Feature
handoff (contract v155)".

**Exact-reference lookup.** Protocol `search --reference <token> --project-id <ref>
[--workspace-id] [--limit 1-100, default 50] [--cursor]` returns
`MissionReferenceSearchResponse` (`packages/contract/src/mission-reference.ts`):
`{ kind: 'mission_reference_search', version: 1, reference, projectId, workspaceId,
results, nextCursor, complete }`. It is exhaustive, not ranked: every live mission in the
one readable project whose live objective instruction text contains the token
case-sensitively as a whole token (not adjacent to a letter, digit, or underscore), in
mission-id order, each with `statusType`, `statusId`, and its matching objectives
(`id`, `displayId`, `title`, `state`, `position`). Pages are over candidate missions, so
a page may hold fewer than `limit` results; `complete` is true only on the last page and
the cursor is bound to its reference and project. Tokens are 8–512 characters without
whitespace; `%` and `_` are literal. Ranked filters (`--query`, `--status`,
`--resource-key`, date flags, `--response-version`, v3 flags) are rejected with it, and
`--cursor` without `--reference` is rejected. Authorization matches v2/v3 search: the
project resolves across the caller's organization memberships, `mission:read` is
checked on that project, and a project_automation token must have selected it. Ranked
search (any version) remains candidate discovery and never proves absence. Hosted MCP
`overlord_search_missions` and the local shim add `reference` and `cursor` and forward
this mode unchanged (never compacted).

**Canonical Feature reference.** `kb-feature:<origin>/<workspace slug>/<node uuid>`
(`knowledgebaseFeatureReference`, `parseKnowledgebaseFeatureReference`), with the stable
link `<origin>/n/<node uuid>`. A handoff mission carries it in objective text; identity
is never a title or path. Mission completion is mission `statusType` `complete`; an
objective delivery or `review` is not completion.

**Assistant.** With a Knowledgebase configured the assistant gets the read tool
`overlord_find_feature_missions` (`projectId`, `workspace`, `featureNodeId`, optional
`knowledgebaseOrigin` when several servers are connected, `cursor`, `limit`), which
derives the origin from the owner's live connection, runs the same lookup with the
owner's live `mission:read` grant, and returns the reference, Feature link,
`referenceLines` for a handoff objective, results, `nextCursor`, and `complete`. Handoff
reuses `prepare_proposal` and the user's Create: drafts only, never launched. Run input
adds `createdReceipts` (up to five created cards in the thread with their mission ids
and display ids), so a later turn recovers the created mission instead of proposing it
again. A `set_properties` write that sets a Feature's `overlord` to a non-null value is
refused before any request unless it names exactly one live mission the owner can
read, and refused when that mission carries a different Feature's canonical reference;
`null` (Remove link) is always allowed and never changes the mission. System prompt
`overlord-assistant-v5` adds the handoff procedure; `tool.updated.label` adds
`Checking Feature missions`.

**Impact.**

- Protocol/CLI: additive `--reference`/`--cursor` on `search`; help and
  `contract/protocol-commands.yaml` updated. Existing ranked responses are unchanged.
- hosted MCP Server and connectors: additive `reference`/`cursor` on
  `overlord_search_missions`; connector version 0.3.50.
- Core/backend: `packages/core/service/mission-reference-search.ts`, chat tool gateway,
  run input, Gemini prompt. No schema change (no migration); the lookup uses existing
  `missions`/`objectives` columns on both editions.
- Webapp, Desktop Shell, Runner, Automations, extensions: no change. External
  Knowledgebase agents use the authenticated Overlord MCP; Knowledgebase stores no
  Overlord credential.

## [154]

Authorized Knowledgebase writes for the assistant through the existing connection
(per:202.62e3, connector objective C1 in the Knowledgebase plan
`docs/features/KNOWLEDGEBASE_OVERLORD_CONNECTOR.md`). There is still one Knowledgebase
account connection, one credential store, and one outbound MCP client; no Feature
connector, REST metadata client, or token export to agent processes is added. Feature
plan: `planning/feature-plans/chat-agent-request-routing-phase-c-connections.md` →
"C1 extension (contract v154)".

**Run-scoped write grant.** `SubmitChatMessageBody.knowledgebaseWrite?:
ChatKnowledgebaseWriteDto` (`{ connectionId, workspace }`) is the only way to authorize
writes. It is chosen per message in the composer and is refused with `invalid_request`
unless the connection is the caller's live Knowledgebase connection on the configured
server and the workspace is in its `authorizedWorkspaces`
(`connection_reauthorization_required` when it needs sign-in). The grant is stored on
the run (`chat_runs.knowledgebase_write_json`, migration
`20261005160000_chat_runs_knowledgebase_write`, both editions) and returned as
`ChatRunDto.knowledgebaseWrite` (null for research only). A resumed run keeps it; a
Continue run inherits it; an answer may add a grant to a waiting run that has none and
may never change one. OAuth consent, earlier runs, and model output never authorize a
write. Without a grant no write tool is declared and any write call is refused
server-side (`write_not_authorized`) before reaching the Knowledgebase, unless the
connection's `assistantWriteScope` is `all_workspaces` (v158), which authorizes writes
in every authorized workspace of that connection for every run.

**Tool policy version 2.** Reads add `query` (the Knowledgebase marks this POST
semantically read-only) and `get_registries`. Writes: `create_node`, `edit_file`,
`set_properties`, `add_relation`, `update_relation`, `remove_relation`, exposed only for
the granted connection and accepted only for the granted workspace. Overlord's schemas
require each write's revision guard (`expected_version`, `expected_metadata_revision`,
or `expected_revision`); `set_properties` values may be `null` (removal); nested JSON is
bounded (depth 8, 4000 values, 16 KiB strings, finite numbers, 128-character keys) with
per-tool argument limits (4 KiB reads, up to 56 KiB for document edits). A write the
server annotates destructive is withheld unless reviewed destructive
(`remove_relation`); a read must stay annotated read-only. Schema administration,
sharing, credentials, moves, and deletion stay outside the policy. There is no
Knowledgebase write OAuth scope: a connection acts with its user's grants minus their
restrictions, so existing connections gain the tools without reauthorization and the
Knowledgebase remains authoritative (403). `toolPolicyVersion` records the version at
sign-in and does not gate tools.

**Outcomes.** A write refused by its guard (HTTP 409/412, or `edit_file`'s version
check) is `conflict`: the model is told to reread and re-evaluate. A write sent without
a usable response (transport loss, 5xx, oversized or unparseable result) is
`uncertain` and is never retried by Overlord; one refused before handling (401 refresh,
4xx, dropped session) is safe. `query`, `get_related`, and `get_registries` are
complete-metadata reads: a response over the 64 KiB text bound is refused
(`response_too_large`, ask for a smaller page) rather than truncated.

**Runtime.** Writes run one at a time in call order after the turn's reads.
`chat_tool_calls` rows of a write still `executing` when its attempt ends are resolved
at the next claim as `failed` with `error_code = 'uncertain_write'` and an `uncertain`
result (never re-requested, never cancelled); a write that throws inside the worker is
recorded the same way. Fresh-generation recovery shows uncertain writes to the model. The
system prompt (`overlord-assistant-v4`) requires reading before writing, guarded
retries, rereading after uncertainty, inline linking, and reporting changes.
`tool.updated.label` adds `Updating notes`; `query` reports `Searching notes`.

**Impact.**

- REST/backend: connections module, outbound MCP client and policy, chat runtime, and
  submission check (`ChatOptions.authorizeKnowledgebaseWrite`).
- Core: conversations/runs/tool gateway as above; Overlord missions are still never
  created, changed, or launched by a tool.
- Database: one nullable column on both editions.
- Webapp: per-message "Allow edits in <workspace>" control (resets after each send),
  run indicator, and access wording. Mobile tolerates the additive DTO fields; until it
  offers the control its runs stay research only.
- Protocol, CLI, Connector, Runner, Automations, Desktop Shell, hosted MCP Server, and
  extensions: no change. Local/CLI mission agents keep using their own Knowledgebase MCP
  configuration; backend credentials are never exported to them.

## [153]

Personal integrations move onto the shared account-connections module (coo:1110).
Feature plan: `planning/feature-plans/everhour-github-account-connections-migration.md`;
DTOs: `packages/contract/src/chat.ts` → "Account connections"; schema:
`database/docs/09-database-schema-contract.md` → `account_connections`. This version
defines the interfaces for both personal providers. Both move onto the module in this
version: the Everhour personal API key (coo:1110.j8ny) and the personal GitHub
repository authorization (coo:1110.ykk0).

**Two connection scopes.** `account_connections` holds every external account
connection. A connection is either **organization-scoped** (`knowledgebase`: owned by
a profile inside one organization, exactly as in v152) or **profile-scoped**
(`everhour`, `github`: owned by the profile across every organization, with
`organization_id` NULL). The database enforces `(provider = 'knowledgebase') =
(organization_id IS NOT NULL)`. There is one live connection per `(owner,
organization, provider, server_url)` for organization-scoped rows, and per `(owner,
provider, server_url)` for profile-scoped rows. A profile-scoped GitHub account may be
live on at most one profile. New columns: `credential_kind` (`oauth`, `api_key`),
`credential_format` (see below), `external_account_id`, `external_account_label`,
`external_account_avatar_url`, `granted_scopes_json`, `last_validated_at`, and
`account_connection_authorizations.return_url` (legacy return target, set only by a
compatibility alias).

**Credential envelopes and keys.** The module is the only reader and writer of
`account_connections.credential_*`. Extensions obtain a credential only through the
module (`ProfileConnections.credential(profileId, provider)`). They never read
`credential_*` and never hold an encryption key. Envelopes keep the AES-256-GCM `v1`
format. `credential_format` names the plaintext shape and the additional
authenticated data:

- `connection-v1`: binds owner profile, organization (`-` when profile-scoped),
  provider and connection id. The plaintext is `{accessToken, refreshToken}` for OAuth
  or `{apiKey}` for an API key. Every new write uses this format.
- `everhour-user-key-v1`: an Everhour envelope adopted verbatim from
  `ext_everhour_user_connections`. It binds the owner profile only.
- `github-user-oauth-v1`: GitHub access and refresh envelopes adopted verbatim from
  `ext_github_user_connections` (coo:1110.ykk0). They bind the owner profile only.

Keys form a key ring addressed by `credential_key_id`:

- The current key: `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY`, id
  `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY_ID`, default `k1`.
- Two reserved fallback ids:
  - `everhour-env`: `EVERHOUR_API_KEY_ENCRYPTION_KEY`, falling back to
    `GITHUB_USER_TOKEN_ENCRYPTION_KEY`.
  - `github-user-env`: `GITHUB_USER_TOKEN_ENCRYPTION_KEY`.

Writes use the current key when configured. Otherwise a profile-scoped provider
writes under its fallback key, so a deployment with only the existing variables keeps
working without a new secret. Knowledgebase has no fallback (`provider_not_ready`).

When a row's key id is not in the ring, the outcome depends on the row:

- A fallback key id or a legacy format, or a deployment with no current key at all:
  the credential is `unavailable` (503) and is **not erased**. Restoring the variable
  restores access.
- Any other key id while a current key is configured (a rotated key): the row becomes
  `reauthorization_required` with `credential_unreadable`, and the credential is
  erased, exactly as in v152.

An authentication failure with the key present has the same outcome as a rotated key.

After every successful read of a row in a legacy format, or under a key id that is
not current, the module re-seals that row under the current key (`connection-v1`,
`credential_revision + 1`, guarded by revision). A bounded re-seal sweep runs at
backend start when a current key is configured, and logs counts only.

**Migration and adoption.** Migration `20261005120000_account_connections_profile_scope`
(both editions) widens the schema. SQLite rebuilds `account_connections`, preserving
rows, foreign keys and `chat_source_refs` links. The migration copies every live
`ext_everhour_user_connections` row verbatim, with the same id, format
`everhour-user-key-v1` and key id `everhour-env`, unless the profile already has an
Everhour connection in any state. No key is needed at migration time and no plaintext
is in flight. The migration also overwrites the ciphertext of soft-deleted Everhour
user rows with `revoked:v1`, and the plaintext of soft-deleted (already adopted)
workspace rows. The legacy tables stay as read-only migration sources.

For one release the module also performs lazy adoption: when a profile has no
Everhour row in any state, the module copies a legacy row written by an older
instance. A row still in a legacy format is honoured only while its legacy source row
is live. A disconnect in the module tombstones the legacy row (`deleted_at`,
ciphertext `revoked:v1`), so neither a rollback nor a later re-run can resurrect a
credential the user removed. Workspace-key adoption (v90 rule: unambiguous
`entity_changes` actor) now stores the adopted key through the module and scrubs the
workspace row's plaintext.

A second migration, `20261005130000_account_connections_github_adoption` (both
editions, no rebuild), copies every live `ext_github_user_connections` row verbatim in
the same way: same id, format `github-user-oauth-v1` (the ciphertext column holds
`{"access": <envelope>, "refresh": <envelope or null>}`), key id `github-user-env`,
with the account id, login, avatar, granted scopes and expiries. It skips a profile
that already has a GitHub row in any state, and a GitHub account already live on
another profile. It overwrites the access ciphertext of soft-deleted GitHub rows with
`revoked:v1` and clears their refresh ciphertext. From this version the GitHub legacy
routes no longer write `ext_github_user_connections` or `ext_github_user_oauth_states`;
pending legacy sign-in states are not migrated (a sign-in in flight across the deploy
lands on the expired status and is retried). Lazy adoption and the legacy-source
liveness check apply to GitHub exactly as to Everhour.

**GitHub repository authorization (profile-scoped OAuth).** The module runs the
authorization-code flow for `github` with a confidential client, using the provider
adapter for the provider HTTP calls. The security properties of v31/v33 are unchanged:

- A distinct, explicit grant requesting exactly `repo read:org` with
  `allow_signup=false`, separate from Better Auth GitHub sign-in, through the same
  `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` registration.
- Profile-bound, hashed, single-use state with a 10-minute expiry, stored in
  `account_connection_authorizations` (at most five open per connection). A state is
  bound to its provider: a state issued for one provider is never consumed by
  another provider's callback. A PKCE S256 challenge is always sent; the verifier is
  sealed under the provider's write key.
- The callback stays `GET /api/auth/callback/github/repository`, served by the
  module's callback handler and mounted before the Better Auth `/api/auth/*`
  wildcard.
- A grant without both `repo` and `read:org` stores nothing and finishes `failed`
  with `lastErrorCode` `insufficient_scope`. A GitHub account already live on another
  profile finishes `failed` with `account_in_use`.
- The token is sealed by the module (`connection-v1`, the key ring), never by the
  extension.
- Use refreshes an expiring token under the module's refresh lease, so concurrent
  callers share one upstream refresh, and persists the rotated credential before use.
  A refresh rejected with `bad_refresh_token` (or a missing refresh token) marks the
  connection `reauthorization_required`. An upstream 401 is retried once after a
  forced refresh; a second 401 marks it `reauthorization_required` (`invalid_grant`).
  A `/user` identity that no longer matches the stored account marks it
  `reauthorization_required` (`identity_changed`).
- Disconnect erases the credential first, then revokes the token upstream
  (best-effort), then tombstones the legacy row.

The workspace-scoped GitHub App installation (`/ext/github/integration`, `/install`,
`/callback`, `/repos`, project links, pull requests) and composite project
initialization are unchanged.

**REST.**

- `GET /api/connections` with no `scope` is unchanged from v152: it lists
  organization-scoped connections and is Cloud-only (`chat_unavailable` on Local).
- `GET /api/connections?scope=all` lists the caller's organization-scoped connections
  (Cloud, active organization) plus every profile-scoped connection, and adds
  `providers`. Each entry is `{ provider, scope, credentialKind, available, reason }`,
  where `reason` is one of `not_offered_on_edition`, `not_configured` or
  `encryption_not_configured`. This form is served on both editions.
- `POST /api/connections/api-keys` takes `{ provider, apiKey }` and returns
  `AccountConnectionDto` (`connected`). It validates the key upstream first, then
  seals it. A reconnect or key rotation is the same call. It is served on both
  editions. Errors:
  - 400 `invalid_request`: blank or oversized key.
  - 404 `provider_not_available`: not an API-key provider offered here.
  - 422 `credential_rejected`: the upstream rejected the key.
  - 503 `provider_not_ready`: no write key.
  - 502 `provider_unavailable`: the upstream is unreachable.
- `DELETE /api/connections/:id` also disconnects the caller's profile-scoped
  connections on both editions. It erases the credential first, then tombstones the
  legacy row.
- `POST /api/connections` stays OAuth-only. It accepts `provider: 'github'` on both
  editions, with `returnTo` (`mobile` or `web`) and an optional `returnPath` (web
  only: a relative path that starts with `/`, not `//`, at most 512 characters). It
  returns `StartAccountConnectionResponse`, reusing the caller's live GitHub
  connection for a reconnect. It answers 503 `provider_not_ready` when the OAuth
  client or every write key is missing. `everhour` answers 400 `invalid_request`.
  Knowledgebase is unchanged (Cloud-only).
- The GitHub callback redirects with only `provider=github` and `status`
  (`connected`, `denied`, `expired`, `failed`): to `overlord://connections/callback`
  for `mobile`, and to the web origin plus `returnPath` (default
  `/settings/connections`) for `web`. Without a return target it renders a status
  page. A sign-in started by the legacy alias returns to its validated legacy URL
  with `githubConnection=<status>`.
- New `ChatErrorCode` values: `credential_rejected` (422), `provider_not_available`
  (404), `provider_unavailable` (502).

**Compatibility aliases.** `GET`/`PUT`/`DELETE /ext/everhour/user-connection` and the
deprecated `/ext/everhour/integration` keep their exact request and response shape
(`EverhourIntegrationDto`) and error text. They are thin aliases over the module.
`connected` means a live `connected` row. A `reauthorization_required` row reports
`connected: false`, so the existing connect form appears. Each alias records an
in-process hit counter that is logged hourly, with route and client family only.
Retirement is a later contract change: `/ext/everhour/integration` goes first, after
the web app moves to `/api/connections` (coo:1110.ywx9) and the counter reads zero.
`GET`/`DELETE /ext/github/user-connection` and `POST
/ext/github/user-connection/authorize` are aliases with the same shapes
(`GitHubUserConnectionDto`, `GitHubUserAuthorizationDto`) and the same `returnTo`
validation: an allowed browser origin URL or `overlord://github/callback`, stored in
`account_connection_authorizations.return_url`. A body without `returnTo` returns to
the web connected-accounts page when a web origin is configured, otherwise to the
status page. `connected` means a live `connected` row; `reauthorization_required`
reports `connected: false`, so the existing reconnect flow appears. `configured`
means the OAuth client and a write key are both present. These aliases stay until an
OverlordMobile release on `/api/connections` has shipped and they record 90 days
without hits. `GET /ext/github/repository-owners` is a feature route, not an alias; it
reads its token through the module. `/api/auth/callback/github/repository` stays the
canonical GitHub callback, before the Better Auth wildcard.

**DTOs.** `AccountConnectionDto` gains:

- `scope` (`organization` or `profile`)
- `credentialKind`
- `account` (`{ id, label, avatarUrl }` or null)
- `scopes`
- `lastValidatedAt`

`organizationId` becomes `string | null`. It is always a string in the default
listing. `ACCOUNT_CONNECTION_PROVIDERS` gains `everhour` and `github`.
`StartAccountConnectionBody` gains optional `returnPath`.
`AccountConnectionListResponse` gains optional `providers`. New types:
`SetAccountConnectionApiKeyBody`, `AccountConnectionProviderStatusDto`,
`ACCOUNT_CONNECTION_SCOPES`, `ACCOUNT_CONNECTION_CREDENTIAL_KINDS` and
`ACCOUNT_CONNECTION_CREDENTIAL_FORMATS`.

**Closed vocabularies.**

- `account_connections.provider`: + `everhour`, `github`
- New `account_connections.credential_kind`: `oauth`, `api_key`
- New `account_connections.credential_format`: `connection-v1`,
  `everhour-user-key-v1`, `github-user-oauth-v1`
- `lastErrorCode` additionally admits `insufficient_scope`, `account_in_use`,
  `identity_changed` and `account_lookup_failed` (GitHub)

**Local edition.** `/api/connections` with `?scope=all`, `/api-keys` and `DELETE` is
served on Local for profile-scoped providers. Knowledgebase and `/api/chat/*` stay
Cloud-only. When no key is configured (neither the current key nor the provider's
fallback), the provider reports `available: false` with `encryption_not_configured`
and connecting answers 503. Credentials stored earlier stay listed and answer
`unavailable` without being erased. There is never a plaintext fallback. The legacy
routes keep their existing 503 text.

**Impact by module.**

- Database: one migration per edition, the SQLite rebuild, and schema documentation.
- REST: the connections router serves profile-scoped routes on both editions,
  including `POST /api/connections` for `github`; the Everhour and GitHub personal
  connection routes become aliases.
- Extension System: the Everhour extension drops its own encryption
  (`backend/ext/everhour/crypto.ts` removed). It registers an account-connection
  provider adapter (validate, legacy adoption, tombstone) and reads keys through the
  module. Its manifest moves from the stale `contractVersion: "0"` to 153. The GitHub
  extension drops its token encryption, OAuth state, and token storage from
  `user-oauth.ts`. It registers an OAuth provider adapter
  (`backend/ext/github/connection-provider.ts`: authorize URL, code exchange,
  refresh, revoke, `/user`, legacy adoption and tombstone) and obtains tokens through
  the module. Its REST and database manifests move from 33 to 153.
- Web and mobile (coo:1110.ywx9): one **Connected accounts** place on each client,
  built only on `GET /api/connections?scope=all`, `POST /api/connections`,
  `POST /api/connections/api-keys` and `DELETE /api/connections/:id`, with DTOs from
  `@overlord/contract`. Every provider row shows the same status (Connected, Needs
  reconnecting, Not connected, Not available / Not configured on this server) and
  the same Connect or Reconnect and Disconnect (confirmed) actions. Web:
  `/settings/connections` is now a page (and a Settings section), and the return
  path of every callback; a Knowledgebase sign-in started from Chat goes back to Chat
  with its status. Chat keeps a Knowledgebase shortcut that renders the same row.
  Settings → Integrations holds only the workspace GitHub App. The Everhour feature
  gate (timers, project links) reads the shared listing, so the web app no longer
  calls `/ext/everhour/user-connection`; the project-settings prompt deep-links to
  `/settings/connections?provider=everhour`. Mobile: Settings → Connected accounts
  (OAuth via `ASWebAuthenticationSession` returning to
  `overlord://connections/callback`, Everhour via a secure field); project creation's
  Connect GitHub step and Chat's Knowledgebase sheet use the same module; mobile no
  longer calls `/ext/github/user-connection` and keeps recognising
  `overlord://github/callback` for sign-ins started by older builds. Default
  listings stay byte-compatible, so older clients keep working through the aliases.
- Auth: no functional change. The GitHub repository callback keeps its path and its
  place before the Better Auth wildcard; the module now serves it.
- Protocol, CLI, Connector, Runner, Automations (no `/api/connections` access for
  `project_automation` tokens, unchanged), Desktop Shell and MCP Server: no change.
  Connector manifests are revalidated at 153.
- Chat: `ChatOwner` is used only for organization-scoped providers, and
  `onAccessLost` runs only for them.

## [152]

Overlord assistant conversations, account connections, and owner-addressed
conversation notifications (coo:1108, Gemini-first milestone one). This version
defines the interfaces; services, runtime, clients, and dispatch land in later
objectives against them. Feature plan:
`planning/feature-plans/chat-agent-request-routing.md`; DTOs:
`packages/contract/src/chat.ts`; schema: `database/docs/09-database-schema-contract.md`
→ "Assistant Conversations".

**Scope and privacy.** A chat thread is private to one owner profile inside one
organization; it may reference any workspace of that organization the owner can
currently access. Every `/api/chat/*` route resolves the caller's profile and active
organization and returns 404 `not_found` for another owner's or organization's
thread, run, question, proposal, notification, or connection, without revealing
existence. Chat is Cloud-only: a Local backend answers every `/api/chat/*` and
`/api/connections/*` route with 404 `chat_unavailable`, and clients show chat as
unavailable. The tables exist and are tested on both editions. A `project_automation`
token reaches none of these routes (the v151 allowlist is unchanged).

**REST.** `POST /api/chat/threads` (optional first message), `GET /api/chat/threads`
(owner-only, newest activity first, archived excluded unless `archived=1`, cursor
paging), `GET /api/chat/threads/:id` (atomic snapshot), `PATCH /api/chat/threads/:id`
(`expectedRevision` plus `title` and/or `archived`), `POST /api/chat/threads/:id/messages`,
`GET /api/chat/threads/:id/events?after=<seq>` (SSE replay then live; `?poll=1` returns one
bounded `ChatEventPageDto` for polling), `PUT /api/chat/threads/:id/presence`,
`POST /api/chat/threads/:id/ack`, `POST /api/chat/runs/:id/cancel`,
`POST /api/chat/runs/:id/continue`, `POST /api/chat/questions/:id/answer`,
`POST /api/chat/proposals/:id/create`, `GET /api/chat/providers`,
`GET /api/chat/notifications`, `POST /api/chat/notifications/:id/read`, the
account-connection routes below, and `POST /api/projects/:id/repository-reads`. Error
bodies are `{ error, code }` with the closed `ChatErrorCode` set.

**Submission and runs.** A message submission writes the user message and its run in
one transaction and returns their ids; `(thread, clientRequestId)` is unique, so a
repeated request returns the original message and run with `replayed: true`. Run
states are closed: `queued`, `running`, `waiting_user`, `completed`, `failed`,
`cancelled`; a thread has at most one unfinished (`queued`/`running`/`waiting_user`)
run, enforced by a partial unique index. While a run is `queued` or `running` a new
message returns 409 `run_in_progress`. While it is `waiting_user` any message is the
answer to its single open question and resumes the same run; tapping an option and
typing text are the same action. `POST /api/chat/questions/:id/answer` is the
card form of the same action and requires `expectedRevision` (409 `stale_revision`
once answered, superseded, or cancelled). A `completed` run carries outcome `answered`
or `allowance_exhausted`; a `failed` run carries one closed failure code
(`provider_unavailable`, `rate_limited`, `context_limit`, `unsupported_capability`,
`interrupted`, `provider_error`, `source_access_lost`). Tool failures are recorded per
tool call and never fail a run by themselves.

**Leases and fences.** Backend workers claim a run by inserting a `chat_run_attempts`
row whose `fence` equals the run's freshly incremented `current_fence`; at most one
attempt per run is `leased`, with a renewable lease (default 30 s). Every event, tool
call, and checkpoint write carries the attempt's fence, and both editions reject a
write whose fence is not the run's current fence (SQLite triggers and Postgres
trigger functions with identical semantics), so a worker that lost its lease cannot
publish, invoke, or checkpoint. `waiting_user` releases the lease. Cancellation sets
`cancel_requested_at`, is authoritative at the tool gateway, is idempotent, and ends
the run `cancelled`; a cancelled tool call is the one fence-free transition.

**Checkpoints and recovery.** `chat_provider_checkpoints` holds one private,
versioned provider checkpoint per run (Gemini response parts verbatim with thought
signatures, call ids, and call order; schema version, model, and config digest). It is
never an ordinary DTO, realtime payload, change row, or global log field; the
owner-only v159 diagnostics endpoint exposes exchange observations. A provider tool
request is checkpointed before its tool executes, and its results are recorded and joined in
call order before the next provider request; Overlord, not the provider, enforces
completeness, order, and call-id matching. A checkpoint is reused only when version,
model, and digest match and its dependencies reauthorize; otherwise the attempt
records `recovery_mode = fresh_generation`, rebuilds from authorized messages and
recorded observations, and marks partial text `interrupted`. A read whose receipt is
still `requested` is re-executed under its original `operation_id` (unique); writes
are out of scope. A completed exchange needs no checkpoint and the row is deleted.

**Snapshot and cursor handoff.** `GET /api/chat/threads/:id` reads the thread, the
latest message page, the active and latest runs, the open question, open proposals,
`referencedProposals` (every created or cancelled proposal named by a proposal block in
the returned page, so receipts render after a reload), `eventCursor` (`chat_threads.last_event_seq`), and `retainedFromSeq` in one database
transaction, so `events?after=eventCursor` neither misses nor double-applies an
event. Event sequences are allocated by advancing `last_event_seq` and inserting
exactly that value in the same transaction (storage is gap-free, `(thread, seq)` is
unique, and events are append-only). Events are persisted before they are sent;
replay always comes from storage and live delivery follows replay on one ordered
stream. Text deltas are coalesced. Retention is bounded (defaults: 7 days or 5,000
events per thread, whichever comes first) by deleting rows below
`chat_threads.retained_from_seq`; `after < retainedFromSeq - 1` yields 409
`snapshot_required` (or a `snapshot_required` frame on an open stream) and the
client reloads the snapshot. Messages, runs, questions, proposals, and receipts are
not subject to event retention. A closed stream never implies completion.

**Private event channel (exception).** Chat events are owner-scoped and do not
derive from `entity_changes`; they are private to one person and too frequent for the
change log. This is the sole exception to the REST/backend rule that realtime events
derive from `entity_changes`, and it is recorded in `backend/AGENTS.md`. Chat writes
emit no `entity_changes`, webhooks, or search documents; missions created from chat
emit their normal change, webhook, and search rows.

**Source dependencies and invalidation.** Every source an answer, summary, proposal
revision, checkpoint, question, tool call, or content-bearing event used is a
`chat_source_refs` row (kind `knowledgebase` \| `overlord` \| `repository`, stable
`scope_key`, last access check). Each derived row points at an immutable
`chat_dependency_sets` row whose members are the conservative union of every source
supplied to that generation, including those inherited from earlier summaries and
messages. Snapshots, replay, live publication, provider input, checkpoint reuse, and
Create recheck the dependency set; anything not currently `authorized` fails closed.
Revocation increments `chat_threads.authorization_revision`, marks affected sets,
messages, summaries, checkpoints, and proposal revisions invalidated, replaces whole
affected blocks with an `unavailable` block, emits `content.invalidated`, and fences a
live attempt using that context (restart from remaining authorized content or fail
`source_access_lost`). Raw stored events never bypass this projection: replay of an
event whose dependency set is invalidated sends `content.invalidated` instead.

**Proposals, frozen assignments, and Create.** A proposal is versioned:
`chat_work_proposal_revisions` rows are frozen once written (spec, responsible profile,
revision number cannot change), each naming explicit project ids, titles, ordered
objectives, resource keys, acceptance criteria, evidence, dependencies, and a concrete
agent/model/reasoning selection with its source. Omitted or null agents never reach
Create; a revision without a justified selection is not creatable.
`POST /api/chat/proposals/:id/create` with `{ clientRequestId, expectedRevision }` is
the only creation path; no tool can create, change, or launch work. It rechecks
membership, `mission:create` on every destination project, source dependencies and
the thread `authorization_revision`, the expected revision, and the frozen
assignments, then in one transaction calls the existing mission-creation service once
per mission with that mission's workspace context, verifies the saved assignments,
stamps `created_by_kind = agent`, `created_by_agent = overlord-assistant`, the acting
user as responsible person, and `missions.created_from_chat_thread_id` (soft reference,
no foreign key), forces draft-only/no-queue, and writes one `chat_work_receipts` row
(unique per proposal and per `(owner, clientRequestId)`) with its
`chat_work_receipt_missions`. Any failure creates nothing. Duplicate, concurrent, or
crash-after-commit calls return the identical receipt (`replayed: true`). A stale
revision returns 409 `stale_revision`; an invalidated or non-open revision returns 409
`proposal_not_creatable`. **Cancel/Create outcome:** cancelling a run never cancels or
blocks Create of a revision that was already published (`proposal.revised` committed);
a revision still being prepared by the cancelled attempt is never published. Create of
a published revision therefore succeeds or fails on its own checks regardless of a
concurrent Cancel, and a later Cancel never removes created drafts.

_Proposal implementation (coo:1108.k0tc)._ The internal `prepare_proposal` tool
publishes or revises a card and cannot create domain work. Preparation validates
registered resource keys and the destination workspace agent catalog, resolves the
acting member's project launch preference, and freezes model/reasoning values.
Missing or invalid preferences require `ask_user` or an explicit supported selection;
Create never reapplies defaults. Shared mission creation accepts explicit reasoning
effort and preserves it alongside agent/model. Create selects a concrete draft
status even if the project default is Next, serializes owner receipt keys and
workspace mission sequences, and commits domain rows, receipt and private event in
one outer transaction. A request key already used by another proposal returns
`invalid_request`; an existing receipt for the same proposal returns its original
IDs. No new public DTO, schema, or route is introduced by this implementation.

_Web and desktop client (coo:1108.r2b0)._ The shared SPA consumes these routes only.
It creates a thread empty and then submits the first message, so every content-bearing
write is idempotent; each action's `clientRequestId` is minted once and reused by every
retry (Create ids persist across reloads, scoped to backend, profile, and organization),
so a lost Create response is recovered as the original receipt. It renders a proposal
block whose revision is older than the proposal's current revision as superseded, and
never offers Create for an invalidated, superseded, or non-open revision. Presence is
held only while the tab is visible and focused (`platform` `web` or `desktop`, one
client id per page load), and acknowledgements are sent only for events already
committed to the rendered transcript. The Knowledgebase callback's web return path
`/settings/connections` is an SPA route that reloads connection state and returns to
Chat. _(Since v153 it is the Connected accounts page; a sign-in started from Chat still
returns to Chat.)_

**Continue.** When the latest run of a thread completed with
`allowance_exhausted`, `POST /api/chat/runs/:id/continue` creates one new run with
`continued_from_run_id` set and a fresh allowance, reusing recorded evidence and
summaries; a run can be continued at most once (unique index), so a repeated request
returns the same run. Any other run returns 409 `continue_not_available`. Defaults
(configurable, see the verification notes below): 60 tool calls and ten minutes of
active processing per run, excluding `waiting_user`; three concurrent runs per owner;
four concurrent target reads per run.

**Conversation notifications.** Two catalog types join `notification_preferences.type`:
`chat_needs_answer` (a run entered `waiting_user`) and `chat_finished` (a run completed
or failed). They are addressed by owner profile, organization, thread, run, and
question, never by a fabricated mission or an arbitrary workspace, and they never appear
in the mission-only `GET /api/notifications` list, whose `NotificationDto` is
unchanged. Each qualifying transition writes one `chat_notifications` row in the same
transaction as the transition: it is the durable candidate, its dispatch job state
(`pending` → `dispatching` → `dispatched`/`failed`, or `suppressed`/`cancelled`), and
once dispatched its history entry. The row is unique on `(owner, thread, run, type,
transition_key)` where the key is `question:<ordinal>` or `terminal:<state>`, so a new
question never collapses into an earlier one and dispatcher retries cannot duplicate.
`due_at` is the transition time plus a grace period (default 5 s). **Presence and
acknowledgement:** `PUT /api/chat/threads/:id/presence` renews (default 30 s TTL) or
releases one client's foreground presence; `POST /api/chat/threads/:id/ack` records
that a foreground client rendered events through `seq` (monotonic per client,
idempotent, separate from any replay cursor). A pending candidate is suppressed only
when a client that is foreground on that thread at acknowledgement time acknowledges a
`seq` at or after the candidate's `event_seq`; a connection or open socket alone never
suppresses. Otherwise it dispatches after `due_at`, including when a dead connection
still appears open. Before dispatch the dispatcher rechecks ownership, organization
access, preferences (including the master switch), and for `chat_needs_answer` that
the question is still open; a failed recheck cancels the candidate. Dispatch reuses
device registrations and APNs transport; the payload carries only the type, the
bounded sanitized thread title (≤ 80 characters), thread/run ids, an unread badge
count, and the deep link `overlord://chat/threads/:threadId`, never question,
answer, transcript, Knowledgebase, or repository content. `GET /api/chat/notifications`
returns the newest 100 dispatched, non-dismissed entries for the caller in the caller's
organization plus `unreadCount`; `POST /api/chat/notifications/:id/read` is
revision-checked (`stale_revision` on mismatch; repeating it at the current revision is a
no-op). Delivery acknowledgement never changes mission notification read semantics.
Acknowledgement details: a `seq` beyond the thread's last published event is
`invalid_request`; a lower `seq` keeps the stored value; an acknowledgement from a client
without live presence is recorded but suppresses nothing; `ChatAckDto` lists the ids it
suppressed. Presence and acknowledgement recheck live membership but run no upstream
source checks, since they publish no content. Dispatch details: the conversation types
join `GET`/`PUT /api/profile/notification-preferences` `preferences[]` on `apns`,
`realtime`, and `in_app` (the legacy `categories` alias stays mission-only); with the
master switch off, or both `apns` and `in_app` off, the candidate is `cancelled`; with
`apns` off but `in_app` on it is `dispatched` to history without a push; `silent` sends
a background push with no alert. Delivery is at-least-once: a claim holds a 60-second
lease, the APNs collapse id is `chat:<notificationId>` so a retried send replaces
rather than duplicates, a transient failure returns the row to `pending` with backoff,
and after `max_attempts` (5) it becomes `failed`. The home-screen badge on both mission
and conversation pushes is unread mission notifications plus unread dispatched
conversation notifications for the profile. The grace period and presence TTL are
operator-configurable through `CHAT_NOTIFICATION_GRACE_MS` and `CHAT_PRESENCE_TTL_MS`.

**Account connections.** `account_connections` is the single store for external
account connections (first provider: `knowledgebase`), one live connection per
`(owner, organization, provider, server_url)`, profile-owned within the organization,
recording server, authorized provider workspaces, tool-policy version, state
(`pending`, `connected`, `reauthorization_required`, `disconnected`), and an
AES-256-GCM credential envelope bound to the owner with a key id from server
configuration. Refresh is serialized per connection by a lease
(`refresh_lock_owner`/`refresh_lock_until`) and the rotated credential is persisted
before use. `GET /api/connections`, `POST /api/connections` (`{ provider, returnTo }` →
`{ connectionId, authorizeUrl, expiresAt }`), `DELETE /api/connections/:id`
(disconnect: revoke upstream best-effort, erase the envelope), and the public
`GET /api/connections/knowledgebase/callback` implement authorization code with PKCE
S256 and the RFC 8707 `resource` parameter; `account_connection_authorizations`
stores a hashed single-use `state` and an encrypted PKCE verifier bound to the
connection and an expiry. The client id is a Client ID Metadata Document served at
public `GET /oauth/clients/knowledgebase.json` (≤ 5 KB, no redirects, redirect URI is
the backend callback). The phone opens `authorizeUrl` in `ASWebAuthenticationSession`;
the callback redirects to a universal link (or the web return URL) carrying only a
status. Credentials, verifiers, codes, and state never appear in DTOs, logs, realtime,
change rows, or errors; the only client-visible URL carrying `state` is `authorizeUrl`
itself, where OAuth requires it (stored only as a hash, single use, 10-minute expiry).
The Everhour and GitHub credential stores are unchanged (coo:1110); they share only
the AES-256-GCM envelope primitive (`v1` format, their own AAD and keys). _(Superseded
by v153: both personal integrations move onto this module.)_

_Client integration (web and mobile, coo:1108.zb9x)._ `POST /api/connections` reuses
the caller's live connection for reauthorization (same `connectionId`) and allows at
most five open sign-ins per connection (`limit_exceeded`). It answers 503
`provider_not_ready` when the Knowledgebase or credential key is not configured, 400
`invalid_request` for another provider or `returnTo`, and 404 `chat_unavailable` on
Local. The callback finishes with a redirect carrying only `provider=knowledgebase`
and `status` (`connected`, `denied`, `expired`, or `failed`): mobile goes to
`overlord://connections/callback?…` (the `ASWebAuthenticationSession` callback
scheme), web goes to `<OVERLORD_WEBAPP_PUBLIC_URL origin>/settings/connections?…`, and
an unknown or replayed state gets a no-store status page. Clients treat the status as
a hint and reload `GET /api/connections`, which lists live (non-disconnected)
connections. `pending` means sign-in never completed. `reauthorization_required`
carries `lastErrorCode` (`invalid_grant`, `upstream_unauthorized`, `grant_expired`, or
`credential_unreadable`) and its credential is already erased; clients offer sign-in
again with `POST /api/connections`. `DELETE /api/connections/:id` returns the
`disconnected` DTO. Losing access by disconnect or reauthorization immediately
rechecks every thread that cited the connection, so that content is replaced by
`unavailable` blocks and live generations are fenced with `source_access_lost`.
Reconnecting never restores invalidated content. Server configuration:
`KNOWLEDGEBASE_MCP_URL`, `KNOWLEDGEBASE_EGRESS_ORIGINS`,
`ACCOUNT_CONNECTIONS_ENCRYPTION_KEY`, `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY_ID`. _(Since v156 every one of these is optional: the
standard server is the default and the platform key derived from `BETTER_AUTH_SECRET`
seals credentials when no explicit key is set.)_

**Outbound MCP and repository-read seams.** The backend's outbound MCP client
reaches only the configured Knowledgebase origin over HTTPS with server-side egress
rules, exposes only a reviewed read-tool allowlist namespaced per connection,
rejects writes regardless of annotations, and bounds output size and time; the
per-source access check is `get_related(node_id)` and any failure is treated as
revoked. Agent-facing repository reads (`observe`, `tree`, `branches`, `worktrees`,
`git_status`, `diff`, `read_file`, `search_text`; `RepositoryReadRequest` /
`RepositoryReadResult`) are local-target capabilities executed by the runner over the
existing mission-less capability-call queue with `operation_id` as the idempotency key.
`POST /api/projects/:id/repository-reads` is the authenticated mission-less route
(requires `project:read` and the caller's access to the named execution target) and
the in-process chat gateway calls the same service. Inputs are `executionTargetId`,
`projectId`, `resourceKey`, and repository-relative paths only; the capability call
carries the requested `resourceKey` to the claim, which resolves that resource instead
of the primary one. The target enforces containment including symlinks, excludes
credential and configured sensitive paths, disables external diff/textconv and hooks,
and never fetches, checks out, builds, or takes write intent. Defaults: 64 KiB file
reads, 128 KiB diff and search output, 100 search hits, 30 s timeout. The current diff
is one implementation co-located with `readCurrentDiff`; the mission-keyed declaration
shares or is replaced by it.

**Repository-read implementation details (coo:1108.zg8m, refines v152).**

- _Local-target interface._ `readCurrentDiff` is replaced in place by the
  resource-addressed form `{ resourceId, repoPath, scope, relativePaths?, maxBytes? }`
  (the mission-keyed form had no implementation and no caller). Three capabilities are
  added: `readGitStatus`, `readRepositoryFile`, and `searchRepositoryText`. All four
  are read capabilities on the runner queue (30 s deadline) and are not exposed through
  the desktop bridge. The commit-message diff (`generateCommitMessageFromLocalDiff`)
  builds its `git diff` from the same argument builder and hardened Git configuration,
  so there is one diff definition.
- _Target-side hardening._ Every inspection Git call runs without a shell, with
  `GIT_OPTIONAL_LOCKS=0` (no index refresh write), `core.fsmonitor=false`,
  `core.hooksPath` pointed at the null device, `diff.external` empty plus
  `--no-ext-diff --no-textconv`, every configured `filter.<driver>` neutralized,
  `protocol.allow=never` and `GIT_NO_LAZY_FETCH=1` (no fetch, including partial-clone
  lazy fetch), submodules ignored, and repository-steering environment variables
  (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_EXTERNAL_DIFF`, …) removed. Each
  call has its own timeout (20 s on the target), is killed on timeout, cancellation,
  or when captured output passes its byte bound, and never retries. Worktree dirtiness
  checks used by `listWorktrees` use the same hardened configuration.
- _Paths._ Inputs are repository-relative POSIX paths: absolute paths, drive or UNC
  prefixes, NUL bytes, `..` escapes, and any `.git` segment are rejected by the
  backend and again by the target. The target resolves the real path of both the
  resource root and the candidate and requires containment, so a symlink that leaves
  the resource is `denied`. Credential and sensitive paths (`.env` and `.env.*` except
  `*.example`/`*.sample`/`*.template`, `.envrc`, `.npmrc`, `.pypirc`, `.netrc`,
  `.pgpass`, `.git-credentials`, `.dockercfg`, private keys and key stores such as
  `id_rsa*`/`id_ed25519*` (not `.pub`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`,
  `*.keystore`, `*.kdbx`, `*.ppk`, `credentials*.json`, `service-account*.json`,
  `secrets.{json,yaml,yml,toml}`, `*.tfstate*`, anything under `.ssh/`, `.aws/`,
  `.gnupg/`, `.kube/`, or `.overlord/tmp/`) plus the target's comma-separated
  `OVERLORD_REPOSITORY_READ_EXCLUDE` globs are never returned as content: `read_file`
  answers `denied`, `diff` withholds their sections and lists them in
  `excludedPaths`, and `search_text` drops their hits. Their names may still appear in
  status and tree listings.
- _Results._ `RepositoryReadResult.data` is operation-specific and typed in
  `packages/contract/src/chat.ts` (`RepositoryGitStatusData`, `RepositoryDiffData`,
  `RepositoryFileData`, `RepositorySearchData`; existing reads keep their capability
  payloads, with tree entries capped at `maxEntries`, default 500, maximum 2000, and
  filtered to `relativePath`). Status lists at most 1000 entries per class; search lines
  are cut at 400 characters. `read_file` returns `binary` (NUL byte or invalid UTF-8)
  or `oversized` (more than 8 MiB) with size metadata only; within that ceiling it
  returns the requested 1-based inclusive line range bounded to `maxBytes`, cut at a
  line boundary, with `truncated`. Search is `git grep --fixed-strings` over tracked
  and untracked, non-ignored text files (binary files skipped). `diff` covers tracked
  files only (`unstaged`: worktree against index; `staged`: index against HEAD; `all`:
  worktree against HEAD, or against the empty tree before the first commit).
- _Route._ `POST /api/projects/:id/repository-reads` takes a `RepositoryReadRequest`
  body (the path `:id` must equal `projectId`) and answers 200 with a
  `RepositoryReadResult` for every target-side outcome, including `target_offline`,
  `timeout`, `unavailable`, `denied`, `binary`, `oversized`, and `not_found`. It answers
  400 `invalid_request` for a malformed body, 404 when the project is not readable or
  the execution target is not one the caller may use for it, and 409
  `operation_conflict` when an `operationId` is reused with a different request. The
  operation id must match `^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`; the queue key is
  derived from the acting workspace user and the operation id, so a retry waits on the
  original job and never re-queues it. A target whose runner is not live answers
  `target_offline` without queueing. At most four reads per scope (a chat run, or a
  caller for the route) are in flight; further reads wait for a slot within their
  deadline. A runner that predates these capabilities fails the job, which is reported
  as `unavailable`.
- _Runner completion._ `POST /api/runner/requests/:id/completed` accepts a JSON body of
  up to 1 MiB (every other JSON route keeps the 100 KB default), so a bounded read result
  and its envelope always fit. Tree reads are scoped (`subPath`) and capped
  (`maxEntries`) on the target before they cross the queue.

**Gemini research runtime and tool gateway (coo:1108.vx29, refines v152).**

- _Runtime adapter._ `backend/chat/` implements the worker's `ChatRuntime` with Gemini
  through `@google/genai` `models.generateContentStream` (function declarations as
  `parametersJsonSchema`). Configuration: `CHAT_GEMINI_API_KEY` (falls back to
  `GEMINI_API_KEY`), `CHAT_GEMINI_MODEL` (default `gemini-3.8-flash`), and
  `CHAT_MAX_GATHERED_BYTES_PER_RUN` (default 1 MiB of recorded tool results per run).
  Without a key the runtime reports `not_configured` and runs fail
  `provider_unavailable`; it never answers with fixed text. Provider errors map to the
  closed failure codes (429 `rate_limited`; 400 naming tokens/context `context_limit`;
  401/403/404/5xx and transport failures `provider_unavailable`; anything else
  `provider_error`). `GET /api/chat/providers` returns `ChatProvidersResponse`: one
  `gemini` readiness entry (`ready`, `not_configured`, `rate_limited` for 60 s after a
  429, or `unavailable` after a transport failure) and the caller's live account
  connections.
- _Checkpoint payload (schema 2)._ The private checkpoint holds only this run's provider
  turns, verbatim and unmerged (thought signatures, call ids, empty parts), the pending
  call batch (`turn`, per-call order, operation id `chat.<runId>.t<turn>.c<order>`,
  provider call id or a synthetic `t<turn>.c<order>` when the provider omits one), and
  the run's streaming message id. The conversation prefix (latest authorized summary
  and the messages it does not cover, with withheld content rendered as a marker; see
  _Summaries_) is rebuilt from storage on every provider request. The config digest
  covers the model, the versioned system prompt, context policy and relevance policy.
  Schema 2 also stores the selected family set and a manifest of the exact declarations
  offered for the pending signed turn (SHA-256 identity over canonical object keys and
  ordered declaration/schema arrays, including names, descriptions and effects). Resume validates this manifest and uses it for historical call
  validation and read/write scheduling, never as authority. Before each new request the
  authorized catalog is rebuilt from live connections; removed grants are still refused
  by the live gateway on the next call. Schema-1/digest-incompatible checkpoints take
  existing fresh-generation recovery; no signed turn is rewritten. Fresh-generation recovery sends no function-call parts; it adds this run's
  completed, still-authorized tool observations as untrusted text.
- _Tool catalog (fixed), relevance manifests (expandable)._ `overlord_list_projects`, `overlord_list_execution_targets`,
  `overlord_search_missions`, `overlord_get_mission`, `repository_read` (the eight
  `RepositoryReadOperation`s through the same core service as the REST route, scope
  `chat-run:<runId>`), the reviewed Knowledgebase reads of the owner's live connections,
  and `ask_user`. Declarations and descriptions are Overlord's; no tool creates,
  changes, launches, or queues work (proposal preparation arrives with Phase D). A call
  to an undeclared name answers `unknown_tool`; arguments are validated against the
  declared closed schema (`invalid_arguments`); every Overlord and repository read
  resolves the thread owner's live organization memberships and role grants at call
  time (`project:read` for projects, resources, targets and repository reads;
  `mission:read` for missions, objectives and deliveries) and answers `not_found`
  without revealing existence. Tool results reach the model wrapped as untrusted data.
  Results are bounded to 96 KiB of provider input.
  Backend may initially declare a deterministic subset of this fixed authorized catalog:
  stable families `status` (mission search/detail), `repository` (target discovery and
  repository reads), `knowledgebase` (reviewed connection reads and live-authorized
  writes), and `feature` (Knowledgebase plus exhaustive Feature lookup and mission detail).
  Project discovery, question and proposal preparation remain available in every manifest;
  connection workspace discovery remains available when authorized. No routing-model call
  is added. Unrecognized, ambiguous or referential requests use the full authorized catalog;
  cross-family requests take the union. A stored per-message write grant selects Knowledgebase.
  Always-available reviewed reads means available through expansion, not necessarily declared
  in every request. `expand_capabilities` accepts optional `families` from the four names
  plus `all`; empty/omitted lists discover current authorized capabilities and tool names.
  Expansion only widens relevance, never permission, and takes effect on the next request.
  Its complete signed call and receipt use the normal checkpoint-before-execute path, tool
  allowance, ordered join and raw diagnostics. Successful expansion receipts restore the
  family union even after a crash between receipt and join; duplicate execution is harmless.
  A call not in its historical manifest still returns `unknown_tool`, even when an expansion
  appears earlier in the same turn. Failed live catalog discovery contributes no connection
  tools. A per-message grant naming a workspace no longer in the connection's live
  authorized-workspace list contributes no write declarations; an all-workspaces connection
  with an empty authorized list contributes none either. Call-time checks remain unchanged.
  Full fallback means all currently authorized tools, never all possible permissions.

  **Module impacts (coo:1127.kaed).** Backend owns selection, expansion, manifest identity
  and private schema-2 payload validation. Core continues to store opaque checkpoints and
  execute ordered receipts with existing live authorization; no Core API change. Database
  uses existing JSON/version columns on both editions, without migration. REST/DTOs, Web,
  Desktop, Mobile, Auth, Protocol, CLI, MCP Server, Connector, Runner, Automations and
  extensions have no interface change. The outbound MCP client's live allowlist/scope policy
  is unchanged. This is an internal provider-policy refinement at contract v159; no stable
  public interface or closed storage vocabulary changes and no contract version bump.

- _Static-prefix cache (coo:1127.0904)._ Backend may place a tool-enabled request's exact
  static prefix in a Gemini explicit cache (`caches.create`, same Generate Content API
  family) and reference it with `cachedContent`. The prefix is only the exact system
  instruction, the request's exact function declarations and `functionCallingConfig.mode
= AUTO`; never conversation, summaries, tool results, source content, proposals,
  credentials or connection secrets. A `cachedContent` request carries no system
  instruction, tools or tool config (the provider rejects them), so tool-free closing
  (`NONE`) requests and summary generation are always sent inline.
  - _Hybrid use._ Only while the attempt's previous reported `promptTokenCount` (before
    any report: request bytes / 4) is below 16,000 tokens; larger requests go inline so
    implicit caching can cover the growing conversation. A cached request reports only
    the cache's tokens as cached and gains no implicit hits, so caching every request
    would raise cost on long runs. The cache never removes prompt tokens or context
    occupancy: the context budget still counts the cached declarations.
  - _Key and isolation._ SHA-256 over the owner's profile and organization, the model and
    the canonical static config. Caches are never shared across owners, even for
    identical manifests. A changed prompt, grant, connection, family or schema yields a
    different key; a cache is never used for a different manifest, and a cache reference
    never authorizes anything (every call still faces the live gateway checks; schema-2
    checkpoint manifests are unchanged).
  - _Lifecycle._ TTL 600 s; reuse only with at least 60 s remaining. A process-local,
    in-memory registry (no database state) holds at most 64 entries and 4 per owner.
    Creation is single-flight per key, never blocks a request (that request goes inline),
    is bounded to 15 s and is awaited by the creating attempt before it finishes, so its
    observation is durable. A failed creation suppresses that key for the TTL. When an
    owner exceeds 4 entries, the oldest of that owner's caches is deleted from that
    owner's attempt. A full registry skips creation. Caches left by a restart expire by
    TTL; a restart starts cold.
  - _Fallback._ A cached request refused at stream open with 400, 403 or 404, before any
    chunk arrives, invalidates the entry and is sent once inline with identical contents.
    Nothing is retried after a chunk arrives; transient-retry and rate-limit rules are
    unchanged, so no turn or tool call is duplicated.
  - _Digest, checkpoint and recovery._ The effective model input is identical with or
    without the cache, so the config digest, checkpoint schema 2 and fresh-generation
    rules are unchanged. The cache name is never stored in checkpoints, snapshots or
    events; a resumed attempt recomputes the key and reuses or recreates the cache.
  - _Diagnostics._ Owner-private and captured only in the triggering owner's thread:
    `provider.cache_create` (complete create config including the instruction and
    declarations, then the provider response metadata or original error),
    `provider.cache_delete` and `provider.cache_fallback`. A cached `provider.request`
    records the SDK request actually sent plus `staticCache` holding the cache name, key
    and the effective system instruction, declarations and tool config, so the effective
    input stays inspectable. `performance.attempt` adds cached-request and fallback
    counts. These are open diagnostic kinds.
  - _Configuration._ On by default with a configured key; `CHAT_GEMINI_STATIC_CACHE=off`
    disables it (any other value keeps the default). Explicit caches incur provider
    storage charges for their TTL.

  **Module impacts (coo:1127.0904).** Backend owns the SDK cache seam, registry, hybrid
  policy, fallback and capture. Core continues to store open diagnostic kinds and opaque
  checkpoints; no Core API change. Database: no table, column or migration on either
  edition. REST/DTOs, Web, Desktop and Mobile are unchanged; the existing owner-only
  diagnostic paging shows the new observations and ordinary snapshots never contain a
  cache name. Auth, Protocol, CLI, MCP Server, Connector, Runner, Automations and
  extensions have no interface change. `CHAT_GEMINI_STATIC_CACHE` is additive operator
  configuration. This is an internal provider-policy refinement at contract v159; no
  contract version bump.

- _Questions._ `ask_user` is a checkpointed call: reads in the same turn run first, the
  question opens through the existing question path (run `waiting_user`, notification
  candidate), and the answer becomes that call's recorded result when the run resumes
  from its checkpoint. One question per turn; extra `ask_user` calls answer
  `invalid_arguments`.
- _Evidence and citations._ Each tool result's sources become `chat_source_refs`
  (scope keys: `overlord:<entity>:<id>`, `repository:<target>:<project>:<resource>:<path>@<head>`,
  `knowledgebase:<connection>:<workspace>:<node>`), are checked live, and get one
  `chat_evidence` row each with a thread-local citation ref (`E<n>`) returned to the
  model. A source that does not check `authorized` withholds that result's content
  (`source_unverified`). The tool call's dependency set becomes the union of its
  request context and its sources. The answer's `[E<n>]` or `[E<n>, E<m>]` citations
  become the text block's `evidenceIds` and one `evidence` block (one entry per source,
  `stale` when observed more than 15 minutes before attachment); the message's
  dependency set includes the cited sources. Streamed text, questions, checkpoints and
  summaries use the conservative union of every authorized dependency set in the
  thread.
- _Summaries._ Once at least eight messages are not covered by the latest summary, the
  runtime writes a compact `chat_thread_summaries` row (goal text, decisions, open
  questions, evidence refs) from a plain-text transcript of authorized content; a failed
  summary never fails the run. Refined by coo:1127.158y:
  - _Coverage._ `covers_through_message_id` names the last message the generation
    actually read; the transcript is the previous usable summary plus the messages
    after its boundary, oldest first, cut at a message boundary when it reaches its
    size bound, so coverage never claims an unread message. Core resolves the boundary's
    position by storage order `(created_at, id)` even when it lies outside the latest
    100-message page; a boundary that cannot be resolved, or an absent, invalidated or
    unauthorized summary, means no coverage and the full authorized page is sent.
  - _Prefix selection._ With usable coverage, covered messages are replaced by the
    summary, except the run's trigger message, every message of the current run, and
    the four most recent messages, which stay verbatim. Proposal cards and creation
    receipts are supplied separately and never compacted; the current run's signed
    provider turns are never summarized or compacted. Omitting covered text never
    narrows dependencies: summaries, checkpoints, messages and questions keep the
    conservative thread union, and revocation invalidates the summary (falling back
    to authorized messages with `unavailable` markers) and fences as before.
  - _Generation._ A dedicated compact instruction (not the research prompt) treats
    the transcript as untrusted data and returns only the four fields under a bounded
    output (`maxOutputTokens` 2048, low thinking) with no tools. A response that is not
    complete (`finishReason` other than `STOP`), not valid JSON, or outside the field
    bounds (text 6,000 chars, 20 decisions, 20 open questions, 50 `E<n>` refs, items 500
    chars) is a failed optional summary: it is recorded privately, never stored and
    never replaces the last valid summary. The eight-message cadence is unchanged.
- _Source checkers._ `overlord` sources are `authorized` while the entity exists and the
  owner keeps the read permission on its project's workspace, else `revoked`;
  `repository` sources while the owner keeps `project:read` and the execution target
  stays eligible for that project (reachability is not access). Both are registered
  with the Knowledgebase checker through the connections module's composed
  `checkSource`.
- _Limits._ Before each provider request the runtime stops at the per-run tool-call
  limit, the gathered-content budget, or within one minute of the active-time limit; a
  function-call turn that would exceed the tool-call limit is discarded unexecuted (never
  checkpointed) and one tool-free request (`functionCallingConfig.mode = NONE`) writes the
  closing summary before the run completes `allowance_exhausted`.
- _Context budget (coo:1127.158y)._ Token budgets are counted in provider tokens, never
  characters. Before each tool-enabled request after the first of an attempt, the
  runtime projects its input as the previous exchange's reported `promptTokenCount`
  plus one token per two bytes of request growth. If the projection exceeds the model
  input limit minus a 65,536-token headroom, it stops gathering and ends through the
  same tool-free closing request and `allowance_exhausted` outcome (Continue starts a
  fresh run whose prefix uses the summary). The limit is `CHAT_GEMINI_INPUT_TOKEN_LIMIT`
  (default 1,048,576, the verified `gemini-3.8-flash` input limit; whole number
  131,072–2,097,152, otherwise the default). Without a reported usage the runtime sends
  the request and a provider rejection keeps the existing `context_limit` code. Context
  is never silently dropped to force a request through, and no new failure code exists.

**Verification and hardening (coo:1108.z77k, refines v152).** Found by the live
acceptance run (`planning/feature-plans/chat-agent-request-routing-acceptance.md`).

- _Operator limits._ Each is a whole number in its range; an unset, malformed, or
  out-of-range value keeps the default. A run records the limits in force when it was
  submitted, so a change applies to new runs only. `CHAT_MAX_TOOL_CALLS_PER_RUN`
  (default 60, 1–500), `CHAT_MAX_ACTIVE_MS_PER_RUN` (600000, 120000–3600000; the last
  minute is reserved for the closing summary), `CHAT_MAX_CONCURRENT_RUNS_PER_OWNER` (3,
  1–50), `CHAT_MAX_TARGET_READS_PER_RUN` (4, 1–4; the repository-read service admits four
  per run regardless), `CHAT_ATTEMPT_LEASE_MS` (30000, 5000–600000),
  `CHAT_NOTIFICATION_GRACE_MS` (5000), `CHAT_PRESENCE_TTL_MS` (30000),
  `CHAT_EVENT_RETENTION_MS` (604800000) and `CHAT_EVENT_RETENTION_COUNT` (5000), alongside
  the existing `CHAT_MAX_GATHERED_BYTES_PER_RUN` (1048576).
- _Knowledgebase tool ids_ are `kb_<12 hex>_<tool>` (see Backend → Outbound MCP). The
  dotted form was rewritten by the provider (`kb.<id>:<tool>`) and then refused as an
  unknown tool.
- _Progress labels._ `tool.updated.label` is one of a fixed set of display strings
  (`Listing projects`, `Checking machines`, `Searching missions`, `Reading a mission`,
  `Inspecting a repository`, `Preparing a proposal`, `Asking a question`,
  `Searching notes`, `Reading a note`, `Browsing notes`, `Unavailable tool`). A tool name
  chosen by the model is never echoed to clients. Clients treat the label as opaque text.
- _Project list tool._ `overlord_list_projects` returns the agent catalog once per
  workspace (`assignmentCatalogs`), not on every project. This is model-facing tool
  content, not a DTO.
- _Proposal preparation._ A refused `prepare_proposal` call carries a specific reason
  for the model (for example an unregistered resource key, an unsupported model, or a
  project with no registered resource). The reason is never part of an HTTP error body,
  and it never names a project the owner cannot use. A project without a registered
  resource cannot receive drafts from the assistant.
- _Transient provider failures._ A 500, 502, 503, or 504, or a transport failure with no
  status, is retried at most twice (after 0.4 s and 1.5 s) before any part of that turn
  has arrived, so nothing is persisted twice. Rate limits, configuration errors
  (401/403/404), and failures in the middle of a stream are not retried and fail the
  run with its closed code.
- _Termination._ On `SIGTERM` or `SIGINT` the backend stops its chat worker and
  conversation-notification dispatcher and then terminates with that signal. An
  interrupted attempt is reclaimed by another worker when its lease lapses.
- _Archived projects._ Create follows the existing mission-creation rule, which accepts
  an archived project; the assistant only lists active projects when preparing.

**Account deletion.** Every chat, connection, presence, acknowledgement, receipt, and
conversation-notification row cascades from `profiles` (and `organizations`), so the
existing account-deletion cascade removes them with the identity and no new
`RESTRICT` child is introduced. Missions created from chat survive; their
`created_from_chat_thread_id` soft reference may dangle.

**Impact.** Database adds the tables above, `missions.created_from_chat_thread_id`,
and the widened preference type check on both editions. Core owns the conversation,
dependency, proposal/receipt, and notification-candidate services. REST/backend owns
the routes, private replay, run scheduling, Gemini runtime adapter, outbound MCP
client, connections module, and conversation dispatch. Auth owns connection ownership
and credential envelopes. Runner and the local-target interface add the read
capabilities. Mobile and webapp add the client journey and must tolerate additive
DTOs; existing mission notifications, `NotificationDto`, `worker_jobs`, and their
dispatchers are unchanged. CLI, hosted MCP, connectors, extensions, and desktop
(beyond the shared SPA) are unaffected.

## [151]

Project automation tokens and mission creator attribution (coo:1093). A third
`USER_TOKEN` preset, `project_automation`, joins `full` and `mission_lifecycle`,
whose grants, issuance, CLI flags, and settings behavior are unchanged; OAuth
approval still issues the same `mission_lifecycle` token with the same workspace
consent flow and never acquires a project allowlist. The preset is persisted in a
new `user_tokens.scope` column (legacy rows backfill to `full` when they have no
scope rows and `mission_lifecycle` when they carry the existing grants) so the
three presets stay distinguishable if their grant lists ever diverge. Its grants
are `project:read`, `mission:read`, `mission:create`, `objective:read`,
`event:read`, `session:read`, `artifact:read`, `attachment:read`, and
`execution_request:read`, still intersected with the owner's live role grants.

A `project_automation` token requires a non-empty list of selected project ids at
issuance (`CreateUserTokenBody.projectIds`, rejected for every other preset),
stored in the new `user_token_projects` allowlist (`token_id`, `project_id`,
`created_at`, unique pair, same-organization and workspace-consent enforcement on
both editions). There is no all-projects setting, and selection is immutable: a
different selection is a new token. Issuance validates that the owner can
`project:read` and `mission:create` in every selected project, and derives
workspace consent from the selection: `user_token_workspaces` receives exactly
the workspaces that own the selected projects and `all_workspaces` stays false,
so existing consent enforcement hides every other workspace and the project
predicate only separates projects inside consented workspaces. `UserTokenDto`
additively exposes `projects` (id and current name; a deleted project drops out
and never widens access).

Authorization for this preset is default-deny at two layers. First, the `/api`
guard consults an explicit route allowlist (published below); any other route,
including every write except mission creation, returns 404 before a handler
runs, so an audit omission fails closed. Second, one reusable project-scope
check applies inside the allowlist: the selected project ids are loaded into the
request authorization snapshot at token authentication, and every project,
mission, objective, attachment storage key, agent request, or other
project-bearing lookup outside them returns 404 without revealing existence,
for UUID and display-id addressing alike. Account-wide lists (projects, project
missions, My Missions, inbox missions, search v1/v2/v3, activity feed, protocol
search and discovery), `/sync/changes`, SSE catch-up, and live SSE broadcast
filter by the allowlist before pagination and totals, and `project_id IS NULL`
change rows reach the preset only for individually audited non-project entity
types. Protocol `create` now checks `mission:create` against its target project
for every caller (its gate was previously null); for `project_automation` the
`--unassigned-to-project` / `--inbox` branch, `prompt`, `record-work`,
`add-objectives`, and every session, launch, queue, and project-management
command are denied before any row is written. Hosted MCP tools that dispatch to
those subcommands inherit the same outcome.

Route allowlist for `project_automation` (METHOD path; everything else under
`/api`, `/ext`, `/sync`, and `/realtime` 404s): `GET /api/authorized-workspaces`,
`GET /api/projects`, `GET /api/projects/:id`, `GET /api/projects/:id/statuses`,
`GET /api/projects/:id/tags`, `GET /api/projects/:id/missions`,
`POST /api/missions`, `GET /api/missions/:id`, `GET /api/missions/:id/objectives`,
`GET /api/missions/:id/events`, `GET /api/missions/:id/deliveries`,
`GET /api/missions/:id/artifacts`, `GET /api/missions/:id/context`,
`GET /api/missions/:id/file-changes`, `GET /api/search/v3`,
`GET /api/objectives/:id/attachments`,
`GET /api/storage/attachments/:storageKey` (the attachments bucket only),
`GET /api/stream`, `GET /realtime`, `GET /sync/changes`, `GET /mcp`, `POST /mcp`,
and `POST /api/protocol/:subcommand` for exactly `create` (project form only),
`load-context`, `search-missions` (alias `search`), `discover-project`
(`--project-id` form only; the working-directory form and the
`project_selection_required` choice list would name hidden projects),
`statuses`, `list-deliveries`, `attachment-list`, `attachment-download-url`, and
`auth-status` (plus `objective-changes` from version 165, a mission-read subcommand
gated by the same project predicate). `GET /api/meta`, legacy `GET /api/missions/search` and
`GET /api/missions/search/v2`, the `/api/agent-requests` and
`/api/agent-session-inputs` readers, protocol `read-context`, and every
`/ext/*` route are deliberately outside the list even where a grant would pass;
they may be added later only with the project predicate in place. `GET
/api/missions/:id` does not record `mission_status_seen` for this preset. No
`project_id IS NULL` change row reaches the preset: the audited non-project
entity-type list starts empty. No route on the list is widened for any other
caller. The full route-by-route audit is
`planning/feature-plans/project-automation-token-read-surface-inventory.md`.

Every mission created by a direct `out_` bearer request — REST `POST
/api/missions`, protocol `create`, hosted MCP — is stamped server-side in
`createMissionWithObjectives` with `missions.created_by_token_id` (a deliberate
soft reference with no foreign key, so token deletion never blocks or erases
mission history) and `missions.created_by_token_label` (a snapshot of the
token's label at creation). Neither field is accepted from a request body; a
later token rename changes only future snapshots; revoke and soft-delete leave
attribution readable; account deletion clears the snapshot with the owner's
other identifying text. Scheduled duplicates and other system-generated
missions never copy the source mission's token fields, and a `sess_` session
call inherits no bearer identity. `MissionDto` additively exposes
`createdByToken: { tokenId, label } | null`; `created_by_kind` keeps its
existing user value, the label snapshot being the "Created via token" display.
For this preset a create body without `assignedWorkspaceUserId` yields an
unassigned mission, `statusId` remains optional with the project default, and
webhooks are excluded (`webhook:*` is not granted). Impact: database adds the
column, table, and two mission columns on both editions; auth defines the preset
grants; core carries the project allowlist on the service context and stamps
attribution; REST/protocol/MCP enforce the allowlist and predicate; CLI adds
`--scope project-automation` with repeatable `--project`; webapp adds project
selection and prominent expiry to the token form and the creator caption to
mission surfaces. Desktop, runner, and mobile need only additive DTO tolerance.

## [150]

The Human Actions feed is removed (coo:1098). The Feed page no longer shows the
cross-workspace **Human actions** rail introduced in Version 136, the sidebar
Feed entry no longer carries an open-action count, and REST drops
`GET /api/human-actions` together with the rail-only `HumanActionsDto`,
`HumanActionItemDto`, and `HumanActionItemKind` types. Agents still report
`humanActions` in the delivery report, and the delivery card still renders them
with their `command`, `verify`, and `link` details; what is gone is the
cross-mission collection and the ability to mark a reported action done or
dismissed. The deferred-work decisions of Version 147 keep working from the
delivery card: the resolution pair moves to
`PUT` / `DELETE /api/deliveries/:deliveryId/deferred-work/:actionId/resolution`,
accepts only a deferred-work id (a reported human action id now 404s), and
returns the refreshed `DeliveryDeferredWorkItemDto` instead of a rail item.
`human_action_resolutions` is kept for those rows; a migration deletes every
resolution whose `action_id` is not a `deferred-work-*` id, since nothing can
show or change them any more. The `human_action_resolution` entity-change type
is unchanged and now invalidates only the mission's deliveries. Impact: webapp
drops the rail, its grouping model, and the human-actions queries; backend
replaces `human-actions.ts` with `deferred-work-resolutions.ts`; connector and
CLI guidance stops describing the rail but keeps asking for complete,
self-contained human actions because the delivery card still shows them.

## [149]

Live Activity content-state carries the pending blocking ask (coo:1083). The
APNs `liveactivity` `content-state` gains an additive `pendingAsk` object, or
`null`: `{ missionId, missionDisplayId, question, askedAt, agentRequestId }`.
It names the newest `ask` on one of the account's assigned missions that is
unanswered, unseen (`mission_status_seen.blocking_question`), at most three days
old, and whose objective is still `executing` or `pending_delivery`, matching the
activity feed's `blocking_question` rule. `question` is markdown-stripped,
condensed to one line, and capped at 140 characters; `askedAt` is Unix epoch
seconds like `updatedAt`; `agentRequestId` is present when the ask opened an
`agent_requests` row. `pendingAsk` is visible content and participates in the
content hash. Posting an ask, resolving its agent request, and marking a
mission's blocking question seen each enqueue the existing coalesced
`overlord.live_activity.dispatch.v1` refresh, so asks are pushed as transitions.
This deliberately admits one bounded question line into the Live Activity
payload — the single most useful thing the watchOS Smart Stack card can say —
while answer options, transcripts, objective instructions, and event payloads
stay excluded. Standard push notifications are unchanged and still carry no
question text. Impact: mobile `OverlordActivityAttributes.ContentState` decodes
`pendingAsk` leniently (absent or `null` means no ask), so older app builds
ignore the key and older servers keep updating newer builds; no REST route,
database shape, or permission changes.

## [148]

Objective launch context lists each attachment's authenticated HTTPS URL and an
`ovld protocol attachment-download-url --attachment-id <id> --output <path>`
command. The optional CLI-only `--output` flag downloads the attachment through
the CLI's existing authenticated backend client and writes it to a new local
file; it never exposes the user's token to the agent or places it in a URL.
Without `--output`, the existing URL response is unchanged. The hosted MCP
attachment tool keeps its existing authenticated URL behavior. No REST route,
database shape, or permission changes. Agents must use the CLI download command
or an authenticated MCP/client request; the URL alone is not a public link.

## [147]

Deferred work records how it was handled (coo:1045). A deferred-work item in a
delivery can be promoted into a new mission, added to the delivering mission as
a future objective, or dismissed, and every surface that shows the item — the
mission delivery card and the Feed's Human actions rail — now shows the same
handled state. `human_action_resolutions` gains nullable `outcome`
(`mission_created` \| `objective_added`) and `outcome_ref` (the created mission
or objective display id). `ResolveHumanActionBody` accepts optional `outcome`
and `outcomeRef`; an outcome is valid only for a deferred-work item with
`status: 'done'`, and `outcomeRef` requires `outcome` (400 otherwise).
`HumanActionResolutionDto` additively carries `outcome` and `outcomeRef`
(`null` for plain `done`/`dismissed` and older rows). `DeliveryDto` additively
carries `deferredWorkItems`, one `{ actionId, action, resolution }` per
`report.presentation.deferredWork` entry in the same order, using the same
stable deferred-work ids as `GET /api/human-actions`, so the delivery card can
resolve items through the existing `PUT`/`DELETE` resolution routes. Protocol
`list-deliveries` and MCP `overlord_list_deliveries` return the same additive
field. Promotion itself still uses the existing mission and objective create
routes; the resolution is recorded afterwards. No route, permission, or
realtime change.

## [146]

Queueing behind a running objective runs next (coo:1044). Version 131's rule
that every lazily created queue starts paused gains one exception: when adding
an objective creates its mission's queue and an earlier sibling in that mission
is already running (`executing` or `pending_delivery`, or `launching` with an
active execution request) and is not in any queue, that sibling is added ahead
of the new objective as a `running` entry linked to its latest execution
request, the same shape a direct Run of a queued objective produces, and the
new queue is created unpaused. The dispatcher never passes an in-flight entry,
and delivery removes the entry and ticks the dispatcher, so the queued objective
launches as soon as its predecessor delivers. Explicitly created queues, an
existing mission queue, a manual queue adopted by name, and an explicit
`queueId` keep the paused default. No route, DTO, flag, or database shape
changes; queue read projections simply show the in-flight predecessor.

## [145]

Latch agent launches now use its `agent-launch` extension when advertised by
`latch capabilities --json`: for Claude and Codex, the runner sends the actual
agent executable and arguments in `launch.argv`, declares `launch.agent`, and
uses `launch.login_shell` for interactive login shell setup and project
pre-launch commands. `launch.cwd` and `launch.env` retain their existing values.
Latch can therefore persist the harness identity and prepare the conversation
connector before starting the agent. An older Latch without this extension, an
unsupported agent, or an opaque pre-command wrapper keeps the prior shell
command launch. Existing Latch sessions retain their creation-time identity;
they are not retroactively upgraded. Direct and inline launches are unchanged.
No Overlord route, DTO, flag, or database shape changes.

## [144]

"Open in the background" delegated to Latch (coo:1025). The resolved launch
session's viewer additively carries `background` (boolean), projected from the
stored `TerminalProfile.background` rather than stored a second time; as in a
direct launch it is always `false` for the `chord` placement. It is frozen onto
the claim-time `launchSession` snapshot, and a snapshot frozen before this field
reads as `false` (foreground), which is what those runs did. The runner's viewer
open sends it explicitly as `latch open --background` or `--foreground`, never
relying on Latch's own `open.background` default, for the same reason `--as` is
explicit. The flag is gated on the `productVersion` from
`latch capabilities --json` (minimum `0.2609181007.0`): clap rejects unknown
arguments, so an older CLI is sent the pre-existing argv and opens in the
foreground. The mission-panel re-open is a deliberate user action and stays
foreground. No route, DTO, flag, or database shape changes; `viewer.openOnLaunch
= false` remains the way to launch into Latch with no window at all.

## [143]

Run Queue order and mission objective order are one sequence, and finished
queues retire themselves. Four behavior
changes apply to every Run Queue surface (REST, Protocol `queue-objective` /
`dequeue-objective` / `reorder-run-queue` / `reorder-future-objectives`, hosted
MCP and connector shims, and the legacy `autoAdvance` compatibility input); no
route, DTO, flag, or database shape changes.

1. **Enqueue cascades.** Queueing an objective also queues every objective that
   follows it in the mission (by position) and has not started — `draft`,
   `submitted`, or `future`, with instruction text, and not already queued. The
   followers join the same queue directly behind the queued objective, in
   mission order. The response is still the single `RunQueueEntryDto` of the
   requested objective. The core service accepts an internal `cascade: false`
   option; no external surface exposes it.
2. **Order writes through in both directions.** A queue reorder or move
   redistributes the mission's queued objectives, in queue order, across the
   position slots queued objectives already occupy; unqueued objectives never
   move. This replaces the Version 106 "queued span" rule, under which an
   unqueued objective between two queued ones stopped the queue order from
   reaching the mission. Conversely, `reorderFutureObjectives` now carries the
   new objective order into every queue holding that mission's entries: the
   mission's `waiting`/`blocked` entries keep the queue slots they occupy and
   are redistributed across them in objective-position order. In-flight entries
   and other missions' entries never move, and a changed queue requests a
   dispatch tick.
3. **Dequeue moves to the end.** Removing a queue entry whose objective has not
   started (`draft`, `submitted`, `future`, or a forced removal that reset
   `launching` to `draft`) moves that objective to the end of the mission's
   objective positions. Re-queueing appends it to the queue, so it stays last
   until a user moves it. Removal on completion, disconnect, or deletion leaves
   positions alone because executed objectives are ordered by their timestamps.
4. **Empty queues retire automatically.** Any non-default queue that has held
   an entry and no longer holds a live one is soft-deleted, whichever way its
   last entry left: removal, a move to another queue, the dispatcher's drop, or
   delivery completing the objective. This widens the Version 106 rule, which
   retired only mission-scoped queues and only on entry removal. A pristine
   queue — created by a user and never given an entry — is kept so an objective
   can be added to it, and the default queue is never retired. The dispatch
   tick also sweeps the project, so queues left empty before this version
   retire on their next tick. `removedEmptyQueueId` on the entry DELETE response
   now reports any retired queue, not only a mission-scoped one. Clients must
   tolerate a queue id disappearing from `ProjectRunQueuesDto` after any entry
   mutation or delivery.

Impact on other modules: the webapp mission panel drops its drag-across-the-
queue-boundary enqueue/dequeue prompts and treats every future-objective drag as
a mission reorder; it also accepts server-side order changes whenever no local
reorder is pending. The dispatch worker, runners, CLI, MCP, connectors, desktop,
and mobile consume the same DTOs and need no change; agents calling
`queue-objective` should expect later siblings to become queued as well.

## [142]

The Human Actions rail renames its `blocking_question` item kind to
`blocking_action`. A `HumanActionItemDto` whose source `HumanActionV1` carries
`blocking: true` is a required follow-up step (the delivered work does not
function until a person completes it), not a question the agent asked. Blocking
questions remain exclusively `ask` mission events, surfaced by the activity
feed's `blocking_question` item kind and the mission `blocking_question` status
indicator; both are unchanged. `HumanActionItemKind` is now `follow_up`,
`blocking_action`, or `deferred_work`. Open ordering (blocking actions first,
deferred work second, follow-ups last), the `blocking` field, and
`counts.blocking` are unchanged. The webapp labels these items "Required before
this works". Clients matching `kind === 'blocking_question'` on
`GET /api/human-actions` must match `blocking_action`. No database, route, or
delivery-report change.

## [141]

Agent-created work now requires deliberate project routing (coo:981). Protocol
`create`, `prompt`, and `record-work` no longer infer a project from the current
directory or other discovery. A normal mission/objective creation supplies an
explicit `--project-id` (or MCP `projectId`); non-executing Protocol `create`
may instead supply the explicit `--unassigned-to-project` intent flag (with
`--inbox` retained as its compatibility alias) to create the account-owned inbox
item. Hosted MCP `overlord_create_mission` mirrors this with
`unassignedToProject: true`; the dedicated `overlord_create_inbox_item` tool is
already explicit intent. `prompt` and `record-work` cannot create inbox items,
so they reject an omitted project reference. This removes accidental inbox
submissions while retaining intentional unassigned capture. No database, REST,
or response-shape change.

## [140]

Deferred work is narrowed to recommended new objectives outside the current
mission (coo:986). Agent instructions, compose-delivery, and persistence now
treat `deferredWork` as suggested future work that is not already queued on
this mission — out-of-scope bugs are the canonical example — and omit leftover
slices of the current objective and human implementation follow-up (those stay
in `humanActions`). `agentReport.deferredWork` is still never rewritten.
`presentation.deferredWork` is the eligible subset: persist-time filtering
drops items that restate planned sibling objectives, leftover current-objective
work, or human/deterministic follow-up, and compose rewrites only that eligible
list. Core reconciliation still refuses to shorten or drop remaining eligible
items; extras are kept only when they also pass eligibility. Feed-rail
deferred-work ids match the original agent-report index rather than the
presentation index, so omitting an earlier ineligible item does not reattach a
resolution to a different statement. No schema, route, or DTO change.

## [139]

Run Queue recovery is now a transactional safety boundary (coo:977). Forcing
an entry removal pauses its containing queue before its removal can enqueue a
dispatch tick. Likewise, disconnecting an objective from `launching`,
`executing`, or `pending_delivery` back to `draft` or `submitted` pauses its
containing queue in that same transaction. The existing force-removal and
objective-update authorizations remain unchanged; this is the narrow automatic
pause exception to user-initiated queue-definition pause/resume, and prevents a
recovery action from immediately launching the following entry. Existing queue
and objective response shapes are unchanged.

The same version enriches deferred work for objective creation (coo:986). The
compose-delivery automation now asks the model to rewrite each agent-listed
`deferredWork` item as a standalone objective statement (imperative, naming the
component and data involved, and stating what was delivered and why the piece
was left), resolving delivery-local references from the summary, objective
instruction, change rationales, and recent events, and it may add an item only
when the summary explicitly states work was left undone. Core reconciliation
guards the result: a draft item replaces its agent source only when it is at
least as detailed, a draft that drops items leaves the agent list untouched, and
extra items are kept within the existing bound. `agentReport.deferredWork` is
never rewritten; only `presentation.deferredWork` changes. No schema, route, or
DTO change.

## [138]

Deferred delivery work joins the cross-workspace Human Actions rail (coo:971).
`GET /api/human-actions` now projects both `presentation.humanActions` and
`presentation.deferredWork` from each qualifying delivery. Every
`HumanActionItemDto` carries an additive `kind` (`follow_up`,
`blocking_question`, or `deferred_work`); deferred strings receive stable
delivery-local action ids derived from their text and duplicate occurrence, use
the existing done/dismiss resolution lifecycle, and contribute to the additive
`counts.deferred` total. Open ordering is blocking questions first, deferred work
second, and regular follow-ups last, newest delivery first within each kind. The
webapp uses the established amber and violet treatments for blocking questions
and deferred work respectively. A deferred item can create a new mission with
the item as its first objective in the associated project; the client omits
`statusId`, deliberately applying that project's default status, and marks the
source item done after creation. No database or new route change.

## [137]

Complete, actionable human actions (coo:963 follow-up). `HumanActionInputV1`
gains three optional fields that survive normalization, composition, and
persistence into `HumanActionV1`: `command` (the exact command, setting, or
value to apply), `verify` (how the operator confirms it worked), and `link` (an
HTTP(S) URL or repository-relative file path; other URI schemes are rejected and
the item discarded with a warning). `HumanActionItemDto` from
`GET /api/human-actions` projects them as nullable strings, and the webapp
renders them in the Feed rail and the delivery card. `reason` and `category`
are now documented as expected on every reported action across the connector
skill, protocol help, agent-protocol docs, and both MCP tool descriptions, with
a worked example of a vague versus a complete action. The compose worker's
deterministic path-derived candidates (migrations, `.env` examples, deployment
configs, dependency manifests, and now GitHub Actions workflow files) always
land in `presentation.humanActions` as `deterministic_rule` items, appended
after agent and composed actions and deduplicated by id, whether the model
cites them or not and whether composition succeeds, falls back, or has no
provider; each carries the triggering path as `link` and `sourceRef` and a
generic `verify` step. No database change.

## [136]

Human follow-up actions collected across missions (coo:963). Agents have reported
`humanActions` in the delivery report since Version 15, but each list was visible
only inside its own delivery card. REST now owns a cross-workspace read,
`GET /api/human-actions`, that projects the `presentation.humanActions` of the
latest delivery of every objective delivered in the last 90 days as
`HumanActionItemDto` records with mission/objective context, and a resolution
pair, `PUT` / `DELETE /api/human-actions/:deliveryId/:actionId/resolution`, that
marks one action `done` or `dismissed` (or reopens it) with `mission:update`. The
Database Layer adds `human_action_resolutions`, keyed on the delivery and the
stable action id inside its presentation, so the delivery report remains the
sole source of the action text and a resolution survives asynchronous
composition. Mutations emit `entity_changes` rows with the new open-vocabulary
`entity_type` value `human_action_resolution`, which the webapp routes to its
human-actions and mission-deliveries queries. The webapp Feed page grows a
left-hand rail listing open actions grouped by mission and objective, and the
sidebar Feed entry carries the open count.

## [135]

Agent assignment on the objectives a mission is created with (coo:959). The
per-item `agent` / `model` launch selection that Protocol `add-objectives`
accepted since Version 111 now also applies on `create` and `prompt`, and REST
`CreateMissionBody.objectives[]` carries the same two optional fields. All three
agent surfaces additionally accept `--objective-agent` / `--objective-model`,
which seed only the items that name no `agent` of their own; `--objective-model`
without an agent is rejected, as is a per-item `model` without one. These flags
are deliberately distinct from `--agent`, which records creation provenance on
`create` and names the attaching agent on `prompt`. Hosted MCP
`overlord_create_mission` (mirrored by the connector shim) exposes the same
`agent` and `model` inputs. Omitted fields keep the existing project
launch-preference defaulting, so an unassigned create behaves exactly as before.
The change closes the gap that forced an agent to create a mission and then
append a second objective solely to name an agent.

## [134]

Mission evidence list reads stop truncating silently (coo:955).
`GET /api/missions/:id/deliveries` and `GET /api/missions/:id/file-changes` still
return at most 200 newest-first rows, but the JSON is now a page envelope
`{ items, total, limit }` rather than a bare array: `items` is the bounded page,
`total` is the matching row count before the cap, and `limit` is the applied
page size (currently 200). Clients distinguish a complete history from
"the newest 200 of N". Protocol `list-deliveries` / MCP `overlord_list_deliveries`
use the same `MissionDeliveriesDto` envelope. DTO row shapes, authorization,
ordering, and the 200 cap are unchanged.

## [133]

Objectives record an explicit run boundary (coo:879). `objectives` gains a
nullable `reopened_at` timestamp, stamped by the objective update transaction
whenever an objective that has already executed — state `executing`,
`pending_delivery`, or `complete` — is set back to `draft`. It is last-wins:
each reopen overwrites it, so it always marks the start of the objective's
latest run. `ObjectiveDto` additively exposes it as `reopenedAt`, null for an
objective that has never been reopened. A follow-up re-attach after delivery
(`pending_delivery` without passing through `draft`) is not a reopen: those
deliveries belong to the same run.

Clients group an objective's deliveries, terminal sessions, and file changes
into runs by comparing each row's own timestamp against `reopenedAt`: rows at
or after it are the latest run, rows before it are earlier runs. Inferring
run boundaries from delivery order remains only as the fallback for objectives
whose `reopenedAt` is null, so rows that predate the column keep rendering as
they did. `completed_at`, `started_at`, `launched_at`, and every evidence table
are unchanged; setting an objective back to draft still deletes nothing.

## [132]

Board surfaces bound their finished-mission history (coo:941). `complete` and
`cancelled` missions accumulate forever, so `GET /api/projects/:id/missions` and
`GET /api/workspace/my-missions` now return only those whose `updated_at` falls
inside a rolling 21-day window, and both accept an additive
`includeAllCompleted` query flag that lifts it. Missions of every other status
type are never windowed, and neither response shape, ordering, nor
authorization changes: this bounds how many rows a board request can return,
not what a row contains. `updated_at` stands in for a completion timestamp
because the schema carries none; the window is served by the existing
`idx_missions_project_status_updated` index.

The status-change response (`PATCH` of a mission's status, which returns the
target column) is unwindowed, so a terminal column returned there still holds
its whole history. Clients that need the full archive send
`includeAllCompleted=1`: the webapp's per-column "show older missions" control
and its calendar view, which scrolls into past months, and the mobile app's
equivalent per-section control and calendar view. A client that sends nothing
sees the window; this is the one behavior change existing REST consumers
observe.

## [131]

Run Queue launch is user-controlled. Every newly created queue — whether
created explicitly or lazily for a mission's first queued objective — starts
paused, and adding or moving entries does not implicitly resume it. A queue
begins dispatching only after a user resumes it from the Run Queue interface or
directly launches one of its queued objectives. Direct Run keeps its existing
execution-request semantics and `execution_request:create` authorization, but
also resumes the containing queue in the same transaction so later entries can
advance; explicit queue pause/resume remains a queue-definition mutation that
requires `project:update`. Existing active queues retain their state.

## [130]

Agents can now perform explicitly confirmed, all-or-nothing bulk soft deletion
through `ovld protocol delete-missions --mission-ids-json|--mission-ids-file …
--confirm` and `delete-objectives --objective-ids-json|--objective-ids-file …
--confirm`. Each accepts one to 100 unique UUID or display-id references,
preflights every target and its authorization before writing, and returns the
deleted IDs. Mission deletion retains the existing cascade to live objectives;
objective deletion retains the existing Run Queue cleanup. `--confirm` is a
deliberate destructive-action gate: agents must first show the resolved list to
the user and receive an affirmative response before issuing either command.

Hosted MCP and the local connector shim add matching destructive tools,
`overlord_delete_missions` and `overlord_delete_objectives`, with a required
`confirm: true` input and destructive safety annotation. They forward only to
these Protocol operations, share their RBAC and transactional semantics, and
must not access mission or objective tables directly.

## [129]

`RunnerQueueProvider` is a working transport (coo:833 Phase B). Every
`LocalTargetCapabilities` method — not only the two branch/worktree mutations —
now reaches an execution target the backend is not co-located with, by queueing
an `execution_requests` row with `requested_source = 'local_target_mutation'`,
awaiting the `CapabilityResult` the runner stores, and returning it with
`transport: 'runner_queue'`. The runner dispatches generically over the
capability name against a closed allowlist and fails an unknown or excluded name
with the new `LOCAL_TARGET_UNSUPPORTED`; `launchAgent` is excluded and keeps its
own claim path, so a launch and a queued job can never race for one request. A
caller whose deadline passes gets the new `LOCAL_TARGET_TIMEOUT`, which means
"still running on that target" — never "failed", and never a reason to re-queue.

`execution_requests.mission_id` / `objective_id` become nullable **only** for
`requested_source = 'local_target_mutation'`, enforced by a CHECK in both
dialects, so a capability call with no mission (a Latch probe, a repository read,
`doctor`) no longer has to invent one; such a row is authorized by `project_id` +
`execution_target_id`, and `ExecutionRequestDto.missionId` / `.objectiveId` are
nullable to match. `LocalTargetMutationKindDto` gains `capability_call`.
`POST /api/runner/requests/:id/completed` accepts a result for any queued
capability, and the runner reports typed failures through it rather than through
`…/failed`, so the waiting caller receives the code and message.

New capability `sendLatchMessage({ providerSessionId, operationId, text,
waitForIdleMs })` delivers one user turn into a running Latch session and returns
Latch's `accepted | refused | ambiguous`. Its body is Overlord's first native
client of Latch's v2 Conversation Hub (the surface v108 reserved): the target's
in-process provider reads `GET /v2/capabilities`, requires protocol major 2 with
`endpoints.conversation`, opens `WS /v2/sessions/{providerSessionId}/conversation`
and sends one `send_message` quoting the `operationEpoch` from the server-first
snapshot. The gateway is dialed **only** over loopback — `LATCH_GATEWAY_URL`
(default `http://127.0.0.1:4610`) must name a loopback host, and the bearer comes
from `LATCH_GATEWAY_TOKEN` or `latch serve`'s token file
(`LATCH_SERVE_TOKEN_FILE`, else `$LATCH_HOME/serve.token`) — because that token
carries the `control` grant. Overlord never takes the session's terminal surface:
the conversation channel is not an attach. A reachable gateway that declines is a
_successful_ call carrying `refused` (with Latch's `state.sendMessage.reason`); a
busy `starting`/`working` session is waited out for `waitForIdleMs` (default 30s)
and then refused; anything unconfirmed after the send is `ambiguous` and is never
resent. Only an unreachable, unauthenticated, or conversation-less gateway is a
capability failure. Answer
delivery queues it with `operationId = agent_requests.id`, which is both Latch's
idempotency key and the row a completion post-hook records against
(`accepted → applied`, `refused → not_applied`, `ambiguous → unknown`; a timeout
leaves `emitted`).

`PurgeMergedWorktreesInput` additionally accepts `{ discover: true,
primaryRepoPath, worktreeRoot }`: a control-plane caller has no filesystem, so it
names the repository and the target decides which of its worktrees are merged and
clean. Backend branch-action and worktree routes resolve a provider from the
registry instead of branching on "co-located only"; the backend is still never a
local target, so `LOCAL_FILESYSTEM_UNAVAILABLE` continues to be what a caller
gets when no target can serve the work.

`ovld protocol ask` now creates an answerable `agent_requests` row when the
attached session has a bound channel, links its id from the `ask` event payload,
and supports bounded structured options plus an explicit no-free-text choice
mode. `AgentRequestDto.delivery` is the sole answerability projection:
`latch` when a live Latch provider session on a reachable target can receive the
answer, otherwise `read_only` with one of `no_latch_session`,
`latch_session_exited`, `target_offline`, or `request_closed`; it also projects
the application state and observation time. Human `POST /api/agent-requests/:id/resolve`
is restored only for `question` and `choice`, retains revision CAS and native
permission/retry retirement, validates text/options against the request, and
fails `409 request_not_deliverable` unless delivery mode is `latch`.

`mission_events.type` gains `answer`, a closed-vocabulary addition migrated in
both dialects. Resolving a deliverable question records an `answer` mission event, returns its
agent session to `execute`, clears the blocking-question seen marker, enqueues
`mission.unblocked`, marks delivery `emitted`, and uses `sendLatchMessage` on
the resolved target. Feed question items additively expose `agentRequestId` and
delivery mode; an ask with a later matching answer is no longer unseen.

## [128]

Missions no longer get stuck on a worktree or branch that no longer exists
(coo:863.25he). Branch checkout resolution is one rule shared by the branch
actions (`POST /api/missions/:id/branch/action`), the local-target branch
observation, and Runner Layer branch preparation: use the recorded worktree when
it still exists on the branch, else whichever checkout git reports for the
branch — the primary repo or another linked worktree — and only the runner then
creates a fresh checkout. `MissionBranchDto.worktreePath` keeps its shape but,
once a local target has observed the branch, is `null` when the branch is
checked out nowhere on that device instead of echoing the canonical worktree
path. Switching a mission to another branch (`PATCH /api/missions/:id` with
`branchOverride` and `resetActiveBranch`) is available for a prepared branch of
any status, not only a merged one; the following objectives run on the chosen
branch. The `BRANCH_WORKTREE_MISMATCH` branch-action error is retired — a
worktree on another branch simply is not that branch's checkout.

## [127]

Inbox archived-project exclusion (coo:858.nvx7). `GET /api/inbox/missions`
now excludes every mission and objective belonging to an archived project. The
cross-workspace Inbox remains authorized by active organization membership and
`mission:read`, but only active projects contribute cards, regardless of an
otherwise qualifying `agent_next`, `overdue`, or `due_soon` reason. The
profile-owned `/api/inbox` capture surface is unchanged.

## [126]

Worktree/branch automation is a user preference, not a workspace setting.
`worktreeBranchAutomationEnabled` moves out of `workspaces.settings_json` into the
acting profile's launch-session defaults: `LaunchSessionDefaultsDto` and
`UpdateLaunchSessionDefaultsBody` gain the field, and `PATCH …/launch-settings/
worktree-branch-automation` becomes an alias for the session-defaults update. The
top-level `LaunchSettingsDto.worktreeBranchAutomationEnabled` and
`MissionBranchDto.worktreeAutomationEnabled` keep their shape but now mirror the
user default, so the value is identical across every workspace the user belongs
to; the workspace id on the launch-settings routes only selects the authorizing
membership. Previously stored workspace values are not migrated — users re-enable
the toggle once.

## [125]

File-change capture gains additive, metadata-only recall paths without reintroducing
VCS-delta reconciliation or delivery gates. Connector-owned codecs may declare
bounded exact path fields and bounded unified-patch header fields; every extracted
path is reduced locally to an objective-bound `declared_edit` / `direct` ledger
observation. The raw patch, command, native payload, and file content remain local
and are never synchronized.

Protocol `update` and `deliver` add the optional `--paths` input. It accepts a
bounded comma-separated list of agent-known generator, migration, or script outputs
and appends the same objective/session ledger evidence before the normal lifecycle
request. It is advisory, applies `.overlordignore`, is never inferred from a VCS
delta, and cannot block update or delivery. Connector prompts may mention it only
as an optional escape hatch for generated outputs, never as an instruction to
enumerate all changed or opened files.

## [124]

Inbox overdue triage (coo:858.cbw0). `GET /api/inbox/missions` additively unions
a third slice: missions of any creator whose `dueDatetime` is before today in
UTC and whose status type is neither `complete` nor `cancelled`.
`InboxMissionReason` additively includes `overdue`. Overdue rows now lead the
response ordered by due date descending — most recently missed first — followed
by the due-today/tomorrow rows soonest-first and then the agent-Next rows
newest-first, with the overdue slice capped independently at 60. `overdue` and
`due_soon` are mutually exclusive because the windows do not overlap; a mission
that is both overdue and agent-Next is still one card carrying both reasons. No
other Inbox behavior changes and profile-owned `/api/inbox` capture is
unchanged.

## [123]

Inbox due-soon triage (coo:858). `GET /api/inbox/missions` additively unions
missions of any creator whose `dueDatetime` falls on today or tomorrow (UTC day
boundaries, matching the noon-UTC anchor the due-date picker writes) with the
existing agent-authored status-type-`next` rows. Missions in a `complete` or
`cancelled` status type are excluded from the due-soon slice. `InboxMissionReason`
additively includes `due_soon`; a mission that qualifies both ways is one card
carrying both reasons. Due-soon rows lead the response ordered by soonest due
date, then agent-Next rows newest-first, with each slice capped independently at 60. No other Inbox behavior changes and profile-owned `/api/inbox` capture is
unchanged.

## [122]

Run Queue waiting vs. blocked (coo:854, all three phases). `run_queue_entries` gains
nullable `waiting_reason` and `waiting_on_objective_id`, projected additively as
`RunQueueEntryDto.waitingReason` / `waitingOnObjectiveId` and on
`ObjectiveDto.queueEntry`. The four entry states are unchanged, but `blocked`
and `waiting` are narrowed and no longer overlap: `blocked` means a human must
act (`blockedReason` is `no_instruction`, `no_agent`, `dispatch_failed`, or
`request_failed`, optionally followed by `: <detail>`), while `waiting` means
eligible or held on a condition that clears by itself
(`waitingReason` is `mission_busy`, `resource_disconnected`, or `retry_pending`,
and `null` for simply next in line). `waitingOnObjectiveId` names the sibling a
`mission_busy` entry is queued behind. Two further additive read-only fields
serve the UI copy: `waitingOnObjectiveDisplayId` (the display id of
`waitingOnObjectiveId`, so a surface can name the sibling without a second
lookup) and `attemptCount` (dispatch attempts already spent, ceiling 3), both on
`RunQueueEntryDto` and `ObjectiveDto.queueEntry`.

The dispatcher re-evaluates **both** `waiting` and `blocked` entries on every
tick, so a hold is released as soon as its cause is gone with no queue mutation
and no human intervention; previously only `waiting` entries were reconsidered
and a `mission_busy` hold written as `blocked` was permanent. It also honours
`missions.allow_parallel_objectives`, which it previously ignored, using the
same sibling-lock predicate as the direct-Run path.

New dispatcher guarantee: a serial mission (`allowParallelObjectives = false`)
has at most one dispatched/running Run Queue entry across all queues in the
project; a parallel mission has no such limit. When two queues hold objectives
of one serial mission, the lower-positioned queue dispatches and the other waits
with `mission_busy`, proceeding on the tick after the first delivers.

An entry whose objective is complete or deleted is dropped from any
non-in-flight state, and a retry of an objective wedged in `launching` with no
active execution request resets it to `draft` so the relaunch can proceed.

Retry semantics are explicit. A dispatch that throws, and an execution request
that reaches `failed`, `expired`, or `cleared` before the agent attached, both
return the entry to `waiting` with `waitingReason = 'retry_pending'`, release
`executionRequestId`, count the attempt, and enqueue a dispatch tick;
`blocked` with `dispatch_failed` / `request_failed` is raised only once the
attempt count reaches the dispatcher's ceiling (3). The additive
`PATCH /api/run-queues/entries/:entryId { retry: true }` body, the
`retry-queue-entry` Protocol subcommand, and the `overlord_manage_run_queue`
`retry_entry` action clear a hold and reset the attempt budget; all three
require `execution_request:create` and refuse an entry already dispatched or
running. `retry` may not be combined with a move in the same PATCH.

Dispatch is now also triggered by the events that change a hold's cause:
execution-request failure/expiry/clear, an objective leaving the queue, an
objective PATCH that changes `assignedAgent`, `instructionText`, `state`, or
`resourceKey` while it has a live entry, a mission PATCH that toggles
`allowParallelObjectives`, and a runner reconnect. The 60-second sweep is a
safety net rather than the primary release mechanism.
`createExecutionRequest` refuses a `requested_source = run_queue` request that
would give a serial mission a second active objective
(`objective_sibling_active`, 409), making the dispatcher guarantee above
database-enforced rather than a planner convention. No runner wire change.

Every Run Queue surface now reads a hold from one shared vocabulary: `waiting`
is neutral and names what it is waiting for ("Waiting for coo:854.9hm5 to
finish", "Retrying (2/3)"), while only `blocked` is amber and states the action
its `blockedReason` asks for ("Assign an agent", "Add instructions",
"Launch failed 3× — Retry" with a Retry control). This is presentation only; the
DTO fields above are the sole input.

## [121]

Delivered missions return to the Feed (coo:826.mnds). `GET /api/activity-feed`
additively accepts `before` (ISO-8601 UTC) and returns `nextBefore`. The first
page is live work plus delivered missions whose most recent
`deliveries.delivered_at` is within the past 14 days; `before` loads the next
older 14-day window of delivered missions only and omits live runs and
questions. `ActivityFeedItemKind` additively includes `mission_delivered`. A
delivered mission is the same `ActivityFeedMissionItemDto` as a live one, keyed
`mission:<missionId>`, with `runState: 'delivered'` and empty
`activeObjectiveIds`. A mission that is currently launching, executing, or
pending delivery is never also a delivered card. Order is launching, then
executing, then blocking questions, then delivered. Raw delivery payload JSON
remains unexposed; `GET /api/missions/:id/deliveries` is unchanged.

## [120]

Inbox mission triage (coo:844). `GET /api/inbox/missions` now returns only
agent-authored missions in status type `next`. The v117–v118 recent window —
which still surfaced human-created non-Next missions — is removed. Unallocated
profile-owned captures remain on `/api/inbox`. The additive `recent` reason is
retained only as a UI label for agent-Next rows created within the rolling
7-day window.

## [119]

Mission-anchored Feed (coo:826.kkg4). `GET /api/activity-feed` is now a
projection of missions rather than objectives, and its item vocabulary is
breaking: `ActivityFeedItemKind` is `mission_run` \| `blocking_question`. The
`objective_run` and `delivery` kinds, `ActivityFeedRunItemDto`,
`ActivityFeedDeliveryItemDto`, and `ActivityFeedQueuedObjectiveDto` are removed.
A mission with live work is one `ActivityFeedMissionItemDto` keyed
`mission:<missionId>`, carrying every objective of that mission as
`ActivityFeedMissionObjectiveDto` in mission-panel display order, the ids of the
objectives that are live in `activeObjectiveIds`, and a `runState` of
`launching` \| `executing`. Items are grouped rather than purely
time-descending: launching missions, then executing ones, then blocking
questions, newest-first within each group. Deliveries no longer appear on the
feed at all — finished work is read through
`GET /api/missions/:id/deliveries`, which is unchanged.

## [118]

Inbox Next triage (coo:826.yb2y). `GET /api/inbox/missions` still returns the
v117 recent + agent-Next union, but status type `next` is agent-authored only:
human (and other non-agent) Next missions are never included via the recent
window. The recent window continues to include non-Next missions of any
creator. Profile-owned `/api/inbox` capture routes are unchanged.

## [117]

Inbox mission triage (coo:826). Additive read-only `GET /api/inbox/missions`
returns a bounded cross-workspace `InboxMissionsResponse` for the Inbox page:
missions created within the past 7 days, unioned with agent-authored missions
whose status type is `next`, across every workspace the caller may
`mission:read` in the active organization (same membership rule as the activity
feed and My Missions). Each `InboxMissionDto` extends `MissionDto` with
project name/color and `reasons` (`recent` and/or `agent_next`). Profile-owned
`/api/inbox` capture routes are unchanged.

## [116]

Phase 5 is an immediate, breaking cutover to objective-ledger change tracking.
Protocol `update` no longer accepts changed-file payloads. Protocol `deliver`
accepts only its required summary plus current optional annotations
(`changeRationales`, artifacts, and `deliveryReport`); changed-file,
observed-dirty-path, no-file-change, and rationale-skip inputs are removed from
CLI, REST, MCP, service, help, and connector instruction surfaces. `record-work`
retains explicit `changedFiles` because it records already-completed work and has
no attached execution target capable of producing a ledger.

File-backed Protocol inputs use the per-flag `fileInputs` envelope exclusively.
The retired shared `stdin` payload is removed; a literal `--*-file -` is resolved
by the CLI into that flag's own `fileInputs` entry before transport.

The retired mission-scoped VCS baseline, touched-file log, transcript-derived
rationale notes, peer-claim arbitration, and `fallback_delta` evidence path are
removed. A connector PostToolUse callback may append `declared_edit` evidence
only when the connector-owned codec normalizes the event as `file.edited` and
produces a bounded path inside the explicitly addressed objective workspace.
Known read-only callbacks are silent; mutation-capable, shell, unmapped, and
no-path callbacks append no path claim and instead record bounded unavailable
hook health. Generic native payload path parsing is forbidden, and CWD never
selects an objective. No shipped connector currently
claims paired-window support; `window_observed` remains reserved for a future
connector whose strict fixtures and runtime both prove a matching pre/post
window.

The local ledger is owner-only, atomically updated under a cross-process lock,
and records normalized repo-relative paths only. Every synchronized item carries
source, quality (`direct` or `window`), overlap, and bounded hook-health metadata.
The backend rejects malformed or absolute paths item-by-item, preserves the
strongest observation for an objective/path, and updates last-observer session
provenance. Objective/path uniqueness migrations deduplicate existing rows before
installing the new index. Historical compatibility payloads and stored metadata
are not accepted as active write inputs.

Optional rationale annotations use one exact shape: `filePath`, `label`,
`summary`, `why`, `impact`, and optional `hunks` containing only `header`.
Unknown or retired keys discard only that advisory item with a bounded warning;
duplicate canonical paths resolve deterministically to the last valid item.
`update` persists non-final annotations and `deliver` / `record-work` persist
final annotations through one shared writer. Accepted changed-file and rationale
writes append scoped `entity_changes` in the same transaction, and the File
Changes projection joins the latest annotation regardless of finality.

Objective-ledger and `record-work` observations set `current_diff_state` to
`unknown`; a captured path is evidence of an edit, not evidence that a current
VCS diff was inspected. Historical `present` and `resolved` rows remain readable.

## [115]

Phase 4 cuts the normal product path over to the objective/session-keyed local
ledger. CLI update, change preflight, and delivery drain metadata-only ledger
evidence through Protocol before their primary operation. Paired connector
evidence is authoritative; post-only and hookless compatibility observations
are explicitly `fallback_delta` review metadata and never exact attribution.

The normal `deliver` request requires only its summary. Legacy changed-file,
observed-dirty-path, rationale-skip, and rationale fields remain accepted for
older clients and useful optional annotations, but the CLI no longer synthesizes
them from a worktree delta, arbitrates peer claims, invents skip reasons, or
preflights rationale coverage. Ledger synchronization, hook health, path
source, overlap, and optional rationale evidence can produce bounded review
warnings but cannot reject delivery. Both Local and Cloud execution targets use
the same metadata-only Protocol sync payload; neither backend reads the target
filesystem.

## [114]

Phase 2 adds the additive Protocol `sync-changes` operation. An attached
execution target submits bounded, metadata-only objective-ledger evidence using
its existing session key; every item independently reports `accepted`,
`ignored`, or `warning`, so one malformed item cannot discard valid siblings or
block delivery. The service upserts the objective/path `changed_files` identity
and stores only source, quality, overlap, window, and hook-health metadata —
never content, diffs, commands, transcripts, environment, or fingerprints.

The CLI owns a versioned local ledger keyed by canonical working directory,
objective, and protocol session. CWD alone must never select an objective:
unbound or ambiguous hook calls record local health and create no attribution.
The legacy VCS delta remains shadow-only during this phase. Local and Cloud
execution targets use the same Protocol payload; no backend reads an execution
target filesystem.

## [113]

Phase 1 of hook-first file-change attribution makes delivery non-blocking with
respect to change tracking and advisory evidence. A delivery requires only its
summary: missing change rationales, rationale skips, and unavailable change
tracking are review metadata and cannot reject the lifecycle transition.
Malformed `deliveryReport.agentReport` items are salvaged independently; valid
siblings persist and bounded warnings are retained with the delivery report.

The mission File Changes REST projection is changed-file-first. Every observed
`changed_files` record appears once, with an optional rationale, so mechanical
evidence is never hidden behind author-supplied prose. Active changed-file
identity is `(objective_id, file_path)`, rather than session-scoped, allowing
one objective to retain one durable record per path across sessions.

## [112]

Phase 0 of hook-first file-change attribution establishes the connector contract
without enabling the new runtime path. Every shipped connector descriptor now
declares fixture-backed mutation-window evidence with one honest classification:
`paired`, `post-only`, or `unsupported`. A `paired` claim proves matching native
session, call, workspace-root, tool, outcome, and direct-path fields in recorded
pre/post payloads. `post-only` proves only completion-side evidence; `unsupported`
records why no usable pair is evidenced. The descriptor generator executes these
fixtures and rejects a classification that lacks the required proof.

The Connector → Protocol hook surface is prepared for the later local-only
pre/post attribution command: adapters must resolve scope before logging or
spawning, use bounded best-effort execution, never make network/database calls,
and never persist or transmit file content, diffs, raw commands, transcripts,
environment values, or fingerprints. This release ships no mutation ledger,
sync command, delivery behavior, database, or REST change; those remain later
phases. The existing PostToolUse touched-file compatibility path is unchanged.

## [111]

Protocol `add-objectives` additively accepts per-item `agent` and `model` in
its objectives JSON/file payload, and hosted MCP `overlord_add_objectives`
exposes the same fields. An explicit `agent` is persisted as the appended
objective's `assignedAgent`; an accompanying `model` is persisted with it.
A model without a non-empty explicit agent is rejected, because it cannot
identify a launch selection. Existing items that omit both fields retain the
project launch-preference defaulting behavior. The existing `resourceKey` and
Run Queue `autoAdvance` semantics, authorization, and response shapes are
unchanged.

## [110]

The existing authorized project Run Queue read projection additively exposes
safe execution-request diagnostics for each entry: request status, bounded
last error, claimant runner and execution target identifiers, and request
creation, claim, launch, update, and terminal timestamps. It also returns a
bounded `diagnosticCode` when the queue/request pair is impossible, including
`terminal_request_dispatched` and `running_without_live_request`. The
projection never exposes launch commands, environment, credentials, terminal
output, or provider-session metadata. Dispatch failures use the same shared
redaction and bounding policy before they become a queue hold reason, service
log detail, or response projection.

## [109]

`GET /api/objectives/:id/effective-launch-config` additively exposes the
authoritative, read-only launch-config projection for one authorized objective,
agent, and selected execution target. It returns the normalized resolved
pre-command/flags, the precedence source (`objective`, `resource_source`,
`user_target`, `workspace`, or `none`), and the resolved target id. The REST
service calls the shared `resolveLaunchConfig` path used by direct launch and
Run Queue dispatch; clients must not reconstruct resource-source precedence.
An explicit empty objective override remains a real override and therefore
returns `source = objective` with empty mechanics. Deleting that override is
the only way to resume inherited defaults.

## [108]

Latch protocol major 2 retires the legacy Overlord conversation-observation
integration. Overlord continues to use Latch as a persistent-terminal provider
through capability discovery plus create, inspect, open, attach, and stop, but
no longer invokes the removed `latch events`, `latch send`, or session-level
interaction-capability commands. The runner and mission REST harness-event
ingest routes and the mission resolve-observation route are removed;
`MissionDetailDto.terminalSessions` no longer exposes the legacy `observation`
fold (event cursor, turn count, pending input, or unattached state).

Overlord does not adapt or emulate the deleted v1 conversation surface. A future
conversation UI must be a native client of Latch's v2 Conversation Hub and its
server-first, revisioned WebSocket contract. Until then, terminal lifecycle is
the complete Overlord/Latch boundary; protocol attach/update/deliver remains
independent of Latch.

## [107]

`pending_delivery` is execution, not a fault. It is the state an objective
returns to when its agent re-attaches after finishing a turn, and every
presentation surface now treats it that way. `MissionDto.hasExecutingObjective`
and the Live Activity running/completion projections count an objective as
executing while it is `executing` **or** `pending_delivery`, so the mission card
keeps its executing shimmer instead of going quiet between the last update and
delivery. `ActivityFeedRunItemDto.state` additively accepts `pending_delivery`
and the activity feed's run query includes those objectives, so a re-attached
objective stays on the Inbox feed as running work rather than dropping out of
it. The read shapes, authorization, and truncation semantics are otherwise
unchanged.

## [106]

Objectives additively record `launched_at` and `started_at` alongside the
existing `completed_at`, and `ObjectiveDto` exposes all three as
`launchedAt`/`startedAt`/`completedAt`. Both new stamps are first-wins, so a
re-launch or a post-delivery re-attach never rewrites them. A mission's
objective list is now ordered by those moments instead of queue position:
complete oldest-completion first, then executing/pending_delivery by start,
then launching by launch, then draft/submitted and future in position order.
Rows with no recorded moment fall back to position, so untimestamped missions
render unchanged. The position queue itself is unchanged and remains what
`planEnsureDraftSlot`, auto-advance, and run-queue dispatch read; display order
is presentation only.

Run Queues become mission-scoped and are created lazily. `run_queues` gains a
nullable `mission_id` (unique among live rows) and `RunQueueDto` additively
exposes `missionId`/`missionDisplayId`. A queue is created only when a user
creates one by hand or when an objective is queued from a mission that has no
queue yet: an enqueue with no explicit `queueId` — REST, Protocol
`queue-objective`, and the legacy auto-advance placement alike — resolves the
objective's own mission queue and creates it on demand. `queue-objective` still
prefers an explicit `--queue`, a predecessor's queue, or the objective's current
queue first, and falls back to the project default only when the mission has no
queue. Removing the last entry from a mission queue retires that queue, so a
project never accumulates one queue per mission. The default project queue is
unchanged where it already exists and is never auto-created.

`DELETE /api/run-queues/entries/:entryId` accepts an additive `{ force?: boolean }`
body under the same `execution_request:create` authorization. Forced removal is
the recovery path for an entry wedged in `dispatched`/`running`: it drops the
entry, clears the objective's still-active execution requests, and resets an
objective still parked in `launching` back to `draft` so it can be launched
again. An objective already `executing` keeps its live session. The response is
additive (`forced`, `objectiveId`, `previousState`, `objectiveReset`,
`clearedExecutionRequests`, `removedEmptyQueueId`); unforced removal behavior is
unchanged. Forced removal also pauses the containing queue transactionally, so
its removal tick cannot dispatch the next entry.

The same release additively exposes the existing Run Queue service to agents.
Protocol provides `reorder-run-queue`, `create-run-queue`, `update-run-queue`,
`delete-run-queue`, and `reorder-project-run-queues`; `run-queue` can derive
its project from an objective or mission and can narrow to one queue. Unlike
the phase plan's fixed project flags, the shipped Protocol queue-definition
commands use the same objective/mission project derivation. Hosted
MCP and connector shims provide `overlord_list_run_queues`,
`overlord_reorder_run_queue`, and action-dispatched
`overlord_manage_run_queue`, while `overlord_queue_objective` adds front/rank
placement. Entry membership and entry ordering require
`execution_request:create`; queue-definition lifecycle requires
`project:update`, so a mission-lifecycle-scoped token cannot create, rename,
pause, delete, or reorder queues.

## [105]

A `USER_TOKEN` a signed-in user mints for themselves — CLI login and the
settings page — consents to every current and future workspace in the caller's
organization, and no longer requires a workspace selection. Workspace consent
narrowing exists for third-party OAuth clients, which continue to pass it
explicitly from the approval screen; there is no third party to narrow for when
a user authorizes their own CLI, and requiring a selection made token creation
fail outright for any account with more than one workspace. Runtime
authorization is unchanged: consent is always intersected with live membership
and per-workspace RBAC, so joining or leaving a workspace takes effect
immediately without reissuing the token. `user_tokens.workspace_id` and
`workspace_user_id` remain issuance attribution and are never authorization
inputs.

Token ownership resolves from the authenticated profile. Session and
`USER_TOKEN` requests establish no ambient workspace member, so an owner lookup
must not fall back to the instance's oldest profile for an authenticated caller.

## [104]

Project Run Queues gain additive `PATCH /api/projects/:id/run-queues/order`,
authorized as a project-definition mutation. It accepts every live queue ID
exactly once and rewrites only queue display order; membership and dispatch
semantics are unchanged. This enables the Phase 4 multi-queue UI to order
independent queues through the Run Queue service rather than mutating
objective positions directly.

| Version | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `135`   | Agent assignment on the objectives a mission is created with (coo:959). Protocol `create` and `prompt` persist per-item `agent` / `model` from `--objectives-json` / `--objectives-file` exactly as `add-objectives` has since Version 111, and REST `CreateMissionBody.objectives[]` gains the same two optional fields. `create`, `prompt`, and `add-objectives` also accept `--objective-agent` / `--objective-model`, seeding only items with no `agent` of their own; `--objective-model` without an agent is rejected, mirroring the service-layer rule that a `model` requires a non-empty `agent`. These are distinct from `--agent`, which records creation provenance (and the attaching agent on `prompt`). Hosted MCP `overlord_create_mission` and the connector shim expose additive `agent` / `model` inputs. Omitted fields preserve the existing project launch-preference defaulting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `134`   | Mission evidence list reads report truncation (coo:955). `GET /api/missions/:id/deliveries` and `GET /api/missions/:id/file-changes` keep the newest-first 200-row cap but return `{ items, total, limit }` instead of a bare array, so clients can render "showing 200 of N". Protocol `list-deliveries` / MCP `overlord_list_deliveries` use the same `MissionDeliveriesDto` envelope. Row DTOs, authorization, and ordering are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `133`   | Explicit objective run boundary (coo:879). `objectives.reopened_at` is a nullable last-wins timestamp stamped when an `executing`, `pending_delivery`, or `complete` objective is set back to `draft`; `ObjectiveDto` additively exposes it as `reopenedAt`. Clients split an objective's deliveries, terminal sessions, and file changes into runs at that moment and fall back to delivery-order inference only when it is null. A post-delivery re-attach is not a reopen. No other column, table, or route changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `132`   | Bounded finished-mission history on the board surfaces (coo:941). `GET /api/projects/:id/missions` and `GET /api/workspace/my-missions` return `complete` and `cancelled` missions only when `updated_at` falls inside a rolling 21-day window, and both accept an additive `includeAllCompleted` query flag that returns the whole archive. Missions of every other status type are unaffected, as are response shape, ordering, and authorization. The status-change response that returns one whole column stays unwindowed. Existing clients that send no flag now receive fewer terminal missions per board request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `108`   | Latch protocol-major-2 boundary (coo:815). Overlord retains Latch discovery and persistent-terminal create/inspect/open/attach/stop, updates discovery compatibility to require protocol version 2, and removes the retired v1 conversation integration: no `latch events`, `latch send`, session-level interaction capabilities, harness-event REST ingest, pending-input resolution, event cursor, harness ledger, or `TerminalSessionDto.observation`. A future conversation UI must be a native Latch v2 Conversation Hub client; protocol lifecycle remains independent of Latch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `107`   | Pending-delivery objectives read as live execution (coo:812). `ActivityFeedRunItemDto.state` additively accepts `pending_delivery` and `GET /api/activity-feed` includes `pending_delivery` objectives in its run projection alongside `launching`/`executing`. The mission aggregate `MissionDto.hasExecutingObjective` and the Live Activity running/completion projections now count an objective as executing while it is `executing` **or** `pending_delivery`, so a mission whose agent re-attached after finishing a turn keeps its executing presentation until it delivers. Field names, DTO shapes, authorization, and truncation semantics are unchanged; clients that only check `state === 'executing'` see one additional state value in an already open-ended union.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `106`   | Mission-scoped, lazily created Run Queues. `run_queues.mission_id` (nullable, unique among live rows) binds a queue to one mission; `RunQueueDto` adds `missionId`/`missionDisplayId`. An enqueue without an explicit queue resolves the objective's own mission queue and creates it on demand, and emptying a mission queue retires it, so queues exist only where work was actually queued. `DELETE /api/run-queues/entries/:entryId` accepts an additive `{ force?: boolean }` body that drops an in-flight entry, clears the objective's active execution requests, and resets a stuck `launching` objective to `draft`; authorization and unforced behavior are unchanged. The existing Run Queue service is also exposed through five additive Protocol subcommands and three MCP tools: entry operations require `execution_request:create`, while queue-definition operations require `project:update`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `102`   | Project-scoped Run Queue engine (coo:786 Phase 1). Add `run_queues` and `run_queue_entries` as the authoritative, target-neutral sequencing model ahead of the unchanged `execution_requests` delegation surface. Each project has one default queue and may have independent additional queues; each unpaused queue dispatches at most one entry at a time after its prior entry delivers, while held entries remain visible and are skipped. Add eight authorized REST operations for project queue reads, queue CRUD/pause, and entry enqueue/dequeue/move/reorder; add `ObjectiveDto.queueEntry` and derive compatibility `autoAdvance` from live membership. Dispatch runs through a project-deduped durable worker job, resolves target/config only at dispatch, promotes only the selected future objective, uses entry-scoped idempotency, and writes queue ordering through to objective positions. Existing runner and virtual-target wire behavior is unchanged; `requested_source = run_queue` is additive.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `101`   | MCP PM-management parity (coo:781). Add protocol `list-deliveries`, `launch-objective`, and `reorder-future-objectives`, then expose them as hosted and local-shim MCP tools. They forward only to the existing authorized delivery read, execution-request queue, and future-objective reorder services: delivery records keep the normalized `DeliveryDto[]` shape without raw payload JSON; launch keeps objective UUID/display-id addressing, `execution_request:create` authorization, explicit agent/model/reasoning-effort/target selection, and existing launchability/idempotency rules; reorder keeps the full ordered future-objective UUID list, `objective:update` authorization, and current state/position validation. Hosted and local MCP schemas and behavior stay aligned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `100`   | Agent search surface (coo:789 Phase 3). Protocol adds canonical `search`, with `search-missions` retained as an exact compatibility alias; both accept v3 `entityTypes`, `objectiveStates`, and `matchesPerResult` controls when `--response-version 3` is selected. `overlord_search_missions` now returns v3 grouped results by default and accepts the same filters plus `detail` (`compact` default or `full`). Compact caps matches at two per mission, removes child snippets, and omits child `matchedTerms`, `createdAt`, and `updatedAt`; it retains ids, display ids, entity types, scores, and all envelope completeness metadata. Full preserves the v3 envelope. Hosted MCP and the local connector shim expose the identical schema and semantics. Existing callers that use `search-missions` without v3-only flags remain supported; artifacts are still unindexed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `99`    | Grouped v3 search retrieval (coo:789 Phase 2). Additive `GET /api/search/v3` returns `SearchResponseV3`: mission-anchored groups with ranked `matches[]` for identifiable objective and delivery hits, `anchorOnly`, `matchCounts`, `entityCounts`, and `truncatedCandidates`. `event` documents remain corroboration-only and never appear in `matches`. `matches` is matched-only, never a complete objective list. Child relevance is `docScore + 0.15 * missionScore`; group ordering stays the v2 MAX-plus-bounded-corroboration fusion. The coverage floor stays at mission level. Per-workspace candidate fetch is bounded at 500 documents; when that cap hits, `totalMatchedBeforeLimit` and `entityCounts` are lower bounds and `truncatedCandidates` is true. Additive filters: `entityTypes` (`mission`/`objective`/`delivery`, default all three), `objectiveStates`, `matchesPerResult` (default 3, max 10). `limit` and per-workspace quota still allocate mission groups; `matchesPerResult` is a separate per-group cap. Objective display-id queries return that objective as the group's single match. REST v3 accepts only stable project UUIDs. Protocol `search-missions --response-version 3` returns the same envelope with v3 defaults; v1 and v2 routes, corpus, and result sets are unchanged. Artifacts remain unindexed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `98`    | Unified mission search begins indexing bounded delivery documents (coo:789 Phase 1). `search_documents.entity_type` additively accepts `delivery`; adapter triggers and idempotent migration backfills maintain one document per live delivery, retaining the owning mission and objective provenance. A delivery body combines `summary`, `verification_summary`, `follow_up_notes`, and only the normalized `deliveryReport.agentReport` fields: `humanActions`, `knownRisks`, `deferredWork`, `assumptions`, and each tradeoff `decision`; it is capped at 20,000 characters. Mission documents add `constraints_text`, `output_format_text`, and `notes_text`. Notes remain excluded from attach/load context and prompt assembly, but are now searchable by every authorized caller, including agents. Artifacts are not indexed. Existing v1 and v2 search routes, protocol, CLI, and MCP retain their response shapes and result corpus (mission/objective/event documents); deliveries become returnable only through the subsequent v3 surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `97`    | Agent surfaces accept human project references, and "scheduled" becomes a searchable date (coo:781). Protocol `--project-id` and MCP `projectId` accept a project UUID, slug, or name; names match case-insensitively across the caller's live memberships. Because slugs and names are unique per workspace rather than per organization, a reference matching in more than one workspace returns the structured `project_selection_required` result — `{ status, message, projectRef, projects[] }`, each project labelled with its workspace — instead of a 409, and an additive `--workspace-id` / `workspaceId` (id, slug, or name) narrows the retry. This replaces the MCP-side UUID gate, which denied agents a resolver the protocol already had. `MissionSearchDateField` additively accepts `dueDatetime` alongside `createdAt` and `updatedAt`, and `MissionSearchResultV2` additively carries `dueDatetime`. A mission is _scheduled_ by its due date, not by an execution timer; because `missions.due_datetime` is nullable, a `dueDatetime` range excludes missions that were never scheduled, which is the opposite of the created/updated columns. REST v2 keeps its UUID-only `projectIds` and its frozen v1 response.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `96`    | My Missions is a status-_type_ board (coo:753). The aggregate surface renders exactly four columns — `next` / `execute` / `review` / `complete`, published as `MY_MISSIONS_COLUMNS` — instead of deduplicating project status _names_, which are project-defined and inconsistent across an organization. Missions whose status type is `draft`, `blocked`, or `cancelled` are not shown on My Missions; they remain on their project board. `MyMissionReorderRequest` replaces `statusId` with `statusType`: one `PATCH /api/workspace/my-missions/order` call carries the whole column across every project and workspace it aggregates, and the server resolves each moved mission's target status **inside that mission's own project** (the lowest-position active status of the type). A mission already in a status of the target type keeps its concrete status, so project-specific column naming survives a drag. A project with no active status of the requested type rejects the whole call with `STATUS_UNAVAILABLE_FOR_WORKSPACE` before any write. `my_mission_positions` is unchanged; positions are now assigned across the whole aggregated column, so an interleaved cross-project order round-trips.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `95`    | Cross-workspace authorization is organization-bounded: OAuth `USER_TOKEN`s bind to one organization with either explicit workspace consent or all current/future workspace consent, always intersected with live membership and RBAC; legacy tokens backfill only to their recorded issuance workspace. V2 search adds the organization-bounded, non-redistributed quota envelope and explicit date/project filter semantics while retaining the v1 REST response.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `94`    | Project status types gain `next`, a non-terminal lifecycle type for work intended to execute soon but not yet active. Every project has exactly one active `next` status, enforced by adapter partial unique indexes and service validation. New projects seed `Next Up` (`next_up`) with type `next`; the migration retags existing active `next_up` status rows from `draft` to `next`. Status type filters and discovery may return `next`; protocol update phases remain unchanged because they describe agent side effects, not board column vocabulary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `93`    | Project-scoped mission status definitions (coo:752). Status DTOs and mutation bodies are renamed from `Workspace*Status*` to `Project*Status*`, with every status carrying its owning `projectId`; status type values remain unchanged. Status CRUD moves to `/api/projects/:id/statuses*`, authorized with `project:read` / `project:update`, and `GET /api/workspaces/:id/project-statuses` provides the aggregate read. Both former workspace route families, `/api/workspace/statuses*` and `/api/workspaces/:id/statuses*`, are removed. Status-edit authorization therefore shifts from `workspace:update` to `project:update`; under the shipped roles this does not expand the effective editor set. A mission's `status_id` must belong to its own project. Scheduled duplicate targets are stored as `schedules.next_status_key` and resolved in the mission's project. Because board columns now vary per project, discovery is additive on the agent surfaces: Protocol gains read-only `statuses --project-id`, the CLI gains `ovld statuses list --project-id <id                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | slug | name>`, and MCP gains read-only `overlord_list_project_statuses`. The agent protocol is otherwise semantically unchanged — every status side effect and filter is expressed in status *types*, which do not move. `GET /api/missions/search`additively accepts a`statusTypes`CSV so the long-documented`ovld missions list --status` filter is actually applied; it filters types, never project-defined names. |
| `92`    | Objective-scoped live-session reads (coo:776 review). Authenticated `GET /api/agent-requests` and `GET /api/agent-session-inputs` accept optional `objectiveId` alongside `missionId`; a display id supplies the mission when omitted, a UUID still requires it, and supplying both validates that they name the same objective and mission. Request/input rows and `liveChannel` are filtered to that objective. `ovld requests` and `ovld inputs list` expose the same addressing, the local MCP shim delegates objective display-id parsing to the CLI, objective-scoped session-key reads never fall back to a sibling's mission-wide key, and cleanup removes every alias for a delivered session without removing a different live sibling's key. This also corrects v91 declarations that described `--mission-id` as unconditionally required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `91`    | Objective-addressable tool surface (coo:776). Every CLI protocol subcommand, MCP tool, and REST-backed management command that accepted `--mission-id` / `missionId` now also accepts `--objective-id` / `objectiveId` (objective UUID or `{mission.display_id}.{display_key}`). Because an objective display id already names its parent mission, `--mission-id` may be **omitted** whenever a full objective display id is supplied — the CLI derives it client-side and the protocol/MCP layer derives it server-side — so an agent holding only `coo:756.k7xm` can attach, update, deliver, and reconnect without reconstructing the mission id. An objective **UUID** carries no parent, so it still requires `--mission-id`. Additive optional `--objective-id` on `load-context` (returns that objective's context instead of rediscovering the active one, which removes `ambiguous_active_objective` on parallel missions), `connect`, `discuss-objective` (submits that draft rather than the first draft found), `add-artifact` (stamps objective provenance with no live session key), `attachment-list`, and `attachment-download-url`. Hosted MCP `overlord_load_mission_context`, `overlord_attach_session`, `overlord_update_session`, `overlord_deliver_session`, and `overlord_add_artifact` take the same optional `objectiveId` with `missionId` no longer required when it is a display id. The objective/mission reference grammar moves to `@overlord/contract` (`parseObjectiveRef`, `formatObjectiveDisplayId`, `missionDisplayIdFromObjectiveRef`), re-exported unchanged from `@overlord/database`, so the CLI parses public ids without the persistence layer and no surface carries a private copy of the regex. `POST /api/runner/clear` `objectiveId` and artifact-create `objectiveId` accept display ids instead of silently matching nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `90`    | Profile-scoped Everhour identity (coo:769). An Everhour personal API key is stored once per profile in `ext_everhour_user_connections` as AES-256-GCM ciphertext (`EVERHOUR_API_KEY_ENCRYPTION_KEY`, falling back to `GITHUB_USER_TOKEN_ENCRYPTION_KEY`) and applies across every workspace the caller belongs to. Authenticated `GET`/`PUT`/`DELETE /ext/everhour/user-connection` are account-wide with no workspace permission, matching `/ext/github/user-connection`. Existing `/ext/everhour/integration` remains as a deprecated alias of that same profile-scoped surface. Timer and time-entry writes use the acting user's key so Everhour attributes them to that person; a member who has not connected is told to connect in Settings rather than sharing another member's secret. Workspace-scoped keys are adopted onto a profile only when `entity_changes` attribution uniquely identifies that profile as the connector. GitHub App installations and Everhour/GitHub resource links stay workspace/project/mission-scoped. Credentials never enter DTOs, logs, realtime, or change projections.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `89`    | Same-resource objective parallelism (coo:756 Phase E). With `missions.allow_parallel_objectives` true, `POST /api/objectives/:id/launch` no longer 409s a sibling on the **same** `resource_key`. Two concurrent objectives are kept apart by the Runner Layer instead: the shared branch/worktree planning algorithm gains an optional `isolation: { objectiveKey }` input that cuts a per-objective branch `<mission branch>-<objectives.display_key>` off the branch the launch would otherwise have shared, in its own worktree (regenerated `contract/branch-planning-vectors.json`). Isolation applies only in worktree mode and never overrides an explicit branch pin; a mission that runs without worktrees has one checkout and concurrent objectives deliberately share it. `POST /api/missions/:id/branch-prepared` accepts an additive `branchAutomation.isolated` boolean; an isolated branch is recorded on `objectives.branch` and audited, but never moves `missions.active_branch` or the mission-level branch observation. Default remains serial.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `88`    | Agent objective instruction editing (coo:767). Protocol `update-objective` additively accepts `--instruction-text` / `--instruction-text-file` alongside the existing auto-advance flags; at least one editable field is required. Instruction text may be changed only when the objective is in `draft` or `future` state (blank text remains allowed in those states). Hosted MCP `overlord_update_objective` forwards the same `instructionText` field to Protocol `update-objective`. REST `PATCH /api/objectives/:id` is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `87`    | Activity feed blocking-question recency (coo:757). `GET /api/activity-feed` includes unseen `ask` mission events only when `mission_events.created_at` is within the past 3 days (rolling 72-hour window from the request instant). Older unseen questions remain acknowledgable via mission surfaces but no longer appear in the inbox live feed. DTO shapes are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `86`    | Activity feed agent identity and objective provenance (coo:757). `ActivityFeedItemBaseDto` additively carries `createdByKind` / `createdByAgent` from the underlying objective (human fallback when the objective join is null), so inbox Running and Delivery cards can render the same agent-authored sparkle mark used on board/list surfaces. Feed agent projection treats the protocol session sentinel `unknown` as absent and falls back to the objective's `assigned_agent`, so cards show the connector icon and model rather than the literal label "unknown".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `85`    | Opt-in cross-resource objective parallelism (coo:756 Phase D). `missions.allow_parallel_objectives` is `boolean NOT NULL DEFAULT false`. When true, `POST /api/objectives/:id/launch` may queue a second objective on the same mission only if its effective `resource_key` differs from every launching/executing/pending-delivery sibling (null inherits the project's primary resource). Same-resource pairs still 409 until Phase E. `MissionDto` / `UpdateMissionBody` expose additive `allowParallelObjectives`. Unpinned protocol attach with two executing (or otherwise equally ranked active) objectives returns 409 `ambiguous_active_objective`. Deliver of A while B is still active does not move the mission to review. Session-channel bind never falls back to a mission-wide unbound channel when an objective id is known. Default remains serial. Per-objective worktrees are out of scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `84`    | Cross-workspace inbox activity feed (coo:757). Adds the additive read-only `GET /api/activity-feed` REST surface, authorized with `mission:read` against every workspace the caller actively belongs to in the active organization — the same membership rule the My Missions aggregate uses. It returns a bounded, time-descending `ActivityFeedDto` merging three projections: launching/executing objectives (`ActivityFeedRunItemDto`, with the contiguous auto-advance queue behind each one), the newest deliveries (`ActivityFeedDeliveryItemDto`, embedding the same normalized `DeliveryDto` the mission delivery-read projection returns), and unseen blocking questions (`ActivityFeedQuestionItemDto`, from `mission_events.type = 'ask'` under the existing `blocking_question` unseen predicate). Instruction text and event summaries are truncated server-side and neither `deliveries.payload_json` nor `mission_events.payload_json` is exposed verbatim. `ActivityFeedItemKind` is an open vocabulary: clients ignore unknown kinds, so a future item kind is additive. Ordinary `objective`, `delivery`, `mission_event`, `execution_request`, `agent_session`, and `mission` change-feed rows invalidate the feed query; no new realtime transport is introduced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `83`    | Objective-centric attach pinning (coo:756 Phase B). Protocol `attach` gains optional `--objective-id` (UUID or `{mission.display_id}.{display_key}`). Selection order is explicit `--objective-id`, else `--execution-request-id` / `OVERLORD_EXECUTION_REQUEST_ID`, else today's `resolveActiveObjective`. `--mission-id` remains required. When a pin is present, attach must not rediscover another objective. Hosted MCP `overlord_attach_session` accepts optional `objectiveId`. Launch exports `OVERLORD_OBJECTIVE_ID` (display id), context/copied attach argv include `--objective-id`, and Latch `display.name`/`title` use `{objectiveDisplayId} — {objective title}`. Session-key and native-session caches re-key to include objective id with a mission-only read fallback. Sibling 409 and serial execution are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `82`    | Objective display ids (coo:756 Phase A). `objectives.display_key` is a required 4-character Crockford Base32 key, unique among live rows of a mission. Public `displayId` is computed at read time as `{missions.display_id}.{display_key}` (e.g. `coo:756.k7xm`) and is not stored as a second column. `ObjectiveDto` and protocol `ObjectiveSummary` expose additive `displayKey` and `displayId`. `resolveObjectiveRef` accepts a UUID or full display id and rejects a bare mission id or a wrong separator (`:`, `\|`, `-`). `/api/objectives/:id` accepts either form. Launch, attach pinning, Latch titles, and sibling-lock behavior are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `81`    | Pruned Latch sessions leave the mission panel (coo:755). Latch's "no session" absence (metadata reclaimed by prune/remove) is a distinct local-target failure `LATCH_SESSION_ABSENT`, not a reachability error and not a new inspect state — inspect still reports only `running` / `exited` / `stopping` / `lost` when the session exists. The mission panel hides that card immediately instead of showing the raw Latch error. `POST /api/missions/:id/terminal-sessions/forget` then drops the matching `execution_requests.metadata_json.providerSession` mapping so `MissionDetailDto.terminalSessions` no longer projects it. The execution-request row, protocol session, observation history, and mission events stay; Overlord does not resurrect a "this used to exist" card. Other inspect/open/events failures remain the existing client-side reachability condition over last-known state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `80`    | Latch session-lifecycle executable resolution and a single mission-panel Latch card (coo:750). Every Latch child process Overlord spawns — `inspect`, `open`, `stop`, `events`, `send` — resolves the configured executable through the same resolver discovery uses (PATH via `which`, then `~/.local/bin` and the macOS Homebrew prefixes) instead of spawning the bare `latch` name, and reports a named missing-binary condition rather than a raw `spawnSync latch ENOENT` when nothing resolves. A Finder/launchd launched process (the packaged desktop app, an installed runner service) inherits no interactive-shell PATH, so discovery reporting `found` while every lifecycle command failed was the observable bug. Resolutions are memoized per executable name and revalidated by existence check. Separately, `MissionDetailDto.terminalSessions` is presented as **one** card — the newest session for the mission's active objective, falling back to the newest session overall — with the remaining sessions collapsed into an accordion inside that card whose trigger counts the other Latch connections currently running. Collapsed sessions keep polling inspect and keep ingesting harness events, so display consolidation never narrows what Overlord observes. Presentation only: no DTO, REST, capability, or CLI surface changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `79`    | Runner-service local fallback and service environment simplification (coo:726). Postgres runners still reconnect the queue long-poll immediately; SQLite now uses one jittered 5-second fallback interval instead of adapting between 3 and 5 seconds from recent launches or Desktop focus. The private `~/.ovld/runner-focus.json` convention and Desktop focus-event writer are removed; `~/.ovld/runner-service.json.currentPollIntervalMs` remains the diagnostic projection of the fallback interval. This changes only the Local/SQLite pickup latency by at most two seconds and removes no CLI, REST, database, or Desktop bridge surface. Separately, persistent service definitions capture a remote backend URL but deliberately omit a loopback URL so each supervisor process follows the current `overlord.toml` value after Desktop selects its Local port; other captured environment fields and service lifecycle ownership are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `78`    | Runner service survives its own replacement, and a stalled `launching` request expires (coo:726). The persistent supervisor (`ovld runner supervise`) records the identity of its own program and entry script at startup, re-checks it on every poll, and exits `0` when either changes or disappears, so the OS service manager (`launchd` `KeepAlive` / `systemd` `Restart`) respawns it from the newly installed build. Exit `0` is deliberate — a non-zero exit reads as a crash. The check is cheap and non-fatal: any error other than "gone" must never terminate a healthy supervisor, and the exec identity lives in process memory, so `~/.ovld/runner-service.json` gains no field. The Desktop Shell does **not** orchestrate runner-service lifecycle around an app update — section 5 already forbids the shell from reimplementing service management, and this self-restart is what makes such orchestration unnecessary; it is also transport-agnostic, covering desktop auto-update, a manual bundle replace, and a package-manager CLI upgrade identically. Separately, the Queue Surface's expiry vocabulary is extended: a request left in `launching` whose runner never reported `launched` within the launch TTL may move to `expired`, alongside the existing stale-claim and launched-without-attach arms. `execution_requests.launch_started_at` already exists and is already written at `launching`, so there is no schema change. `POST /api/runner/requests/:id/launched` must tolerate a conflict on an already-expired request for the very-slow-launch case. Requests are never re-queued by expiry — launch-at-most-once is preserved by expiring plus the runner's reported failure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `77`    | Window-or-tab preference delegated to Latch (coo:721). The resolved launch session's viewer additively carries `openAs` (`window` \| `tab`), projected from the stored `TerminalProfile.placement` rather than stored a second time — `chord` has no delegated equivalent and resolves to `window`. It is written into the versioned `terminal_profile_json` viewer block as `{"kind": "iterm", "openAs": "tab"}`, frozen onto the claim-time `launchSession` snapshot, and additively projected as `TerminalSessionDto.viewerOpenAs`. Both Latch open paths (runner viewer open, mission-panel re-open) send it explicitly as `latch open --with iterm --as window\|tab`, never relying on Latch's own `open.behavior` default, because two independent defaults that disagree leave the user unable to tell which one won. The flag is gated on the `productVersion` from `latch capabilities --json` (minimum `0.2608140931.0`): clap rejects unknown arguments, so an older CLI is sent the pre-existing argv and opens a window. A snapshot frozen before this field reads as `window`, which is what those runs did.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `76`    | Latch engine Overlord migration (coo:707). Observation and harness permission/question presentation come from the public Latch CLI (`latch events --json --from`, capability-gated `latch send --resolve`); Overlord does not re-parse transcripts. Channel 1 (protocol attach/update/deliver, artifacts, shared state, follow-up capture, touched-file attribution) has no Latch dependency and must work from a bare terminal. Binding is the agent's `ovld protocol attach` declaration; Latch turns without attach are surfaced as unattached presentation on `MissionDetailDto.terminalSessions[].observation`. Session-input-control UI and new Agent Session Exchange observe/decide/inject state are decommissioned — historical ASE tables remain, human resolve/enqueue/release return no active controls, and launch no longer mints a session channel. Delivery/artifact/`ovld protocol ask` notifications stay on Overlord; harness `awaiting_input` notifications are ingested from Latch and neither waits on the other. Launch create/open/inspect/stop is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `75`    | Objective auto-advance on agent create/edit surfaces (coo:711). Protocol `create`, `prompt`, and `add-objectives` persist per-objective `autoAdvance` from `--objectives-json`/`--objectives-file` and honor additive `--auto-advance` / `--no-auto-advance` as the default when an item omits the field (omitted still defaults to off). Adds additive `ovld protocol update-objective` (`--objective-id` required plus `--auto-advance` or `--no-auto-advance`) so agents can toggle the flag on an existing objective. Hosted MCP `overlord_create_mission` and `overlord_add_objectives` accept the same boolean (mirrored by connector shims), and `overlord_update_objective` forwards to Protocol `update-objective`. REST `PATCH /api/objectives/:id` already supported `autoAdvance`; this change does not alter that path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `74`    | Multi-project checkout link metadata (coo:709). `.overlord/project.json` may record every project a `read_write` checkout is linked to via an additive `projects` array (each entry carries `projectId`, optional `projectName`, `resourceId`, optional `resourceKey` / `resourceIdsByExecutionTarget`, `isPrimary`, and `linkedAt`). Top-level `projectId` / `resourceId` / `resourceKey` / `resourceIdsByExecutionTarget` / `isPrimary` remain required as the **primary-project projection** so v1/v2 readers keep working. At most one `projects[]` entry has `isPrimary: true` — whichever project most recently set this resource as its primary; a non-primary link never demotes an existing primary. Readers accept a legacy single-project file as a one-element `projects` list. Protocol `discover-project` (and client-side discovery for a remote backend) resolves to that primary project for mission association; the additive `linkedProjects` array lists every linked project. Cwd fallback matches the requested project among all links, not only the primary. Agent guidance uses the `isPrimary: true` project (else the top-level / sole entry) when associating missions, and passes an explicit project id to target a different linked project.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `73`    | Latch terminal-session lifecycle on the mission panel (coo:702). `MissionDetailDto.terminalSessions` additively projects every execution-request `metadata_json.providerSession` mapping for the mission, including provider/session ids, execution request/objective/target ids, target/device label, stored session name, claim-time executable/viewer, creation time, and the last observed `running` / `exited` / `stopping` / `lost` state. Session state is independent of mission and agent-session state. The local-target boundary gains `inspectLatchSession`, `openLatchSession`, and `stopLatchSession`: each runs the public Latch CLI on the mapped execution target with argv (never a shell), and inspect/open failures are represented as a separate client-side reachability condition layered over the retained last-known state. The mission panel polls inspect while reachable and offers distinct `Open in <viewer>`, `Copy attach command`, and explicitly destructive `End session` actions. The copied command is presented as a developer path requiring the user's own SSH when the device is remote, not as a shipped remote transport. Delivering or completing an objective never invokes stop; no automatic-stop policy exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `72`    | Latch settings surface on the execution target (coo:702). Terminal & IDE settings gain one `Session` choice — `Direct — the window runs the agent` vs `Persistent — Latch hosts the agent, the window just shows it` — written as the tri-state `TerminalProfileDto.executionProvider` (omitted keeps, `null` inherits the user default, a value overrides) and read back with its origin from `resolvedLaunchSession`. The existing terminal picker keeps its list and stored `launcher` value and only changes verb (`Open in` / launches when direct, `Show it in` / shows plus the closing-the-window note when persistent); a `Don't open a window automatically` entry appears only under the persistent provider and writes `openViewerOnLaunch = false` without touching `launcher`, so toggling the provider stays lossless. Latch is never added to the terminal list. Discovery is rendered inline from a new read-only local-target capability `discoverLatch` (`DiscoverLatchInput` / `DiscoverLatchResult`, dispatched over the desktop bridge and the dev in-process proxy) so the probe runs on the device that would host the process, never in the browser: version and resolved path when found, the standalone install command when missing, the missing capability when incompatible, and an explicit unavailable state when no local transport can answer. `Persistent` is offered only on a definite `found`; direct execution stays selectable in every state. The user-level default is editable through `PATCH /api/(workspaces/:id/)launch-settings/session-defaults` alongside the per-target override. Pre-command and pre-launch fields are unchanged and never rewritten; a typed `latch` invocation there raises a warning pointing at the Session toggle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `71`    | Latch nesting avoidance for the runner (coo:702). When the claim-time `launchSession` selects the Latch provider and the runner's launch environment contains a non-empty `LATCH_SESSION_ID`, the runner runs the same composed terminal command string S inline in the existing PTY through `$SHELL -ilc`, rather than call `latch create` or open a viewer. It records that opaque session id as `execution_requests.metadata_json.providerSession` with `lastObservedState = running`; the marker is correlation only and confers no mission, session-channel, or protocol authority. Direct launches remain unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `70`    | Latch create-then-open execution provider in the runner (coo:702). When the claim-time `launchSession` snapshot resolves to `executionProvider.kind = latch` and Latch discovery on the execution target reports `found`, the runner replaces only the final terminal/process spawn: it composes the same terminal inner command string S used today (cd, env exports, pre-launch commands, pre-command wrapper, agent argv — command resolution unchanged), sends `latch create --manifest-file - --json` with a Latch format-version-1 manifest whose `launch.argv` is `[ $SHELL, "-ilc", S ]` (interactive login shell so quoting/`&&`/multi-line pre-launch and `.zshrc` PATH setup match iTerm/Terminal), `launch.cwd` and `launch.env` mirror the resolved launch environment, and `display.source` is `{ kind: "overlord", external_run_id: <execution request id> }` — never Latch credentials, socket tokens, or attachment grants. Spawn success is the durable launch boundary. The returned Latch session id is recorded as `execution_requests.metadata_json.providerSession` (`provider`, `providerSessionId`, `executionTargetId`, `agentSessionId` nullable, `createdAt`, `lastObservedState`) via an additive optional body on `POST /api/runner/requests/:id/launched`; that id is never written to `launched_session_id` or the harness-native resume id. `latch open <id> --with <viewer>` is a separate best-effort step gated by `viewer.openOnLaunch`; viewer failure yields a warning plus an attach action and must not fail the execution request or terminate the agent. When the provider is `direct` or Latch is unavailable/incompatible, direct launch continues unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `69`    | Latch capability discovery on the execution target (coo:702). Run read-only `latch capabilities --json` on the device where the process will run, parse `protocolVersion` / `productVersion` / the capabilities map, expose three distinguishable states (`found` with version and resolved path, `not_installed` with the standalone install command, `incompatible` naming the missing capability), cache per target with cheap mtime/`which` revalidation, and never install or upgrade Latch as a side effect. Direct execution remains selectable in every state. Contract DTOs: `LatchDiscoveryDto`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `68`    | Execution provider and viewer are separate launch settings (coo:702). `user_execution_target_preferences.terminal_profile_json` gains an additive versioned block — `version`, `executionProvider` (`{ kind: 'direct' \| 'latch', executable }`), and `viewer` (`{ kind, openOnLaunch }`) — written **only** when a target actually opts in, so a row that predates the field is byte-identical and keeps launching directly with its current terminal choice. `launcher` remains the single stored terminal choice and is the sole authority for the viewer; `viewer.kind` is a derived projection consulted only when a document carries no `launcher`, which is what makes toggling the provider on and off lossless. A user-level default lives in `profiles.metadata_json.launchSessionDefaults` and is written through the additive `PATCH /api/(workspaces/:id/)launch-settings/session-defaults` (`launch:configure`); it applies to any target that has not set its own provider, and a per-target value always wins. `LaunchSettingsDto` gains `launchSessionDefaults` and `resolvedLaunchSession` (effective values plus the origin of each), and `TerminalProfileDto` gains tri-state `executionProvider` / `openViewerOnLaunch` (omitted keeps the stored override, `null` clears it back to inheriting). Claiming an execution request freezes the resolved provider and viewer onto `execution_requests.metadata_json.launchSession` — a best-effort write that never fails a claim, absent for requests claimed before this version — so a later settings change cannot retroactively change what a run did. No credential, socket token, or attachment grant is stored. Data contract only: no runner or UI behavior changes yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `67`    | Creation provenance on missions and objectives (coo:669). `missions` and `objectives` each gain `created_by_kind` (closed vocabulary `human` \| `agent` \| `automation`, `NOT NULL DEFAULT 'human'`), `created_by_agent` (open connector/agent identifier), and `created_by_session_id` — a deliberate **soft** reference to `agent_sessions.id` with no foreign key, so a dangling provenance pointer can never block a delete. `MissionDto` and `ObjectiveDto` expose additive `createdByKind` (non-optional; pre-provenance rows report `human`), `createdByAgent`, and `createdByWorkspaceUserId`; `MissionDetailDto` additionally exposes `createdFrom` (`sessionId`, `missionId`, `missionDisplayId`, `agentIdentifier`, or null), resolved by a `LEFT JOIN` paid once per mission page and never on board/list rows. Protocol `create` and `prompt` accept the additive optional flags `--agent`, `--assigned-to`, and `--session-key`, and `record-work` accepts `--assigned-to`; `--assigned-to` resolves a workspace member by `workspace_users.id`, profile UUID, `orgid:username`, bare username, or email, and an unresolvable member is rejected rather than silently unassigned. MCP `overlord_create_mission` accepts an additive `assignedTo` input with the same resolution rules. Every field is additive and existing clients are unaffected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `66`    | Batched objective bodies on the mission list (coo:666). `GET /api/projects/:id/missions` accepts an additive opt-in `includeObjectives` query flag; when set, each `MissionDto` carries an `objectives` array (every non-deleted objective, ordered by `position`) resolved by one batched query for the whole board instead of one `GET /api/missions/:id/objectives` per mission. The flag additionally requires `objective:read`. The default response shape is unchanged, so existing clients are unaffected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `65`    | Project resource-source launch defaults (coo:657). Each `project_resource_sources.descriptor_json` may carry per-agent `launchDefaults` containing a pre-command and normalized flags. Project settings exposes an additive `PATCH /api/projects/:id/resources/:resourceId/sources/:sourceId` route to replace those defaults while preserving the source materialization descriptor. Effective launch resolution is objective override first, then the source selected for the objective resource and execution target, followed by the existing user-target and workspace fallbacks. `ObjectiveDto.launchConfigOverrides` and additive `UpdateObjectiveBody.launchConfigAgent` / `launchConfigOverride` fields persist proactive objective edits under the any-target `*` key; explicit launch requests use an exact target key when known and otherwise the same wildcard. Queue snapshots and claim-time re-resolution use the same priority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `64`    | APNs `aps.badge` is the recipient's unread durable-notification count (coo:637). `buildPushNotificationPresentation` counts `notifications` rows with `read_at IS NULL` and `deleted_at IS NULL` for the profile instead of missions in `status_type = 'review'`. The home-screen badge now matches the notification drawer / history; missions-in-review remains a separate queue metric.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `63`    | Live Activity update-token APNs routing is per registration (coo:656). `live_activity_push_tokens` gains required `environment` (`sandbox` \| `production`) and `bundle_id`, matching `live_activity_start_tokens` / `device_push_tokens`. `PUT /api/mobile/live-activities/:activityId/push-token` now requires `{ pushToken, environment, bundleId, startedByPush? }`. The Live Activity dispatcher sends update/end pushes on the registration's own `<bundleId>.push-type.liveactivity` topic and environment host instead of the process-wide `OVERLORD_APNS_ENV` / `OVERLORD_IOS_BUNDLE_ID` defaults, so a sandbox debug build is not retired by a production-host `BadDeviceToken`. Existing update-token rows without routing metadata are cleared by migration and must re-register.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `62`    | Live Activity APNs `content-state.updatedAt` is Unix epoch seconds (coo:656). ActivityKit's push JSONDecoder cannot decode an ISO-8601 string into a Swift `Date`, so remote update and push-to-start payloads previously returned APNs 200 while iOS silently discarded every content-state. The bounded presentation snapshot now encodes `updatedAt` as an integer (`Math.floor(now.getTime() / 1000)`); mobile ContentState must consume the same numeric epoch-seconds representation. No REST route or registration shape change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `61`    | Unified notification preferences (coo:637 P4). `notification_preferences` is addressed by `(profile_id, type, transport)` and records `alert`, `silent`, or `off`; catalog notification types and catalog-declared transports are validated strictly. The reserved master row is `(type: all, transport: all)` and suppresses notification transports, never Live Activity delivery. Existing category rows fan out to every catalog-eligible transport during migration. The profile preference REST route canonically reads/writes `{ enabled, preferences: { type, transport, mode }[] }`; an additive APNs-only `{ categories: { category, mode }[] }` compatibility projection and request alias keep older mobile builds usable. The webapp now reads and writes that server-owned preference surface, retaining only an additive local device mute for browser/desktop notification permission.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `60`    | Webapp notification rendering (coo:637 P3). User-notification policy is server-owned: the webapp consumes only the caller's durable notification history and authorized `notification` entity changes, rather than inferring candidates from mission/objective/event changes. Notification history projections add a bounded, server-composed `{ body }` field while fixed labels remain catalog-owned; neither is stored on the row. The feature-detected desktop bridge exposes `window.overlord.showNotification({ title, body, tag?, soundUrl? })`, implemented only by the validated `overlord:show-notification` IPC handler; it accepts no navigation route, credentials, token, or arbitrary Electron capability. The webapp remains an ordinary REST/SSE consumer and displays a recoverable notification drawer. The separate app-update and CLI-update banner module is not a user-notification transport.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `59`    | Durable server-owned mission notifications (coo:637 P2). Adds the private `notifications` table: a workspace-scoped, profile-addressed, soft-dismissible history row carrying only notification type, mission/objective references, read timestamp, revision, and lifecycle timestamps. Core `emitNotification` resolves the assignee as the sole recipient, writes that row, and enqueues `overlord.notification.dispatch.v1` inside the originating lifecycle transaction; unassigned missions notify nobody. The new dispatcher delivers APNs only through the existing ordinary device-token path and emits a `notification` entity-change row for realtime consumers; it never mixes standard device tokens with either ActivityKit token family, and APNs presentation remains recomputed from ids at delivery time. Authenticated `GET /api/notifications`, `PATCH /api/notifications/:id/read`, and `DELETE /api/notifications/:id` expose only the caller's own non-dismissed history; read and dismiss require the current revision and emit the matching entity change. New server emits cover agent questions, delivery awaiting review, launch failures, mission completion, agent start, and return-to-execute; `agent_started` remains silent by default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `58`    | Remove the unused terminal mission-link feature (coo:502). The local-only `ovld protocol mission-link` subcommand, launch and attach banners, and connector Stop-hook footers are retired because they did not reliably surface a terminal link. The active-mission pointer remains an internal CLI correlation mechanism for agent-session binding and edit attribution. Desktop ownership of credential-free `overlord://missions/<missionId>` URLs remains unchanged because mobile push notifications use that route.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `57`    | Remove project.json pre-commit guard (coo:651). The checkout-local `writeProjectMetadata` capability continues to write read-write `.overlord/project.json` link metadata and idempotently maintain the checkout-root `AGENTS.md`/`CLAUDE.md` no-edit instruction block and narrow `.overlord/tmp/` + `.overlord/logs/` `.gitignore` entries, but no longer installs or updates a cooperative Git `pre-commit` guard. Intentional `project.json` commits are no longer blocked at link time; agent instruction files remain the primary protection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `56`    | Mission field cleanup and human-only notes (coo:639). Removes `acceptance_criteria_text` and `available_tools_json` from `missions` and from the REST `MissionDto` / `UpdateMissionBody` shapes so agents can no longer persist hidden mission metadata through the API. Adds `notes_text` (`notes` in REST DTOs) for private human viewer notes that are editable in the mission panel but are never included in protocol attach/load context or agent prompt assembly. Scheduled mission duplicates copy `notes_text` forward.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `55`    | Desktop-initiated Live Activities via ActivityKit push-to-start (coo:633). Adds a third, non-interchangeable APNs credential family and the private core table `live_activity_start_tokens` (globally unique `start_token` bound to exactly one profile, carrying `platform`/`environment`/`bundle_id`/`activity_type`). New authenticated Mobile → REST routes `PUT /api/mobile/live-activities/start-token` (`{ startToken, environment, bundleId, activityType?, appVersion? }`) and `POST /api/mobile/live-activities/start-token/revoke` (`{ startToken }`) register/rotate and revoke the token; it travels in the body, never the URL, and has no read surface. Holding a row is itself the account's consent to desktop-initiated Live Activities, and revoking withdraws it. When an assigned mission enters execution the server enqueues a coalesced `overlord.live_activity.start.v1` worker job alongside the existing refresh job; the Live Activity dispatcher recomputes the same bounded snapshot at delivery time and sends an APNs `liveactivity` payload with `event: "start"`, `attributes-type`, `attributes`, `content-state`, a stale date, and a bounded alert, at priority 10 on the registration's own `<bundleId>.push-type.liveactivity` topic and environment host. A start is suppressed when the account already has any `live_activity_push_tokens` registration, when no mission is running, and for five minutes after a start was sent. `live_activity_push_tokens` gains `origin` (`local` \| `push_to_start`); `PUT /api/mobile/live-activities/:activityId/push-token` accepts the additive optional `startedByPush` boolean so the per-activity **update** token handed over after a remote start is registered and then owns every later update and end. Unassigned missions still notify nobody, existing retry/token-retirement rules are unchanged, and payloads still contain only the bounded presentation snapshot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `54`    | Account-owned unassigned mission capture (coo:574). Adds `inbox_items`, a private profile-owned draft resource containing only title, a v1 one-item objective array, due date, priority, and timestamps; it carries no workspace/project/status/execution state. Authenticated `GET/POST /api/inbox`, `GET/PATCH/DELETE /api/inbox/:id`, and `POST /api/inbox/:id/promote` expose the lifecycle. Promotion authorizes `mission:create` on the selected destination project, creates the normal mission in that project's workspace, and consumes the item atomically. Inbox mutations do not emit workspace entity changes; clients refetch their own inbox, while promotion emits normal mission changes. `ovld protocol create --inbox` and `ovld inbox create` capture explicitly; ordinary non-executing `protocol create` falls back to inbox only when it cannot resolve a project, while `prompt` and `record-work` still require one. Hosted MCP makes `projectId` optional on `overlord_create_mission` (omission returns an explicit unassigned inbox item) and adds `overlord_create_inbox_item`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `53`    | Mission-panel agent-session action surface (coo:563, objective 4). The authenticated human request inbox `GET /api/agent-requests` additively accepts `?missionId=<id-or-display-id>`, which resolves the mission inside the caller's own memberships and authorizes `session:read` against the mission's own workspace before returning only that mission's requests. Adds the human `POST /api/agent-requests/:id/release` operation — the "respond in terminal" control — which releases an `open` request to the native prompt with `released_reason = 'policy'`, is authorized by `session:attach` in the request's own workspace, and is honest about losing the race: a request that was already resolved or released returns `released: false` plus the terminal state rather than an error. `GET /api/agent-session-inputs` additively projects `liveChannel` (`id`, `state`, `agentIdentifier`, `adapterKey`, `capabilities`, `lastHeartbeatAt`, `endedAt`, `endReason`) alongside the existing `liveChannelId`, so a client can gate its controls on the live channel's effective capability snapshot as this contract already requires; the projection exposes no credential, credential prefix, lease, or native session id. No table, vocabulary, or adapter route changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `52`    | Agent-session conformance hardening and documentation audit (coo:562, objective 7). Restores the authoritative contract version after the Phase 3 machine-readable contract advanced without its narrative counterpart, and adds connector-owned decision codec declarations compiled into `cli/src/agent-session/decision-codec-registry.generated.ts`. Adds the executable `decision-codec` fixture kind: it runs the shipped pure request decoder and native decision encoder, asserts the bounded/redacted request card, and pins exact allow/deny/defer bytes. A `supported` callback/extension decision capability may not rely on a payload-shape fixture alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `51`    | Agent-session inject path (coo:562, phase 3). Adds `ovld agent-session inbox --agent <key> [--payload-file -]` as the third fixed rendered hook action (`event`/`request`/`inbox`). Claude registers `asyncRewake` inbox on SessionStart/PostToolUse (stderr + exit 2 → Delivered) and Stop-boundary `decision:block` (Delivered). Cursor stop prefers inbox `followup_message` and records `delivery_outcome=queued_turn_boundary` — never Delivered. OpenCode sidecar drains claims via `POST /session/{id}/prompt_async`. Pi extension claims via inbox, calls `sendUserMessage`, then confirms. Adds nullable `agent_session_inputs.delivery_outcome` (`delivered`/`queued_turn_boundary`/`queued_next_turn`/`unsupported`), human `GET\|POST /api/agent-session-inputs` and `POST /:id/cancel`, `ovld inputs list\|send`, and a mission-panel Session instructions section that renders honest delivery labels including "Queued (turn boundary)". An emitted input remains unretriable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `50`    | Mission shared-context REST and UI footer (coo:566). Adds authenticated `GET /api/missions/:id/context` (mission:read) returning `SharedContextEntryDto[]` from `shared_context_entries`, and authenticated `PUT /api/missions/:id/context` (mission:update) that upserts one entry by `{ key, value }` using the same durable memory model as Protocol `write-context`. Writes emit `entity_type=shared_context_entry` entity-change rows in the same transaction. The web/desktop mission panel shows a collapsed-by-default Shared State footer for viewing and editing these entries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `49`    | Agent-session blocking decision path (coo:562, phase 2). Adds the `ovld agent-session request --agent <key> --payload-file -` callback runtime: it gates before I/O, creates one channel-scoped request, holds and renews its server-side waiter lease, and returns only the connector-owned exact native allow/deny decision when a human resolution wins; timeout, interruption, malformed input, auth failure, and backend loss emit no decision and return control to the harness. Adds authenticated human `GET /api/agent-requests` and `POST /api/agent-requests/:id/resolve` surfaces, authorized by `session:read` and `session:attach` respectively in the request's own workspace; resolution requires revision CAS and an identified human actor. The adapter channel route adds a scoped request reader so a waiter that loses its CAS can observe the one terminal state without addressing another channel. Default windows remain 30 seconds for active presence and 30 minutes for away/unknown, are capped below harness timeout, and project policy may set zero for immediate terminal release. OpenCode's standing `always` permission remains absent from the remotely resolvable vocabulary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `48`    | Agent-session push path on two integration shapes (coo:562, phase 1). Adds the pure normalization core (`packages/core/service/agent-session/pure/`): a closed seven-value normalized event vocabulary (`session.started`, `session.ended`, `prompt.submitted`, `tool.called`, `tool.completed`, `file.edited`, `notice`), a nine-value normalized tool vocabulary, and the §9.1 description formatters keyed by **normalized** tool name with a closed ten-value `riskMarkers` set. Normalized event payloads are an **allowlist expressed as a type** with no index signature, so there is no field a raw native payload fits into. Producer event ids are **derived from content**, which is what makes at-least-once delivery — a retried hook, a reconnecting sidecar, a flaky network — idempotent without adapter-side state. Adds the connector-owned **event codec declaration** `connectors/adapters/<agent>/codec/<agent>.codec.yaml`, referenced from the descriptor's new optional `codecSpec` field and compiled by `yarn connectors:capabilities` into `cli/src/agent-session/codec-registry.generated.ts`. A codec is a declaration of _where native values live_, never executable code: it cannot name a destination the core interpreter does not implement, and unknown keys are a generation error. Adds the `normalized-event` fixture kind to the `agentSession.fixtureKinds` vocabulary — it runs the shipped codec and interpreter against a recorded native payload, asserts the exact envelope, and asserts that named raw content appears nowhere in it, which is what allows an `observe.*` capability to be graded `supported`. Adds two adapter runtime subcommands: `ovld agent-session event --agent <key> --payload-file -` (callback and extension shapes; silent on every path, exits 0 on every path, never blocks) and `ovld agent-session sidecar --agent <key> --port <port>` (control-plane shape; binds loopback only, mints a per-launch control-port secret held in memory, and re-reads harness state before resubscribing after a dropped stream). The sidecar is harness-agnostic: a sixth control-plane harness supplies a codec and a descriptor and adds zero subcommands. The shared `connectors/core/scripts/agent-session-hook.sh` now applies the scope gate **in bash, before the `ovld` spawn**, so a session with no `OVERLORD_SESSION_CHANNEL_ID` costs no process, no log, and no delay. Claude registers the rendered `scripts/agent-session-event.sh` on `PostToolUse`, `UserPromptSubmit`, and `SessionStart` **additively**: the legacy touched-file and follow-up hooks stay installed and a fixture guards both registrations, because the migration must not repair observation by regressing change attribution. Adds the `opencode` connector as the first `controlPlane` adapter — descriptor, codec, and README only; its launch integration and agent-catalog entry are not in this phase. Claude and OpenCode both derive `capabilityTier` 1 (Observational) from passing fixtures.                                                                                                                                                                                                                 |
| `47`    | Agent Session Exchange channel bootstrap and runtime skeleton (coo:562, phase 0B). Migrates the four Agent Session Exchange tables reserved by contract 45 — `agent_session_channels`, `agent_session_events`, `agent_requests`, `agent_session_inputs` — in both dialects, and brings the `/api/agent-session-channels/v1/*` adapter route family live. A session channel is created at the `launching` transition, **before** the agent process exists, so harness output published before attach lands somewhere durable and correctly authorized; the `POST /api/runner/requests/:id/launching` response additively carries a one-time `sessionChannel` bootstrap (`channelId`, `token`, `expiresAt`, `launchKind`) and the launch environment gains `OVERLORD_SESSION_CHANNEL_ID` and `OVERLORD_SESSION_LAUNCH_KIND`. The **credential is never exported into the launch script**, which lives in `<checkout>/.overlord/tmp`: it is staged in an owner-only (`0600`) file outside every checkout, keyed by a hash of the channel id, and removed on channel end or an auth failure; `OVERLORD_SESSION_CHANNEL_TOKEN` remains a supported input for virtual gateways that realize the bootstrap directly into the environment. `ovld protocol attach` gains the optional `--session-channel-id` flag — the id only, filled automatically from the environment — which binds the channel to the new `agent_sessions.id` and backfills the session id onto every pre-attach event and request; the working directory participates in no part of this. The adapter router is mounted **ahead of** the `/api` human authentication guard so a browser session, a `USER_TOKEN`, and the loopback-trusted local-operator fallback are all structurally unable to reach it, and every handler operates on the channel resolved from the credential rather than one named in a request. The scoped credential is stored hash-only with a lease-renewed bounded expiry and an absolute lifetime ceiling, and is revoked in the same transaction that ends or loses a channel — which also releases every open request to the terminal and expires every queued input, so no card stays answerable after its session is gone. Waiter leases and the server-side release sweep land here rather than with the answerable-request UI, because the guarantee that a held decision is released cannot live in the process that gets killed. `ovld agent-session bind` correlates a native session id through a heartbeat; a native id remains an alias that can neither create a binding nor authorize anything. Adds the shared `connectors/core/scripts/agent-session-hook.sh`, rendered per adapter at `ovld agent-setup` time as `scripts/agent-session-<action>.sh` with both the adapter key and a **fixed action** substituted from a closed two-value set, so an untrusted native payload can never select which CLI operation runs. Existing `PostToolUse` touched-file capture is untouched and keeps its attribution; Cursor's `postToolUse` hook is repaired to create `~/.ovld/logs` before redirecting into it (the missing `mkdir` made bash fail the whole redirect on a first-run machine, so `record-touched` never ran and attribution silently recorded nothing). |
| `46`    | Mid-turn mission artifact creation (coo:564). Adds authenticated `POST /api/missions/:id/artifacts`, authorized with `artifact:create` on the named mission, accepting `{ type, label }` plus at least one of `{ contentText, externalUrl }` (optional `objectiveId` / `sessionId` provenance). Leaves `delivery_id` null so agents can publish plans, notes, URLs, and similar records during a turn without delivering; `deliver` may still attach additional artifacts later. Adds the additive `ovld protocol add-artifact` subcommand (`POST /api/protocol/add-artifact`) and the equivalent `overlord_add_artifact` hosted-MCP tool (mirrored by the codex/cursor/antigravity connector shims). Both call the same `createArtifact` service: required `--mission-id` / `missionId`, `--type` / `type`, `--label` / `label`, plus content via `--content-text`/`--content-text-file` / `contentText` and/or `--external-url` / `externalUrl`. Optional `--session-key` / `sessionKey` (auto-injected from the attach cache when present) stamps session/objective provenance. Non-HTTP(S) external URLs are rejected. MCP/CLI introduce no new artifact types or direct database writes. Existing `update-artifact` / `overlord_update_artifact` remains the revise path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `45`    | Agent-session capability truth and the Connector → CLI Agent Session Runtime → REST surface (coo:562, phase 0A). Adds `contract/harness-capabilities.schema.yaml` and a required per-adapter `connectors/adapters/<agent>/harness-capabilities.yaml` descriptor: the only hand-authored source of agent-session interaction capability truth, graded by the closed four-value status vocabulary (`supported`, `unsupported`, `not-implemented`, `unverified`) over a closed 17-value capability-id vocabulary that describes behavior rather than Claude hook names. `supported` requires an executable fixture that CI runs; `unsupported` requires a reason plus a stable `evidenceRef`; `not-implemented` and `unverified` require a tracker id; promoting a status out of `unsupported` must replace `evidenceRef` with fixtures in the same change. `connector.integrationShape` (`callback` \| `extension` \| `controlPlane`) is declared so the core gates decision-window policy on a capability rather than on an agent identifier, and `connector.capabilityTier` (0 Unsupported, 1 Observational, 2 Answerable, 3 Conversational) is **derived from passing fixtures and never authored or persisted**. The existing four hook-named capability flags and the closed four-value `hookTypes` enum are retained as a **generated, deprecated projection** of the descriptor for one release; hand-editing them is now a contract violation, and `permissionHook`/`PermissionRequest` may only be projected when a descriptor capability actually rides on that native event — which removes Cursor's false universal `PermissionRequest` claim, since Cursor maps that event to null. Every shipped connector (Claude, Codex, Cursor, Pi, Antigravity) ships a descriptor and a mandatory unbound-session negative fixture; Antigravity begins `unverified` throughout rather than inheriting capabilities by resemblance. Adds the **Connector → CLI Agent Session Runtime → REST** interaction surface: connector integrations hand native payloads to `ovld agent-session` subcommands, and only the CLI talks to the backend, over the versioned `/api/agent-session-channels/v1/*` adapter route family authenticated by a channel-scoped credential that can affect exactly one channel and can neither read mission context nor resolve a human decision. A native session id is a **correlation alias only**; the verified channel/session credential is the authorization and mission scope, and neither the working directory nor an unverified native id is ever a binding authority. Phase 0A ships only the offline, human-facing `ovld agent-session capabilities` reader plus `ovld doctor` descriptor-digest and native-session-binding reporting, both of which make no network call for an unbound session; the adapter runtime subcommands and the REST route family land with the channel bootstrap.                                                                                                                                                                                                                                                                                                                                           |
| `44`    | Execution-target type vocabulary cleanup (coo:528). Removes the unused core `ssh` value from documented `execution_targets.type` core values and tightens the shipped database CHECK to `local` and `virtual` only; any legacy `ssh` rows are rewritten to `virtual` during migration. Drops the unread `execution_requests.target_kind` column and its hardcoded writers. The `local`/`virtual` claimant-security boundary is unchanged; transport variety remains in the provider registry, and `execution_targets.type` stays an open extension vocabulary for adapter-defined values.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `42`    | Project-link metadata protection (coo:520). The existing checkout-local `writeProjectMetadata` capability used by `ovld create-project`/`ovld add-cwd` and the Desktop bridge continues to write only a read-write resource's `.overlord/project.json` link metadata. On each link it also idempotently maintains the checkout-root `AGENTS.md` and `CLAUDE.md` with a marked rule that agents must not edit that metadata, adds only `.overlord/tmp/` and `.overlord/logs/` to the checkout's `.gitignore` (never `project.json` or all of `.overlord/`), and installs a cooperative Git `pre-commit` guard that rejects staged `.overlord/project.json` changes. Existing instruction files, ignore rules, and hooks remain preserved; the guard is local checkout policy and does not alter Git transport or any REST/protocol interface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `41`    | Execution-target user control (coo:522, phase 4). `GET /api/workspaces/:id/execution-targets` additively projects safe local runner-instance diagnostics (instance id, native/adopted relation, label/version, supported agents, health, heartbeat, and bounded error code) and an honest unavailable reason; it never exposes capabilities blobs, credentials, or runner addressing. `PATCH /api/workspaces/:id/execution-targets/:targetId` additively accepts `{ status: 'active'\|'disabled' }` alongside label, requires workspace update permission, and emits the normal target change; disabled targets are excluded from eligibility and runners reject claims for them, while queued work remains target-level and may be re-enabled later.`LaunchObjectiveBody.executionTargetId`is an optional explicit target override: the launch service validates the target in the objective workspace for active member access, active/reachable eligibility, and primary-resource connectivity before stamping `execution_requests.execution_target_id`. The override selects a target only; any healthy runner serving it may claim, and no runner-instance selection surface is introduced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `40`    | Local runner instances, AgentPod adoption, and honest local liveness (coo:522, phase 3). Adds the core `execution_target_runner_registrations` table: a **one-to-many** record of the live runner processes serving one `local` execution target, carrying `runner_instance_id`, a `native`/`adopted` `relation`, non-secret `label`/`runner_version`/`capabilities_json`/`supported_agents_json` diagnostics, and `health`/`last_heartbeat_at`/`last_error_code`. The gateway-owned `execution_target_registrations` table is **unchanged** and remains exactly one registration per `virtual` target. Adds the nullable `execution_requests.claimed_by_runner_registration_id` FK so a local claim records which runner instance won it, alongside the existing `claimed_by_execution_target_id` (target) and `claimed_by_gateway_instance_id` (virtual). `POST /api/runner/claim` additively accepts `executionTargetId`, `runnerInstanceId`, `runnerRelation`, `runnerLabel`, `runnerVersion`, `capabilities`, and `supportedAgents`: an explicit `executionTargetId` is **resolved and authorized** (existing, non-deleted, type `local`, `status = 'active'`, active access for the authenticated member) and never created, and a claim with a `runnerInstanceId` upserts **only** the runner-instance row. Runner claiming stays **target-level** — any healthy runner registered to the selected target may claim it; runner instances are never individually addressable. Local target reachability is now derived from a recent healthy/degraded runner registration rather than `devices.last_seen_at`; a target that has never had a runner registration keeps the legacy `devices.last_seen_at` behavior so existing installs stay reachable until their upgraded runner publishes its first heartbeat. Virtual liveness continues to read `execution_target_registrations` unchanged. The CLI sends a stable runner-instance identity (`OVERLORD_RUNNER_INSTANCE_ID`, otherwise a persisted local id) and honors `OVERLORD_EXECUTION_TARGET_ID` / `OVERLORD_RUNNER_RELATION`, which is how an AgentPod container adopts its host's execution target: it supplies the host target id plus its own distinct runner identity and `adopted` relation, and never falls back to declaring a target.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `39`    | Intentional execution-target onboarding (coo:522, phase 2). Creating a `local` `execution_targets` row is now reserved for exactly two acts a human performs during setup: `POST /api/protocol/register-target` (`ovld add-et`, and the new additive `POST /api/workspaces/:id/execution-targets` one-click desktop equivalent), and an **eligible machine-local checkout link** — a `local_checkout` project-resource source written by a caller that carries a real machine-local host hint. The per-machine launch-settings mutations (`PATCH /api/workspaces/:id/launch-settings/agents/:agentKey` and `/terminal-profile`) **no longer declare**; they now resolve the acting machine's already-declared target and fail with `409 no_execution_target_registered` when it has none, so a settings write is never an onboarding trigger. Creating a `local_checkout` source without an explicit `executionTargetId` and without a machine-local hint fails with `409 no_execution_target_registered` instead of silently creating a target or a pathless global source; an explicit `executionTargetId` (the browser editing a source for an already-selected target) and a Git/URL `sourceUrl` source (project-global) create nothing. `ovld auth login`, `ovld setup`, and `ovld runner install`/`start`/`supervise` create no execution target: setup declares only through the explicit `register-target` call it now makes on the user's behalf, and the runner reports the missing declaration. CLI, desktop, and webapp no-target states become actionable rather than blank. No schema change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `38`    | Execution targets are declared, never inferred (coo:522, phase 1). An `execution_targets` row of type `local` is now created **only** by an explicit declaration — `POST /api/protocol/register-target` (`ovld add-et`) or a machine-local project-resource checkout link — plus the per-machine launch-preference mutations that persist settings for the acting machine. No read, project-discovery, protocol-lifecycle, observation-attribution, or runner path may create one. The `x-overlord-device-*` request headers are demoted to an **optional machine-local lookup hint**: they identify which already-declared target a co-located CLI/desktop caller means, are never authentication, authorization, or audit identity, and never authorize provisioning. Ordinary browsers and the mobile app stop sending them entirely (the webapp's `localStorage` pseudo-fingerprint is removed); only the desktop shell bridge and the CLI send a real machine fingerprint. `POST /api/runner/claim` now resolves an existing non-deleted `local` target for the acting machine and fails with `409 no_execution_target_registered` when none exists instead of provisioning one. `LaunchSettingsDto.executionTargetId` and `.deviceLabel` become nullable (`null` = "this caller has no declared execution target"); reading launch settings no longer provisions anything, while the launch-config/terminal-profile mutations still declare the acting machine because they persist that machine's own preferences. Protocol session/resource attribution, project discovery, and target-resource/mission-branch observation attribution all tolerate a null acting target; observation reports for a target the caller is not acting as still fail `403 execution_target_mismatch`. The v34 orphan-device sweep and the browser/backend-host provisioning guards are retained as legacy cleanup, not as the model. No schema change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `37`    | Agent artifact update across protocol, MCP, and CLI (coo:518). Adds the additive `ovld protocol update-artifact` subcommand (`POST /api/protocol/update-artifact`) and the equivalent `overlord_update_artifact` hosted-MCP tool (mirrored by the codex/cursor/antigravity connector shims). Both call the existing REST-backed `updateArtifact` service used by `PATCH /api/missions/:id/artifacts/:artifactId`: required `--mission-id` / `missionId`, `--artifact-id` / `artifactId`, and `--expected-revision` / `expectedRevision`, plus any non-empty subset of `--label` / `label`, `--content-text` or `--content-text-file` / `contentText`, and `--external-url` / `externalUrl`. No session key is required so a later objective or follow-up can revise an artifact created earlier. Authorization remains `mission:update`; provenance and `contentJson` stay immutable; stale revisions return `409`. MCP/CLI introduce no new artifact types or direct database writes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `36`    | Hosted MCP delivery artifacts (coo:503). The additive `artifacts` input on `overlord_deliver_session` accepts the existing delivery-artifact shape (`type`, `label`, optional text `content`, optional HTTP(S) `url`) and forwards it unchanged to the existing Protocol Layer `deliver` operation. It is authorized, validated, persisted, and projected exactly as a CLI delivery artifact; MCP adds no direct database access, artifact type, or lifecycle transition. This permits a hosted scheduled review to publish its full report on a short publish objective while leaving the separately-created remediation objectives as drafts for later execution.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `35`    | Desktop mission deep links (coo:502). The Desktop Shell owns the additive `overlord://missions/<missionId>` custom URL, where `missionId` is a UUID or workspace display id matching `[A-Za-z0-9:_-]{1,64}`. The main process rejects all other mission URL shapes, focuses or creates the shell window, and sends the shell-local `overlord:navigate` preload notification with the fixed `/user/missions/<missionId>` route; the feature-detected SPA bridge navigates only to that supplied internal route. Mission deep links carry no credential, ticket, or payload. Existing `overlord://auth/callback` OAuth handling remains restricted to its opaque, single-use ticket and is security-separated from mission navigation. The CLI additionally owns the local-only `ovld protocol mission-link` formatter: it reads only the cwd active-mission pointer or launch environment and prints the same credential-free URL without a backend request. Connectors that already declare the approved `Stop` hook may invoke this formatter as a non-blocking terminal footer; no new hook type or capability is introduced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `34`    | Orphan device cleanup (coo:456). A `devices` row is meaningful only while at least one non-deleted `execution_targets` row references it. Soft-deleting a workspace execution target also soft-deletes its linked device when that was the device's last live target. Workspace target projection and local-target provisioning opportunistically soft-delete any remaining devices that have no live execution target. Re-registering the same fingerprint revives the soft-deleted device (and recreates its local target) rather than inserting a conflicting row under the unique `(workspace_id, fingerprint)` index.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `33`    | Shared GitHub OAuth App registration for login and repository authorization (coo:448 follow-up). The repository-authorization flow now derives its client id and secret from the same `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` configuration as Better Auth GitHub sign-in. The grants remain security-separated: repository authorization is an explicit second flow requesting `repo read:org`, uses its own profile-bound single-use state, persists its own AES-256-GCM-encrypted token, and never exposes that token to Better Auth, clients, DTOs, logs, realtime, or change projections. Its callback is `/api/auth/callback/github/repository`, a subpath of the OAuth App's registered `/api/auth/callback/github` URL, and is handled before the Better Auth wildcard route. The workspace GitHub App installation and credentials remain entirely separate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `32`    | Composite mobile project initialization (coo:448). Adds authenticated `POST /api/projects/initialize`, explicitly authorized with `project:create` in the supplied workspace. The request supplies a caller-generated idempotency key, trimmed project name and description, plus optional `{ createGitHubRepository: true, githubOwnerLogin }`; it atomically creates the project and first draft mission/objective before any external call. GitHub provisioning is then retryable under the same key through the connected user OAuth credential, always creates a private empty repository at the selected eligible personal/organization owner, and never uses or alters the workspace GitHub App installation. A provisioning failure preserves and returns the project/mission with typed retryable status; success persists exactly one extension GitHub project link and exactly one non-primary read-only `git` project resource with the HTTPS clone URL. Extension-private `ext_github_project_initializations` records the request key, profile/workspace ownership, internal IDs, selected owner, provisioning state, and non-secret repository metadata; it contains no OAuth credentials and deduplicates retries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `31`    | User-scoped GitHub repository-creation authorization (coo:448). Extends the existing `/ext/github` REST extension with authenticated `GET /user-connection`, `POST /user-connection/authorize`, `DELETE /user-connection`, and `GET /repository-owners`, plus a browser OAuth callback whose opaque, single-use state is server-persisted and profile-bound. The connection is distinct from Better Auth GitHub sign-in and the workspace GitHub App installation: it requests `repo read:org`, stores access and optional refresh credentials only as AES-256-GCM ciphertext under a server-held key, and never returns credentials or OAuth state through a DTO, mobile storage, logs, realtime, or change projections. Connection DTOs expose only configuration/connection/account metadata. Repository owners contain the authenticated user's personal account plus only active organizations whose GitHub organization policy permits that user to create private repositories; owner enumeration grants no Overlord workspace authority. Two extension-private tables, `ext_github_user_connections` (one active row per profile) and `ext_github_user_oauth_states` (hashed short-lived state, consumed once), retain account metadata and encrypted credentials without changing the existing one-installation-per-workspace GitHub App model.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `30`    | Editable mission artifacts (coo:449). Adds authenticated `PATCH /api/missions/:id/artifacts/:artifactId`, authorized with the existing `mission:update` permission on the artifact's mission. The route accepts `expectedRevision` plus any non-empty subset of `{ label, contentText, externalUrl }`, preserves immutable delivery/session/objective provenance and `contentJson`, rejects a stale revision with `409`, non-HTTP(S) external URLs, or a resulting artifact with no text, JSON, or URL content, increments the artifact revision, and emits an `artifact` entity-change projection in the same transaction. The web client renders `contentText` as safe Markdown and uses this route for in-place label, Markdown, and URL edits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `29`    | Standard mobile push notifications (coo:444). Adds a standard alert/background push surface that is strictly separate from the coo:439 Live Activity surface while reusing the same durable dispatch machinery. New authenticated Mobile → REST routes `PUT /api/mobile/push/device-token` (`{ deviceToken, environment, bundleId, appVersion? }`) and `POST /api/mobile/push/device-token/revoke` (`{ deviceToken }`) register/rotate and revoke an opaque APNs **device** token; the token is carried in the body, never the URL, and has no read surface. New authenticated profile routes `GET`/`PUT /api/profile/notification-preferences` expose `{ enabled, categories: { category, mode }[] }` where `mode` is `alert` \| `silent` \| `off`. Two new private core tables: `device_push_tokens` (unique per `device_token`, bound to one profile, carrying `environment`/`bundle_id` so sandbox and production installs coexist) and `notification_preferences` (unique per `(profile_id, category)`). Categories are lifecycle-only: `mission_awaiting_review`, `agent_question`, `mission_complete`, `mission_failed`. The same lifecycle mutations that refresh Live Activities also enqueue deduplicated `overlord.push_notification.dispatch.v1` worker jobs carrying only ids; the new in-process dispatcher recomputes the presentation snapshot at delivery time and sends APNs `alert` (priority 10, one-hour expiration) or `background` (priority 5) pushes on the plain `<bundleId>` topic, collapsed per `(missionId, category)`. Invalid device tokens (`410`/`400 BadDeviceToken`) are retired. Payloads contain only bounded project name, sanitized mission title, display id, badge count, mission id, category, and deep link — never bearer tokens, ActivityKit tokens, objective instructions, agent prompts, delivery summaries, question text, file paths, or event payloads. ActivityKit tokens and device tokens are never interchangeable: separate tables, routes, topics, and push types.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `28`    | Mobile Live Activity push handoff (coo:439). Adds the `mobile` REST-consumer component and its authenticated Mobile → REST surface: `PUT /api/mobile/live-activities/:activityId/push-token` registers or rotates an opaque ActivityKit token for the caller's account-level activity, and `DELETE /api/mobile/live-activities/:activityId/push-token` revokes it. The core `live_activity_push_tokens` table stores registrations privately and is never exposed by a read endpoint. Mission/objective execution and completion changes enqueue coalesced `overlord.live_activity.dispatch.v1` jobs; the backend recomputes the same bounded account snapshot (two executing missions and one recent completion) and sends APNs `liveactivity` update/end payloads. APNs delivery is durable/retried, transition updates are immediate, visible-content-equal progress is suppressed for five minutes, and invalid APNs tokens are retired. Payloads contain only the presentation snapshot — never authentication tokens, objective instructions, prompts, or event detail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `27`    | Individual project-resource source removal (coo:425). Adds the additive `DELETE /api/projects/:id/resources/:resourceId/sources/:sourceId` REST route, authorized with the existing project-update permission. It soft-deletes only the named active `project_resource_sources` descriptor scoped to the named project/resource, leaving the logical `project_resources` identity intact so it can be reconnected to another source. The resource revision advances and emits the existing `project_resource` entity-change projection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `26`    | Standalone execution-target registration (coo:422). Adds the additive, "parentless" `register-target` protocol subcommand (`POST /api/protocol/register-target`; optional `--name` display label and `--workspace-id` [id, slug, or name]), surfaced as the top-level `ovld add-et --name <name>` CLI command, so a machine can announce itself as an execution target up front rather than only as a side effect of launching, claiming, or linking a resource. The backend provisions (or reuses, idempotently) the acting device's `local` execution target for the resolved workspace via the existing `ensureActingDeviceTarget` path — the CLI's `x-overlord-device-*` headers identify the machine — and applies `--name` as the target label (create or rename). Like `create-project` it resolves the workspace from the caller's active memberships: one membership registers there; an explicit `--workspace-id` naming a membership registers there; multiple memberships with none named return a non-error `{ status: 'workspace_selection_required', workspaces: [...] }`. Per-workspace `execution_request:claim` RBAC is enforced against the resolved target (already in the `mission_lifecycle` token scope, so runner/agent tokens can self-register); no scope change. No schema change — it reuses the existing `devices`/`execution_targets` tables.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `25`    | Record completed agent work as a review mission (coo:418). Adds the additive `overlord_record_work` hosted-MCP tool (mirrored by the codex/cursor/antigravity connector shims), alongside the existing `ovld protocol record-work` subcommand and `POST /api/protocol/record-work` route, so an agent can log work already finished in chat as one completed mission with no attach/deliver cycle. `record-work` now accepts its whole submission as a single `--payload-json`/`--payload-file` envelope (`{ objective, summary, title, changeRationales, changedFiles, artifacts }`) — explicit flags still win over envelope fields — and additionally accepts `--changed-files-json`/`--changed-files-file`. `recordWork` now records a `changed_files` row for every change rationale's file path (surfaced `covered` in review) plus any explicit changed files (surfaced `missing_rationale`), so the review file panel and rationale coverage match a normal `deliver`; these rows carry a NULL `session_id`/`resource_id` since record-work has no session. Delivery still enqueues the `overlord.delivery.compose.v1` compose job so the Gemini delivery summary runs identically to a normal delivery. `mission:*` in the `mission_lifecycle` scope already authorizes the tool; no scope change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `24`    | Agent project creation over protocol and hosted MCP (coo:405). Adds the additive `ovld protocol create-project` subcommand (`--name` required; optional `--workspace-id` [id, slug, or name], `--description`, `--slug`) and the equivalent `overlord_create_project` hosted-MCP tool (mirrored by the codex/cursor/antigravity connector shims). Both resolve the target workspace from the caller's active memberships: exactly one membership creates there; an explicit `--workspace-id`/`workspaceId` naming a membership creates there; when the caller has multiple memberships and none is named, the call returns a non-error `{ status: 'workspace_selection_required', workspaces: [...] }` result (rather than defaulting) so the agent asks the user to choose. Per-workspace `project:create` RBAC is enforced against the resolved target. The `mission_lifecycle` token scope preset now grants `project:create` (in addition to `project:read`) so hosted-MCP and runner tokens can create a project to work in; `project:update`/`project:delete` and other administration remain excluded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `23`    | Runner claim long-polling (coo:414). `POST /api/runner/claim` remains the same authorized atomic claim surface and response shape, but on the Postgres adapter it now holds an otherwise-empty claim request for at most 25 seconds, using a dedicated LISTEN connection and an `execution_requests` queue notification to retry promptly. The response additively carries `longPoll: true` when that capability is available. The PostgreSQL trigger only signals queue insert/requeue candidates; services still perform authorization and atomic compare-and-set claims, so notification payloads grant no access and missed/competing notifications resolve to the normal empty response. SQLite preserves immediate claim behavior and returns `longPoll: false`, allowing local runners to use their existing fallback cadence. The CLI reconnects immediately after a Postgres long-poll timeout or empty wake and never busy-polls an idle hosted runner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `22`    | Project list lifecycle filtering (coo:382). `GET /api/projects` and `GET /api/workspaces/:id/projects` now return active projects by default. Both accept the additive `lifecycle` query parameter: `active` (default), `archived`, or `all`. The parameter is authorization-neutral: the existing project-read membership check still scopes every result. Clients must request `archived` for archive-management views and `all` only when an interaction needs both lifecycle states (for example, full sidebar ordering); ordinary project selectors receive only active projects through the default query.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `21`    | Workspace transport retirement (coo:379). Removes `X-Overlord-Active-Workspace`, the `overlord_active_workspace` cookie, activation-derived request state, unscoped workspace-settings routes, `WorkspaceDto.isActive`, and `/api/meta.workspace` as authorization or request-scoping interfaces. Auth resolves an authenticated profile/credential only; named resources derive their workspace and membership, workspace-owned settings use `/api/workspaces/:id/...`, and account-wide lists/search/realtime aggregate the caller's authorized memberships server-side. Realtime/catch-up filters before projection and exposes additive `EntityChangeDto.workspaceId` while preserving its global monotonic cursor. Adds authenticated default-project preference routes (`GET\|PUT\|DELETE /api/profile/default-project`) backed by the account-wide `project_user_preferences.preferences_json.overlord.defaultProject` marker; the preference grants no access and is ignored if inaccessible. Parentless creates require an explicit workspace when multiple memberships exist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `20`    | Agent launch flags as positional name/value pairs (coo:381). `AgentLaunchConfigDto.flags` and `UpdateAgentLaunchConfigBody.flags` are now `AgentLaunchFlagDto[]` (`{ name, value? }`) instead of `string[]`. Launch pipelines flatten each entry to separate argv tokens (`--permission-mode`, `auto`). Legacy stored `string[]` values (`--verbose`, `--permission-mode auto`, `--permission-mode=auto`) normalize on read via `normalizeAgentLaunchFlags` in `@overlord/contract`. CLI `ovld launch --flag` passthrough parses the same text forms.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `19`    | Reference (read) project resources (coo:368). Adds `project_resources.access_mode` (`'read' \| 'read_write'`, default `read_write` so existing rows are unchanged) surfaced additively as `ProjectResourceDto.accessMode` and settable via `CreateProjectResourceBody.accessMode` / `UpdateProjectResourceBody.accessMode`. A primary resource is always coerced to `read_write`; a non-primary resource defaults to `read` when the caller omits the field. `read` (reference) resources are readable/navigable context but behave differently from `read_write`: they are NOT linked into `.overlord/project.json` when added (the service and clients skip the metadata write), and they are NOT offered in the resource picker (`distinctProjectResourceKeys` filters them). They ARE still included in the resource-paths env — the `OVERLORD_PROJECT_RESOURCES` manifest carries `accessMode` per entry and file-path sources of any access mode contribute their path to `OVERLORD_PROJECT_RESOURCES_PATHS`; URL/git sources contribute no path and are therefore excluded. `ovld add-cwd` / `ovld add-url` accept `--access read\|read_write`. `OVERLORD_PROJECT_RESOURCES_PATHS` / `_CSV` are comma-separated absolute paths where every entry carries an explicit `:rw` (`read_write`) or `:ro` (`read`) suffix; parsers treat a missing suffix as `rw` and tolerate whitespace around entries. Launch flows always emit explicit suffixes. Shared helpers live in `@overlord/contract` (`formatProjectResourcePathsFromManifest`, `parseResourcePathsCsv`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `18`    | Rich delivery rollout parity (coo:364 phase 4). Full `mission.delivered` webhook envelopes add `delivery.report`, the same normalized `DeliveryReportPayloadV1` projection returned by the delivery REST read surface; it never exposes raw `deliveries.payload_json`, while thin webhook envelopes remain identifier/link-only. The delivery composition worker emits bounded, structured operational logs/metrics for queued, composed, fallback, failed, duration, model, and input-size counts, without logging prompt or delivery content.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `17`    | Asynchronous delivery composition (coo:364 phase 3). Activates the reserved `overlord.delivery.compose.v1` `worker_jobs` type: `deliverSession` / `recordWork` enqueue a durable compose job in the same transaction as the delivery commit, mark `deliveryReport.presentation.status` `pending`, and never wait on Gemini. A backend leased worker claims jobs, calls the built-in `compose-delivery` automation (schema-constrained Gemini JSON), sanitizes/reconciles against agent evidence and deterministic path-derived candidates, updates only `deliveryReport.presentation` via revision CAS, and emits `entity_changes(entity_type=delivery)`. Provider absence, timeout, invalid JSON, or hallucinated items leave the deterministic/fallback presentation intact. Adds the previously documented but unimplemented `worker_jobs` table to SQLite/Postgres migrations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `16`    | Rich delivery read surface (coo:364 phase 2). Adds the additive `GET /api/missions/:id/deliveries` REST endpoint, authorized with the mission's existing `mission:read` permission and returning normalized `DeliveryDto` records rather than raw `payload_json`; legacy deliveries synthesize a deterministic V1 report at read time. Delivery `MissionEventDto` records now carry an additive `deliveryId` parsed from their event payload, allowing clients to open the corresponding immutable delivery record. `ovld mission deliveries` now calls this endpoint. The web client may lazily load delivery records and render the deterministic Markdown, blue human-actions section, and amber tradeoffs section; normal `mission_event` and future `delivery` change-feed rows invalidate the relevant delivery queries. No Gemini composition is introduced in this phase.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `15`    | Rich delivery evidence (coo:364 phases 0–1). Adds the additive, versioned `deliveryReport` payload stored in `deliveries.payload_json`. New deliveries normalize agent-provided `humanActions`, `tradeoffsMade`, `knownRisks`, `deferredWork`, and `assumptions`, filter Git operations and routine QA from human actions, and store an immediate deterministic presentation without depending on an AI provider. The existing summary remains the immutable agent narrative; legacy and summary-only deliveries remain valid with empty evidence arrays. `ovld protocol deliver` accepts this optional payload through its existing `--payload-json` / `--payload-file` envelope, while hosted MCP exposes equivalent optional evidence fields. `overlord.delivery.compose.v1` is documented as a core `worker_jobs.type` reserved for the later asynchronous composition phase; it is not enqueued by phases 0–1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `14`    | Per-project launch preparation (coo:359). Adds two additive, backward-compatible project launch-preparation surfaces stored as namespaced keys in `projects.settings_json`: `overlord.preLaunchCommands` (ordered shell command lines) and `overlord.launchEnvVars` (user-defined `NAME=value` environment variables). Both are surfaced read-side on `ProjectDto` (`preLaunchCommands: string[]`, `launchEnvVars: Record<string,string>`) and settable via `UpdateProjectBody` (`preLaunchCommands?`, `launchEnvVars?`); no new columns or closed-vocabulary values. The runner claim response (Runner→REST queue surface) carries both for the runner launch path; a manual `ovld launch` fetches them from the mission's project. The CLI launch flow (Runner/Launch component) exports `launchEnvVars` into the agent launch environment and then runs `preLaunchCommands` after the terminal enters the working directory and exports the launch env, but before the agent process starts. Both support `{VAR_NAME}` placeholder substitution against the resolved launch context (e.g. `{OVERLORD_PROJECT_RESOURCES_PATHS}`); unknown placeholders are left verbatim. The variable set is intentionally open-ended; built-ins are documented in the shared `LAUNCH_VARIABLES` catalog (`@overlord/contract`) and listed in Project Settings → Launch, with plan-build vs attach availability called out in the mission-launch-lifecycle docs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `13`    | Resource-derived workspace authorization and launch settings (coo:331). Adds `GET /api/workspaces/:id/launch-settings` plus `PATCH /api/workspaces/:id/launch-settings/agents/:agentKey`, `/terminal-profile`, and `/worktree-branch-automation`, authorized against the target workspace (`launch:read` to view, `launch:configure` to mutate; non-membership reads as 404) while retaining the legacy active-workspace routes. REST operations that name a project, mission, objective, execution request, execution target, stored object, webhook subscription, or extension-owned resource resolve the resource's owning workspace and the caller's matching `workspace_users` row before permission checks, persistence, external-provider access, or change-feed attribution; the active-workspace preference is only a navigation/create default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `12`    | User account and token lifecycle settings (coo:322). Adds `DELETE /api/user-tokens/:id`, authorized by the existing `user_token:self:revoke` capability, which may tombstone only a token already in `revoked` state; active, expired, and rotated tokens remain retained until they are explicitly revoked or otherwise managed through their existing lifecycle. The route returns `204`, never exposes token material, and emits an `entity_changes` `delete` tombstone. The web account settings use Better Auth's existing authenticated account APIs (`list-accounts`, `link-social`, `unlink-account`) to display, link, and unlink configured social providers; these auth-internal tables remain inaccessible to the REST/service layers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `11`    | Workspace-equal access surfaces (coo:324). Adds the additive workspace-scoped agent-catalog routes `GET /api/workspaces/:id/agent-catalog`, `PUT /api/workspaces/:id/agent-catalog`, and `POST /api/workspaces/:id/agent-catalog/refresh`, authorized per target workspace via the coo:96/coo:135 membership pattern (`launch:read` to view, `launch:configure` to mutate; non-membership reads as 404) so every workspace's `workspaces.settings_json.agentCatalog` is manageable without switching the active workspace. The legacy active-workspace `/api/agent-catalog` routes are unchanged. Web app: new-mission surfaces (new mission modal, quick task bar) list active projects from **every** accessible workspace of the active organization and read the agent/model catalog of the selected project's own workspace; the project chooser on an _existing_ mission remains limited to the mission's own workspace (cross-workspace mission moves stay rejected); workspace-settings Models and Archived Projects pages operate on the workspace being viewed rather than requiring it to be active.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `10`    | Hosted-web GitHub OAuth completion (coo:318). Adds the browser-only `GET /api/auth/browser/callback` and one-time `POST /api/auth/browser/exchange` handoff. The callback accepts only a configured trusted web origin, redirects there with a short-lived opaque ticket, and the web client exchanges that ticket once for its Better Auth session token. Neither the callback URL nor browser redirect exposes a session token, GitHub credential, bearer token, or reusable OAuth state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `9`     | Desktop session-token isolation (coo:318 follow-up). Remote desktop API and realtime requests authenticate exclusively with the active profile's Better Auth session token. The desktop no longer mints, reads, or prefers a `USER_TOKEN` for in-app requests, and clears the legacy desktop bearer-token slot during startup. `USER_TOKEN` remains the credential for CLI, runner, agent, and other headless clients.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `8`     | Desktop-remote GitHub OAuth bootstrap (coo:318). Adds the browser-only `GET /api/auth/desktop/github` initiation route. Electron opens this route in the system browser so Better Auth writes and later verifies its short-lived OAuth state cookie in the same browser cookie jar; the route accepts no caller-controlled callback and may initiate only the configured GitHub provider with the existing desktop callback. It redirects to the provider without exposing a session token, GitHub credential, bearer token, or reusable OAuth state to the renderer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `7`     | Desktop-remote GitHub OAuth completion (coo:69). Adds the authenticated browser-only `GET /api/auth/desktop/callback` handoff and one-time `POST /api/auth/desktop/exchange` session-token exchange. The callback may redirect only to `overlord://auth/callback` and carries an opaque, single-use, short-lived handoff ticket — never a Better Auth session token, GitHub credential, or bearer token. The Electron main process consumes the ticket directly against the active backend, stores the returned session token only via per-profile `safeStorage`, then reloads the shell; the renderer never receives the token through the deep link or preload bridge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `6`     | Execution-target and resource interface refactor (coo:266). Adds the additive admin-only `PATCH /api/workspaces/:id/execution-targets/:targetId` ({ label }) route to rename a workspace execution target. Web-app settings: the general-settings Execution Targets page is removed (its per-machine terminal/agent launch defaults fold into Terminal & IDE); workspace-settings targets gain inline name editing; project resources render as expandable accordions with per-resource source lists and an add-source flow that selects an execution target defaulting to the project's active target.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `5`     | Resource registration completion (coo:263). `ovld add-cwd --key` reuses the project-scoped logical resource identity and upserts its target-scoped `local_checkout` source. Adds `ovld add-url --url <git-url>` to register or update a project-global `git` source for that same identity. `POST /api/projects/:id/resources` accepts either a local `directoryPath` or a Git `sourceUrl`; source descriptors remain typed and secret-free.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `4`     | Workspace execution-target settings (coo:263). Adds the authenticated, workspace-scoped read projection `GET /api/workspaces/:id/execution-targets`, returning target identity, non-secret type/status/owner display metadata, reachability, and active workspace-member access count. The settings UI uses this projection to separate all workspace targets into individual expandable cards; it does not expose connection details, credentials, target creation, registration, or membership mutation. Project settings continue to select only the acting member's eligible targets through the existing project-target selection surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `3`     | Provider-neutral virtual execution targets and resource identity/source split (coo:258, coo:263). Adds `virtual` as a documented core `execution_targets.type`, the external **Virtual Target Gateway** boundary and its versioned `/api/virtual-targets/v1/*` REST surface (registration, claim, progress, launched, failed, grant exchange, mission resources, delegated actions), the `rest-consumer` conformance component type, seven new core tables (`execution_target_registrations`, `project_environment_definitions`, `project_resource_sources`, `execution_request_snapshots`, `execution_request_grants`, `execution_request_observations`, `mission_target_resources`) plus `execution_requests` snapshot/failure/gateway columns. `project_resources` is one project-scoped logical identity (`resource_key`, label, primary/lifecycle metadata) and `project_resource_sources` owns all target-specific/global materialization descriptors (local checkout paths, Git, bundles, opaque handles). Existing resource rows and observations are intentionally discarded so users re-add sources. The immutable `VirtualExecutionQueueItemV1` carries resource identities plus typed sources, not paths; `execution_requests.status` and every other closed vocabulary are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `2`     | ChatGPT Apps publication surface (coo:224). Adds explicit MCP tool output schemas and safety annotations, standard `ui://overlord/*` MCP Apps widget resources, structured tool results, and OAuth resource binding across approval and token exchange. Hosted MCP errors now distinguish tool failures from transport failures without exposing local checkout or runner capabilities.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `1`     | Resource-bound objectives and sibling resource context (coo:169). Adds logical `project_resources.resource_key`, target-portable `objectives.resource_key`, resource-scoped mission branch observations, additive `attach-response-v3` project resource manifest fields, optional `executionTargetId` protocol context input, `.overlord/project.json` `resourceKey`, `ovld add-cwd --key`, branch-action `resourceKey`, and resource-scoped worktree-path vectors. The worktree path algorithm now includes `resourceKey`, forcing this contract version bump.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `0`     | Initial public release baseline (coo:144). Describes the full component registry (including the MCP Server), interaction surfaces, stable interfaces (`attach-response-v3`, webhook delivery, organization → workspace → project hierarchy, multi-target `.overlord/project.json` linking, target-workspace project APIs, deliver `observedDirtyPaths` reconciliation, and `ovld protocol changes` preflight), extension points, and controlled vocabularies as shipped in Open Overlord v0. Pre-release contract versions 1–8 were consolidated into this baseline at public release.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

---

---

## [103]

Phase 3 exposes the authoritative project Run Queue to agents without creating a
second queue implementation. Additive Protocol `queue-objective`,
`dequeue-objective`, and `run-queue` resolve normal display-id and project
references, preserve existing RBAC, and use the Run Queue service for every
membership or ordering mutation. Queue placement accepts a queue, predecessor,
front, or one-based insertion position; entries remain execution-target neutral.

Hosted MCP and connector shims add `overlord_queue_objective`, which forwards
queue/add/remove intent through Protocol. `autoAdvance` is now a deprecated,
derived compatibility projection: Protocol create/prompt/add/update flags map
to Run Queue membership and preserve mission-local queue order. The legacy
storage write remains during this release, retires in the next release, and
column removal requires a later contract-version bump.

## [101]

The hosted MCP server and the local connector shim expose the same three
PM-management tools, each forwarding through Protocol to the established service
operation instead of defining a connector-only mutation:

- `overlord_list_deliveries` / `list-deliveries` reads one addressed mission's
  newest-first normalized `DeliveryDto[]` records. It uses mission read
  authorization and never exposes raw `deliveries.payload_json`.
- `overlord_launch_objective` / `launch-objective` queues the normal execution
  request for an objective UUID or display id. Its `agent` is required; model,
  reasoning effort, and an eligible execution target are optional. It retains
  `execution_request:create`, launchability and active-sibling checks, target
  resolution, and idempotent active-request behavior.
- `overlord_reorder_future_objectives` / `reorder-future-objectives` accepts a
  mission UUID plus the full ordered UUID list of that mission's future
  objectives. It retains `objective:update`, rejects non-future/missing/duplicate
  ids, and returns the existing full `ObjectiveDto[]` ordering.

These are additive command and MCP-tool interfaces. The hosted surface remains
unable to inspect local files, claim runners, mutate execution targets, or run
branch actions. The MCP conformance manifest validates against this contract
version.

## [99]

`GET /api/search/v3` is the grouped retrieval surface for the v98 search index.
Results stay one row per mission — the v2 fields survive — and each row carries
ranked `matches[]` for the objectives and deliveries that matched, plus
`anchorOnly` and pre-cap `matchCounts`. `event` documents corroborate score but
are never returnable. `matches` is the single source for child identity; it is
matched-only, not a complete objective list.

Group ranking is unchanged from v2 (MAX plus bounded corroboration, recency as
rank fusion). Child ranking is `docScore + 0.15 * missionScore`. The coverage
floor stays at mission level. Entity weights are mission 3.0, objective 2.0,
delivery 1.5, event 1.0. Per-workspace candidate fetch is `ORDER BY doc_score
DESC LIMIT 500`; SQLite joins `search_documents` from the FTS rowid rather than
recreating the virtual table. When the cap hits, `truncatedCandidates` is true
and `totalMatchedBeforeLimit` / `entityCounts` are lower bounds.

Additive filters: `entityTypes` (`mission` | `objective` | `delivery`, default
all three; `event` is rejected), `objectiveStates`, `matchesPerResult` (default
3, max 10). Excluding `mission` still returns the mission as the group anchor
with `anchorOnly: true`. An objective display-id query returns that mission
group with the named objective as its single match. REST v3 accepts only stable
project UUIDs. `GET /api/missions/search` and `/api/missions/search/v2` keep
their shapes and their mission/objective/event result sets. Protocol
`search-missions --response-version 3` returns `SearchResponseV3` with v3
defaults; entity-type flags and the canonical `search` alias remain a later
agent-surface change.

## [97]

A project reference on an agent surface is whatever the user called the project.
Protocol `--project-id` and MCP `projectId` accept a UUID, a slug, or a name,
matched case-insensitively against the caller's live memberships. The MCP-side
UUID gate is removed: it denied hosted agents a resolver the protocol layer
already implemented, leaving them with a bare 404 and nothing to ask the user
about.

Project slugs and names are unique per **workspace**, not per organization, so a
human reference can legitimately match twice. That is a question, not a failure.
Every protocol subcommand that resolves a project reference — `search-missions`,
`statuses`, `discover-project`, mission creation — returns

```json
{ "status": "project_selection_required", "message": "...", "projectRef": "...",
  "projects": [{ "id", "name", "slug", "workspaceId", "workspaceName", "workspaceSlug" }] }
```

instead of a 409, mirroring `workspace_selection_required` on the parentless
creates. The workspace labels are load-bearing: without them the caller holds two
identical-looking projects and cannot phrase the question. An additive
`--workspace-id` / `workspaceId` (id, slug, or name) narrows the retry; it only
ever narrows, never widening past live membership. The CLI resolves the same way
and reports candidates rather than silently taking the first match.

`MissionSearchDateField` additively accepts `dueDatetime`, and
`MissionSearchResultV2` additively carries `dueDatetime`. This is what makes
"what is scheduled for tomorrow" answerable: a mission is scheduled by its due
date, and `schedules` is a recurrence template that writes `due_datetime`
forward rather than a second notion of scheduling. Because the column is
nullable, a `dueDatetime` range excludes missions that were never scheduled —
the opposite of `createdAt`/`updatedAt`, and intended, since a due-date window is
a question about scheduled work.

REST `GET /api/missions/search/v2` is unchanged in project handling: it still
accepts only stable UUIDs in `projectIds`, so name resolution stays an explicit
step rather than an implicit one on the HTTP surface. `GET /api/missions/search`
remains frozen as v1.

## [96]

My Missions is keyed on status **type**, not status name. The aggregate board
renders exactly four columns — Next (`next`), Executing (`execute`), Review
(`review`), Completed (`complete`) — published from the contract as
`MY_MISSIONS_COLUMNS` / `MyMissionsColumnType`. The previous behavior, merging
per-project status lists by lowercase name, is removed along with the
"Uncategorized" bucket: every rendered mission now has exactly one home column,
because the column key _is_ its `statusType`. Missions in `draft`, `blocked`, or
`cancelled` statuses are outside the board vocabulary and are not listed on My
Missions; the read endpoint still returns them and clients filter.

`MyMissionReorderRequest` carries `statusType` instead of `statusId`. Because a
type column aggregates projects and workspaces, one reorder call now spans all
of them: the server resolves each moved mission's destination inside that
mission's own project as the lowest-position active status of the requested
type, and leaves the mission's concrete status alone when it already has that
type. Every mission is validated before any write, so a project that defines no
active status of the type rejects the whole call with
`STATUS_UNAVAILABLE_FOR_WORKSPACE` rather than half-applying the move. Personal
positions in `my_mission_positions` are unchanged in shape but are now numbered
across the whole aggregated column, so an order interleaving several projects
round-trips exactly.

## [95]

Cross-workspace authorization is organization-bounded. OAuth `USER_TOKEN`s bind
to exactly one organization and consent to either an explicit non-empty
workspace allowlist or every current and future workspace in that organization;
runtime access is always consent intersected with live membership and
per-workspace RBAC, and legacy tokens backfill only their recorded issuance
workspace. Request context resolves immutable `authorizedWorkspaces` by
operation taxonomy: entity-addressed, single-workspace, aggregate parentless,
or parentless-write; no operation falls back to an oldest membership.

Cross-workspace search has deterministic, non-redistributed even per-workspace
quotas and no cross-organization fan-out. The quota and `limit` allocate mission
groups, never individual indexed documents. `matchesPerResult` on v3 is a
separate per-group cap and is not divided across workspaces. Existing
`GET /api/missions/search` remains v1; additive `GET /api/missions/search/v2`,
Protocol `search-missions --response-version 2`, and MCP `overlord_search_missions`
v2 return a versioned envelope with result labels, match evidence, filters, and
truncation counts. Additive `GET /api/search/v3` and Protocol
`search-missions --response-version 3` return grouped `SearchResponseV3` with
identifiable objective and delivery matches. Date filters select `createdAt`,
`updatedAt`, or `dueDatetime`, defaulting to `updatedAt` only with a range, and
use inclusive `from` / exclusive `to`. REST v2 and v3 take stable project UUIDs;
Protocol, CLI, and MCP resolve human project references and answer an ambiguous
one with `project_selection_required` (see Version 97).
