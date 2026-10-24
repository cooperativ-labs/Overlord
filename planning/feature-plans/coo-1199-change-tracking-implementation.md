# Change tracking and delivery implementation

Objective: coo:1199.khvj. Date: 2026-10-24. Status: implementation specification; runtime changes are not implemented.

This document replaces `coo-1199-change-tracking-delivery-recommendation.md` and `coo-1199-change-tracking-plan-review.md`. It incorporates the review decisions below. The scope is a single breaking cutover, with no legacy API aliases or dual writes. The current contract remains authoritative until implementation updates it first.

## Product result

A delivery has a concise narrative explaining the outcome, why the changes matter, verification, and material limitations. A separate compact list shows **Files changed during this objective**, grouped by resource. No per-file explanation is requested, generated, stored, or displayed. Keep structured verification, operator actions, and decision-level tradeoffs; these are independent of per-file rationales.

The list is cumulative objective evidence, including edits later reverted. It is not a current Git diff, a delivery-time snapshot, proof of exclusive ownership, or proof that every edit was captured. Historical deliveries show the same cumulative objective list with that label. Missing tracking and pending sync are visible and never block delivery.

Agents prepare delivery by reading captured paths, declaring known shell/script outputs missing from capture, and summarizing their own work by behavior or component. A handful of representative paths is enough. No shared-worktree diff or status inventory is required. Never infer ownership from timestamps, cwd, a branch, or an unrelated dirty file.

## Decisions on Claude's review

| Review item | Decision and implementation consequence |
| --- | --- |
| 1. Shell edits are invisible | Accept. Reconcile known shell/script writes, deletes, and both rename endpoints through explicit path declarations. Shell activity means capture may be incomplete, not proof a file changed. Read-only shell commands must not be described as known edits. |
| 2. Silent unbound hook | Accept the problem; refine the fix. Attach records declared capture binding, not proof that hooks are installed or running. Distinguish unbound, bound-but-unverified, and observed callbacks. A successful CLI attach cannot prove the hook's PATH resolves the same binary. |
| 3. Separate declared provenance | Accept. Keep `declared_edit` as the native evidence wire value and add `agent_declared`; show Native / Declared. Health is not provenance. |
| 4. Remove window vocabulary | Accept removal of `window_observed`, `quality`, `overlap`, and `toolWindowId`. Do not reduce the complete DTO to four fields: retain IDs and resource identity needed for authorization, grouping, refresh, and deduplication. |
| 5. Successful edits only | Accept, with correction. OpenCode already sets `outcomePath`; the claim that no codec does is false. Codex/Cursor lack it, and capture currently never checks the normalized outcome. Verify actual harness payloads and event guarantees before choosing result fields; do not guess a mapping. |
| 6. Rename headers | Accept. Parse `*** Move to:` as well as Add/Update/Delete headers, retaining both source and destination. Preserve existing bounds and path validation. |
| 7. Local-only file read | Accept as a fast local read, not as complete objective history. Ledger identity contains directory, objective, and session; retained synced rows do not guarantee access after session cleanup, another resource, or another device. Provide an explicit local scope and a server objective read. |
| 8. Defer snapshots | Accept. No snapshot table or second list. Label all lists cumulative; late sync may extend them. |
| 9. Cheap delivery preparation | Accept. Read evidence once, reconcile known omissions, write the summary. Do not add an exhaustive manual bookkeeping gate. |
| 10. Composer | Keep the existing optional composer in this cutover. It may condense supplied narrative/report facts, never infer behavioral claims or explanations from filenames. Removing composition entirely is outside this change. |
| 11. Small omissions | Accept. Remove `vcsStatus` from this feature, explicitly update delivery webhooks, shared skill version, connector versions, generated catalogs/capabilities, and mobile consumers. |

## Verified implementation anchors

