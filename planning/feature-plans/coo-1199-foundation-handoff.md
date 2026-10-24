# coo:1199 foundation handoff (objective coo:1199.4c9w)

Status: contract v165, storage, service, and backend Protocol parsing are implemented. Everything else still carries the old shapes and fails loudly (no shims). This is an intermediate slice, not the shipped feature.

## Delivered interfaces (authoritative: CONTRACT.md "Version 165")

- `@overlord/contract`: `FileChangeDto { id, missionId, objectiveId, resourceKey, filePath, source, observedAt, hookHealth }`, `FileChangeSource`, `CaptureBindingState`, `CAPTURE_GAP_CODES`, `CaptureSessionDto`, `CaptureWarningCode` (+ `CAPTURE_WARNING_MESSAGES`), `ObjectiveFileChangesDto` (scope `server_objective`), `LocalObjectiveChangesDto` / `LocalFileChangeDto` (scope `local_objective_sessions`, defined here for the CLI to implement), `OBJECTIVE_FILE_CHANGES_LIMIT = 200`, `MissionFileChangesDto` (mission-wide, never partition by objective).
- Service (`packages/core/service`): `syncChanges({ …, changes, capture? })` (source `declared_edit | agent_declared`; retired fields rejected per item), `attachSession({ captureBindingState })`, `updateSession/deliverSession/recordWork({ declaredPaths })`, `listObjectiveFileChanges({ ctx, missionId, objectiveId })` in `changes.ts` (objective validated against mission, SQL filter before count/limit, capture sessions + derived warnings).
- Backend Protocol (`backend/protocol/*`): new flags `--declared-paths-json|file`, `--capture-binding`, `--capture-json|file` (sync-changes); retired `--change-rationales-*`, `--changed-files-*` and payload fields `changeRationales`/`changedFiles` return 400 `invalid_input`.
- Routing decision: CLI-local `ovld protocol changes` (not in the backend) vs backend subcommand **`objective-changes`** (`POST /api/protocol/objective-changes`), hosted MCP `overlord_changes`, REST `GET /api/missions/:id/file-changes?objectiveId=`. Contract YAML documents `objectiveChanges`; the backend route/handler/permission is NOT yet implemented.

## Migration (`20261024120000_changed_files_resource_provenance`, SQLite + PostgreSQL)

Adds `changed_files.source|hook_health|sync_keys_json`, replaces the unique index with `(objective_id, COALESCE(resource_id,''), file_path)`, drops `vcs_status|current_diff_state|observed_metadata_json` and the `change_rationales` table (and its `entity_changes` rows), adds `agent_sessions.capture_binding_state|capture_callback_observed_at|capture_health_json`. Provenance backfill: latest-native → `declared_edit`; single generator declaration or sessionless record-work → `agent_declared`; everything else (merged declarations, window rows, unreadable metadata) → `NULL` (Unknown). Timestamps and paths are untouched. Destructive: back up the database first; rollback requires the backup plus the prior binaries.

## Handoffs (not done here)

- coo:1199.94x3 (REST/MCP/Protocol): `objective-changes` handler + permission + `project_automation` allowlist; REST `objectiveId` query on `file-changes`; MCP catalog (`mcp-tools.ts`): add `overlord_changes`, remove `changeRationales`/`changedFiles.vcsStatus`, add `declaredPaths`; `mcp/server.ts` still forwards `--change-rationales-file` (now rejected); regenerate shim + connector version bump; `mcp/conformance-manifest.yaml` still 164.
- coo:1199.tndc (CLI): local ledger v2→v3 upgrade (still `quality|overlap|toolWindowId|window_observed`); CLI sync payload currently sends `quality`/`overlap` and **will be rejected per item by the backend** until updated; send `capture` + `--capture-binding`; `--paths` should sync as `agent_declared`; `--paths-file`; remove rationale flags/subcommands; local `changes` read.
- coo:1199.1cqh (connectors): outcome gating, Move headers, capture hooks, conformance manifests (164).
- coo:1199.j1qg (composer/docs): `backend/delivery-compose-worker.ts` now passes an always-empty `rationales` list (stopgap; table dropped); remove `ChangeRationaleEvidence`, composer `changeRationales` input, `change_rationale` sources in `delivery-report.ts` (tolerate historical payloads), skill/CLI/webhook docs.
- coo:1199.9p5c (web/desktop): `webapp/web/components/LiveFileChangeCard.tsx`, grouping/objective-evidence libs and tests, `realtime-invalidation` `change_rationale` case use removed `FileChangeDto` fields; `yarn typecheck:webapp` fails until then. Desktop manifest 164.
- coo:1199.p2wd (mobile): decode the new DTO/observedAt.

## Verified here

SQLite fresh chain migration + regenerated Kysely types identical to committed `db.ts`; migration upgrade tests; core/backend focused suites; PostgreSQL conformance (docker backend, 30 tests incl. new upsert/precedence/diagnostics/resource-identity) passing. Not run: full regression, web/desktop/mobile builds, live harness.