- `cli/src/change-ledger.ts`: schema version 2; ledger key hashes canonical directory, objective and session key. `readChangeLedgerEvidence` includes synced rows; `readUnsyncedChangeEvidence` filters them. Preserve locking, owner-only atomic files, normalization, ignore rules, and bounded retention.
- `cli/src/commands.ts`: Protocol `changes` already enumerates locally known objective sessions, attempts sync, and can finalize pending-delivery sessions. Capture the evidence view before cleanup. The separate top-level `ovld changes status|rationales` reads a mission-capped REST list and filters afterward; remove the rationale subcommand/JSON alias and fix objective filtering before the cap.
- `cli/src/capture-change.ts`: currently accepts normalized `file.edited` paths without outcome filtering; shell/unknown events produce `direct_path_unavailable`.
- `packages/core/service/agent-session/pure/codec.ts`: patch regex omits Move headers. `readOutcome` supports success, error, blocked and cancelled, but not arbitrary numeric exit codes. Adding only a YAML path to an exit code is insufficient.
- `connectors/adapters/{codex,cursor,opencode}/codec/`: Codex/Cursor have no outcome mapping; OpenCode maps `properties.part.state.status`. Success-only hook guarantees must be fixture-backed per adapter/version.
- `connectors/core/scripts/capture-change-hook.sh`: exits before reading input when the explicit environment binding or CLI is absent. Retain the no-cwd-inference rule.
- `packages/core/service/protocol.ts`: rationale normalization/writes, changed-file upserts, record-work, deterministic delivery actions. `backend/repository.ts` joins rationale prose onto file rows.
- `packages/contract/src/index.ts`: `FileChangeDto` includes IDs, resource, prose, VCS and window metadata. `packages/core/service/webhook-events.ts` owns the delivery envelope.
- `packages/core/service/delivery-compose.ts`, `backend/delivery-compose-worker.ts`, and `automations/src/compose-delivery/compose.ts`: composition evidence consumers.

## Evidence and persistence contract

### Path rows

Define the replacement `FileChangeDto` in the shared contract with `id`, `missionId`, `objectiveId`, `resourceKey` (nullable), `filePath`, `source` (`declared_edit | agent_declared | null`), `observedAt`, and nullable bounded `hookHealth`. UI derives the basename. Remove `label`, `summary`, `why`, `impact`, `vcsStatus`, `quality`, and `overlap`; remove `toolWindowId` from sync/storage. Replace the misleading timestamp name `createdAt` with `observedAt` across consumers in the same cutover.

Keep identity resource-aware: one displayed row per objective + resolved resource + normalized relative path. Equal relative paths in different resources must remain distinct. Resolve resource from the authorized session, not a caller-supplied path claim. Sessionless record-work uses a null resource unless a separately authorized resource binding exists. Audit the current unique key and upsert SQL; migrate them if resource is not already included. Two objectives can each associate the same physical path independently.

Preserve stable event/idempotency identity internally. Repeated observation updates the last observed timestamp. Native evidence wins over declarations for the displayed source; a later declaration cannot downgrade it. A native chip means at least one successful native observation, not that all edits were native. Rows with insufficient historical provenance use null and display Unknown; never relabel them native by default.

`--paths` remains a declaration escape hatch for known shell/script/generator outputs. Add a structured `--paths-file` JSON string-array alternative so commas and large lists round-trip; declarations use the same bounded canonical-path validation. Both rename endpoints and deleted paths are valid even when absent on disk. Do not follow symlinks outside the resource or broaden ignored-path rules. Hosted lifecycle calls and record-work accept equivalent declared paths without pretending to have a native ledger.

### Capture health and session binding

Persist bounded session capture metadata separately from path rows, since an empty list must still expose diagnostics. Proposed fields: `bindingState: bound | unbound | unknown`, `callbackObservedAt: timestamp | null`, and bounded health codes/timestamps. Attach with a verified matching explicit objective environment records bound; missing/mismatched environment records unbound. Hosted attach without local information records unknown. Do not persist env contents, session credentials, raw callbacks, tool output or patch text.

A bound attach is only configuration evidence. First accepted scoped callback updates callback observation even if it is a harmless read; native edit success is a separate fact. Surface:

- Unbound: “Automatic file tracking was not active for this session.”
- Bound, no callback: “File tracking is configured but no callback has been observed.”
- Unknown/hosted: “Automatic file tracking availability is unknown.”
- Shell/unsupported activity: “Some tool activity could not be captured; declared paths may be needed.”
- Sync failure: “Some captured paths have not synchronized.”

Aggregate warnings across objective sessions without allowing a newer healthy session to hide an earlier gap. A callback seen does not prove complete capture. Retain bounded sticky gap indicators even if the rolling diagnostic list evicts old entries. CLI attach persists metadata through the existing authorized protocol surface; hosted agents cannot assert local hook installation. No watcher, shell-text parser, directory scan, or ownership arbitration is introduced.

### Native success and path extraction

Decode result status in the connector-owned codec, then enforce it in capture before appending paths. Error, blocked and cancelled events append no successful-edit evidence. Unknown outcomes append no native evidence unless the particular hook is documented and fixture-verified to be success-only; otherwise record outcome-unavailable health. Do not interpret absent status as success by default.

For partial mutation, append only paths explicitly confirmed successful by the harness. If the harness cannot distinguish partial results, preserve a partial/unknown health warning and allow the agent to declare known actual writes. Keep attempted paths out of native evidence. Extend the codec dialect only if existing mappings cannot express the observed result shape; update its schema, generated assets and tests together.

Fixtures must cover real sanitized success/failure payloads for each supported adapter. A source fixture is not a live harness smoke test; record that distinction in validation. Unsupported nested tool callbacks remain unavailable rather than producing guessed paths.

## Reads and delivery workflow

### Local Protocol changes

Extend `ovld protocol changes --objective-id ...` to return a deduplicated bounded list from all matching locally known sessions in the current directory, including synced and pending rows. Snapshot rows before sync/finalization can remove session discovery. Return `scope: local_objective_sessions`, objective identity, `items`, `total`, `limit` (200), `truncated`, sync counts/pending count, capture status and warnings. Sort deterministically by resource/path. `total` counts distinct paths in that local scope, not raw events. Never present this as complete cross-device objective history.

No pagination is needed for the first implementation. Truncation is explicit and non-blocking; an agent may summarize using its task context without claiming to have reviewed omitted paths. A no-session read returns unavailable coverage, not “no files changed.” Invalid explicit mission/objective/session combinations fail scope validation without leaking another session's evidence.

### Server objective read and hosted MCP

Add an optional validated objective selector to the existing file-changes REST read, filtering in SQL before count and limit. Add an objective-scoped Protocol/backend read exposed as hosted `overlord_changes` and the local shim equivalent. Define it in the canonical MCP catalog, then generate the shim. The server read returns the same compact rows and `{ items, total, limit, truncated }`, with `scope: server_objective` and persisted session diagnostics. It cannot see unsynchronized local rows and must say so.

Keep local inspection and server history distinct rather than silently merging incompatible counts. Agents needing earlier sessions/resources use the server read; UI uses the server objective projection. Reuse mission/objective read authorization, active organization membership and token project scope. Reject an objective outside the addressed mission. No mutation or attach is required for this server read.

### Agent instructions

Before delivery, inspect local or hosted evidence as available. Declare only paths the agent knows it actually changed and which native capture missed, including script outputs, deletes and renames. When unsure, describe the coverage limitation instead of guessing. Summarize outcome, why, tests and remaining limitations by component. Deliver remains summary-only in the sense that neither a file list nor any annotations are mandatory.

Preserve advisory synchronization and retries across delivery. Declare paths before synchronization on that same call. Deterministic operator actions continue to derive from the objective's synchronized paths; late sync does not rewrite the narrative or invent a historical delivery snapshot.

## Removing rationales and simplifying review

Remove active rationale flags, schemas, validators, writers, reads, joins, table/types, rationale-only endpoints/subcommands, rationale entity-change emitters, webhook fields, and per-file UI prose. Reject removed input fields clearly instead of silently retaining aliases. Keep decision-level `rationale` concepts wherever they explain non-file decisions; do not globally replace the word.

Remove `vcsStatus` from record-work inputs, DTOs and changed-file storage. Explicit record-work paths become `agent_declared`. Its summary, artifacts, verification and sessionless behavior remain intact. No Git status inference is added.

Review rows display resource, relative path and optional Native / Declared / Unknown chip. Show capture and sync warnings at objective level, with details on demand. Distinguish empty evidence, unavailable tracking, and truncated results. Do not partition a capped mission-wide list and call each objective complete. Preserve realtime refresh on changed-file and session diagnostic updates after removing rationale refresh kinds.

The composer receives bounded path metadata only as context, with authoritative agent summary and report facts. It cannot invent per-path descriptions, tests, impacts or operator actions from names. Keep raw-summary fallback. Update the delivery webhook envelope and documented examples to remove `changeRationales`; keep ordinary summaries, artifacts and report facts. Historical stored payloads may retain old JSON as inert history, but new reads/composition must not expose or consume the retired fields.

## Contract and component work packages

Implementation begins by updating the current contract version (read it at execution time), relevant machine-readable contracts, database schema reference, and conformance manifests. Do not bump the live contract for this planning-only objective.

| Component | Concrete work and boundary |
| --- | --- |
| Contract | `CONTRACT.md`, `contract/components.yaml`, `contract/protocol-commands.yaml`, applicable vocabulary/schema files, `packages/contract/src/index.ts`, canonical `mcp-tools.ts`: shapes, removals, read semantics, source values, capture diagnostics. |
| Database / Core | New SQLite and PostgreSQL migrations; generated types; `protocol.ts` and shared read services; remove rationale storage; migrate path provenance/resource identity; persist scoped capture diagnostics; preserve transactional changed-file refresh events. |
| CLI | Ledger schema upgrade, outcome gating, new reads, declaration parsing, attach diagnostics, cleanup-safe snapshot, removed rationale command/flags, record-work parity. |
| Connector | Codec schema/interpreter and per-adapter fixtures; Move headers; capture script; shared `connectors/core/overlord-mission` guidance and references; generated hooks/descriptors/capabilities; connector and shared-skill version bumps. |
| REST / MCP | Objective-filtered read, existing permission enforcement, canonical MCP catalog and generated local shim, removed rationale input/output; no direct MCP database queries. |
| Backend / Automations | Simplify repository queries, composer evidence and worker handling, `packages/core/service/webhook-events.ts`, webhook documentation/examples, refresh consumers. |
| Web / Desktop | Compact resource-grouped list and diagnostic states; Desktop consumes the shared SPA, audit independent bridge/renderer references. |
| Mobile | In the mobile resource: DTO decoding, previews, changed-file presentation, generated MCP intents and removed realtime kinds. Ship against the new contract before treating cross-client rollout complete. |
| Docs / Skills | CLI protocol/help/public docs, shared attach instructions, mission-data-webhooks reference, component-contract delivery reminder; update `.claude/skills/SKILLS_INDEX.md` if skill metadata changes. Keep `.agents/skills` as a symlink. |
| Auth / Runner / Extensions | No new grants, ownership or scheduling behavior. Validate scope regression and conformance; runner launch binding stays explicit. Audit external envelope consumers for the breaking fields. |

## Upgrade and release

1. Stop old capture producers and compose workers for the coordinated single-user cutover. Back up persisted data and local ledgers before destructive migration; no production changes are authorized by this document alone.
2. Migrate changed-file provenance and resource identity, capture diagnostics and removed columns on both SQLite and PostgreSQL. Preserve summaries, artifacts, changed paths and unrelated delivery reports. Drop active rationale storage only once all new consumers no longer query it. Historical migration files remain unchanged.
3. Upgrade local ledger schema atomically under the existing lock. Preserve pending evidence, idempotency keys and sync state. Map the known generator-declaration marker to `agent_declared`; keep valid native evidence; do not convert old window evidence into native claims. Retire unsupported window rows with a visible legacy-evidence-discarded diagnostic. Test corrupt/oversized files without silent data loss. This is a one-time data migration, not indefinite compatibility parsing.
4. For persisted rows, map known native/declaration metadata only when provenance is reliable; otherwise retain the path with unknown source. Remove historical window precision claims. Do not synthesize new observations or change historical timestamps to migration time.
5. Build and install matching backend, CLI, connectors and clients; regenerate MCP/capability artifacts and re-run agent setup for installed hooks. Ensure pending compose jobs use the new reader or are explicitly drained before dropping storage. Retain deterministic fallback if a job cannot compose.
6. Smoke-test the packaged Local edition and a disposable PostgreSQL Cloud setup. Report deployment separately from repository validation. Rollback after destructive schema migration requires the matching backup and binaries, not only reverting application code.

## Implementation order and acceptance gates

1. **Contract and fixtures:** finalize DTO/read/session-diagnostic definitions above; capture sanitized real payloads; establish regression tests before retiring storage. Payload uncertainty is resolved here, not hidden by guessed fields.
2. **Single coordinated data/surface cutover:** migrations, ledger upgrade, service/REST/MCP/CLI, composer/webhook and compact clients. Keep changes unreleased until all active consumers compile against the new contract.
3. **Capture and reconciliation:** connector result filtering, rename parsing, binding diagnostics, declaration guidance, cleanup-safe reads and retries. These are required for the cutover's accuracy claim, not optional later polish.
4. **Verification and packaging:** run focused tests, applicable typechecks, generated checks, migration/conformance tests and live smokes. Publish exact passed/unrun results and operational steps.

| Scenario | Required result |
| --- | --- |
| Two concurrent objectives, distinct files and one shared file | Each gets only its own evidence; shared file appears on both; unrelated dirty files never appear. |
| Same relative path in two resources | Two distinct resource-grouped rows; no cross-resource upsert collision. |
| Native create/edit/delete/multi-file patch/rename | Successful exact paths, both rename endpoints, stable deduplication. Failed/blocked/cancelled attempts add no native rows. |
| Missing or partial result status | Unknown/partial warning unless a verified success-only hook guarantees success; no fabricated native rows. |
| Read/search/fetch and read-only shell | Native reads are silent for edit evidence; shell may produce coverage uncertainty but no false claim of a write. |
| Claude shell-only session | Known heredoc/script/deletion/rename paths can be declared; visible declared provenance and shell-coverage warning remain. |
| Chat-attached, absent/mismatched env, hook missing | Bound/unbound/unknown are honest; no callback observation is fabricated; no cwd fallback. |
| Update sync, resumed session, cleanup, other device | Synced local rows survive the local read; local scope is explicit; server read supplies synchronized objective history across sessions/devices. |
| Sync failure then recovery, including after deliver | Delivery succeeds, pending evidence retained/retried, no duplicates or loss during finalization. |
| Over 200 paths and many mission objectives | Accurate pre-cap total and truncation; objective filter applied before cap; no false empty objective. |
| Declared path with commas, traversal, deleted target, symlink escape | Structured input round-trips valid names; unsafe/out-of-root input rejected; valid absent targets accepted. |
| Unauthenticated / foreign mission / foreign objective / project-limited token | Existing scope and permission gates hold for read, diagnostics and writes. |
| Fresh and upgraded SQLite/PostgreSQL + local v2 ledger | Preserved summaries/reports/paths/pending evidence; no active rationale table dependency; valid compact DTOs. |
| Record-work without session; delivery without files | Declared rows for explicit paths; summary-only delivery remains valid. |
| UI, mobile, webhook, compose and realtime | No per-file prose or stale fields; warnings and cumulative label present; no invented composer claims; refresh still works. |

Start with the existing `cli/test/change-ledger*.test.ts`, `cli/test/capture-change.test.ts`, codec `pure.test.ts`, `packages/core/service/delivery-compose.test.ts`, `webhook-events.test.ts`, `backend/delivery-compose-worker.test.ts`, and web grouping tests. Add integration coverage at service/REST and both database editions. Use repository scripts `yarn connectors:capabilities`, `yarn connectors:mcp-tools`, version synchronization, `yarn connectors:check`, affected typechecks, and `yarn test:conformance` with its disposable database harness. Read individual package test scripts before constructing focused invocations.

Completion requires a source audit for retired fields in active producers/consumers, while allowing historical migrations and this decision record. No remaining per-file rationale aliases, no new worktree inference, no delivery gate on tracking completeness, and no unsupported claims of native capture. Runtime implementation, tests, installation and deployment remain future execution work; this objective delivers the consolidated specification only.
