# COO-1199 final primary-resource validation and cutover

Objective: `coo:1199.k85p`. Date: 2026-10-24. Contract: **165**. Connector release: **0.3.56**; shared mission skill: **0.7.0**.

The primary-resource implementation passes the acceptance checks below. This is repository validation, not a deployment or an assertion that every client is ready to install. One targeted mobile correction remains in **coo:1199.cz3m** (draft, mobile resource, no automatic launch). Browser/Electron visual verification was environment-blocked. Complete that correction and the operator visual checks below before the coordinated rollout.

## Repairs made during final validation

- `sync-changes` accepts an ended **delivered** session for advisory evidence recovery. Current caller authorization and original mission/objective/resource bindings still apply. Deleted sessions and ended non-delivered sessions fail. Recovery is idempotent and cannot reopen the lifecycle or rewrite the delivery report/summary. Contract rules now explicitly state this existing recovery requirement.
- Web/Desktop group by each row's recorded resource even when only one or zero resources remain linked locally. Unknown resource rows remain unresolved. File editor links require a matching resource root; the repository browser's primary-resource fallback cannot redirect an evidence row into another checkout.
- Removed the retired window-evidence alternative from the generated connector capability catalog. No adapter gains a capture claim from this cleanup.
- Repaired validation blockers: Desktop's no-emit typecheck now uses the actual esbuild/bundler resolution model; the runner claim response boundary describes only the operations it uses; the CLI invocation test isolates inherited `ELECTRON_RUN_AS_NODE`.
- Added live PostgreSQL migration-preservation coverage, delivered-session recovery assertions on both database adapters, project-token read/write scope coverage, and the resource-link regression test.

No production database, deployment, installed connector, or mobile source was changed. The installed mission CLI/backend still emit pre-cutover guidance; the checked-out source and built bundle were validated independently. Do not treat installed behavior as evidence of this rollout.

## Verification results

| Check | Result |
| --- | --- |
| Full `TMPDIR=/private/tmp yarn test` | **2,336 passed**, 0 failed, 11 explicitly skipped. Database 62, core 613, auth 32, automations 55, CLI 465, backend 718, web 356, Desktop 35. Skips: 9 opt-in CLI E2E tests and 2 PostgreSQL-dependent tests in this non-PG run. |
| Final web regression after resource repair | **358/358 passed**. Includes zero/one linked-resource identity and correct editor-link behavior. |
| Final scoped authorization/evidence regression | **4/4 passed**. Objective-before-cap, foreign objective, selected-project token reads, foreign project denial and denied diagnostic writes. |
| Full `yarn test:conformance` with real disposable PostgreSQL | **393 passed**, 0 failed; 2 optional chat coalescing benchmarks skipped. Both adapter branches ran. Includes fresh schema chains and the new historical cutover test. |
| Adapter recovery follow-up | **30/30 passed**, SQLite + PostgreSQL, including ended delivered-session replay and non-delivered rejection. |
| Focused service/CLI repairs | **37/37 passed**, including real delivery followed by late evidence and unchanged delivery/lifecycle state. |
| `yarn typecheck`, `yarn desktop:typecheck` | **Passed** after repairs. Web typecheck also passed after the resource repair. |
| `yarn connectors:check` | **Passed**: all six capability descriptors/fixtures, codec generation, MCP catalog/shim, connector versions and Claude plugin validation. These are fixture checks, not live native-harness sessions. |
| Rebuilt CLI Codex package export | **Passed**: `node cli/bin/ovld.mjs agent-setup codex --export /private/tmp/coo1199-codex-package`. Exported hooks, MCP shim and shared skill without changing the installed harness. |
| Workspace/conformance-version checks | **Passed**. Unrelated extension manifests remain at their previously validated versions; Desktop's manifest remains at 164 pending packaged visual validation. |
| `yarn desktop:build:prod` | **Passed**: shared SPA, bundled backend, Electron main and preload. This is a build, not a signed installer or live Electron review flow. |
| Freshly built backend bundle over HTTP | **Passed**, port 5198, disposable SQLite and runtime home: authenticated summary-only delivery, ended-session recovery, exact replay, objective read, unauthenticated read rejection. Compose worker disabled; no external model called. |
| Source audit | No active rationale table readers/writers/DTOs remain in source. Remaining retired identifiers are explicit rejection lists, one-time v2 ledger migration, historical migrations, and tests/docs describing removal. VCS status in the repository browser remains an independent feature. |
| Formatting/lint | Changed-code lint and `git diff --check` pass. |

Initial sandbox runs failed on tsx IPC permissions. Approved local execution resolved that. The launch's default temporary directory was inside the repository, so a plain-directory Git test inherited a repository; rerunning with `/private/tmp` resolved it. PostgreSQL's installed libpq lacked `postgres`, and Docker was stopped. Validation used the registry package `@embedded-postgres/darwin-arm64@18.4.0-beta.17` in `/private/tmp`, initialized its bundled library symlinks, and ran the normal disposable-cluster harness. No system service was installed. Do not count the earlier fallback runs that silently skipped PostgreSQL.

Run logs are under `/private/tmp/coo1199-*.log` on the validation machine. Important files: `test.log`, `web-final-verified.log`, `auth-evidence.log`, `conformance-final.log`, `pg-recovery.log`, `package-smoke.log`, `connectors-final.log`, `typecheck-final.log`, and `build-final.log`. They are temporary; this report and the mission artifact are the durable result.

## Acceptance matrix

| Requirement | Evidence and limit |
| --- | --- |
| Concurrent objectives and shared paths | Core changed-files and CLI capture/ledger suites: independent objective association; same path allowed on both; no working-tree ownership inference. |
| Same path across resources | SQLite/PostgreSQL service conformance; resource-aware unique key, null-resource collision handling, grouping/component tests. |
| Success/failure/unknown/partial, renames/deletes | Connector codec/capture fixtures and CLI suite. Failure/unknown adds no native path; partial remains a gap unless exact success is proven; both rename endpoints retained. No new live Claude/Cursor/Codex session was exercised. |
| Shell-only declarations; unsafe, ignored, comma, deleted and symlink paths | Ledger/declaration and protocol file-input tests; structured arrays round-trip commas, absent targets remain valid, unsafe/ignored paths rejected. |
| Unbound/chat attach, absent callback | Attach/capture/local-read tests and web diagnostic tests. Configuration is not callback evidence. Older gaps remain visible. |
| Resume, cleanup and cross-device scope | Local-ledger/cross-process and local-objective read tests. Snapshot precedes cleanup; local scope is explicitly bounded. Server supplies synchronized cross-resource history and cannot claim unsynced evidence. |
| Sync failure and recovery after delivery | CLI failed-drain binding retention, core real-delivery recovery, both adapter recovery tests, and packaged HTTP smoke. |
| Over 200 paths, objective-before-cap | Service and REST/Protocol tests: 200 items with pre-cap count/truncation and unaffected quiet sibling objective. |
| Authorization | Full auth/backend suites, focused project-token evidence test and foreign objective/session tests; packaged HTTP returns 401 without authentication. |
| SQLite/PostgreSQL upgrades and local v2 ledger | Path/provenance/report migration tests; real PG upgrade retains timestamps, idempotency keys, summaries and agent/deterministic facts. v2 ledger migration preserves pending/synced rows, rejects corrupt files and does not promote window evidence to native. |
| Record-work and summary-only delivery | Core/backend/CLI suites plus packaged HTTP. Files and advisory diagnostics are not delivery gates. |
| Deterministic actions, compose fallback, webhooks, realtime | Core/automation/backend/web suites. No filename-derived behavioral/test claims or new rationale envelope; changed-file/session refresh remains. |

## Mobile validation incorporated

Mission artifact **d8363350-3d6d-41b0-9f35-10a7c2b10c4d**, “Mobile validation: v165 file evidence (coo:1199.51jn),” reports mobile commit `cc56c64`: 550/550 unit/store tests; nine decoding tests using real disposable-backend responses; builds for universal iPhone/iPad, ShareExtension, Watch and LiveActivity; iPhone and iPad simulator light/dark/truncated visual flows. This is prior-objective evidence, not a rerun in this session. Connected devices and app-to-live-backend authenticated SSE were not verified there.

Its reported post-delivery sync defect is fixed and verified here. Its resource ordering and per-objective request-cost observations remain as documented design/performance limits; no unsupported throughput claim is made.

Final inspection found `Overlord/Lib/MissionFileChangeGrouping.swift` still combines every row under one resource when the linked-resource count is <=1. A resource removed from this device, or nil-resource history, must not be reassigned. **coo:1199.cz3m** contains the exact narrow repair and focused validation, in the authorized mobile resource. No additional broad validation objective is needed.

## Visual and harness limits

The temporary Vite fixture page used actual React components and styling for multi-resource paths, Native/Declared/Unknown, earlier-session warnings, truncation and unavailable capture. The computer-use inventory had no connected browser. Launching Arc through the native tool timed out; no screenshot or visual pass is claimed. The preview server and temporary page were removed afterward.

A rebuilt signed Desktop installer, installed-agent hook execution, connected iPhone/iPad, and authenticated app-to-backend SSE were not exercised here. Before rollout approval, inspect the web/Desktop scenarios in the existing mission artifact “Web/Desktop file evidence: validation scenarios for coo:1199.k85p,” particularly light/dark layout, long paths, capture details, truncation and editor links after unlinking a resource. Automated refresh, scope and rendering tests are passing; that does not substitute for visual inspection.

## Coordinated cutover and rollback runbook

These are operator instructions, **not actions performed by this objective**.

1. Finish `coo:1199.cz3m` and the visual checks above. Pick a maintenance window. Stop old agent sessions/capture hooks, runner launches, backend writers and compose workers together. Do not let old binaries touch a migrated database or v3 ledger. Preserve pending sessions rather than deleting caches to make an upgrade look clean.
2. Record the installed backend/CLI/connector/mobile versions, the deployment revision and actual SQLite/PG target. Confirm the database path from the running backend/configuration; do not assume a development default is the live file. Record `OVLD_HOME` (default `~/.ovld`). Back up that entire directory on **every capture device**, including `change-ledgers`, session bindings, credentials/config and pending retry state, with restrictive permissions. Preserve local object storage too. Back up the old application/connector packages and the pre-cutover Git revision.
3. Back up the quiesced database. For SQLite, use the SQLite backup API/CLI, e.g. `sqlite3 "$CUTOVER_SQLITE_PATH" ".backup '$CUTOVER_BACKUP_DIR/Overlord.sqlite'"`; run `PRAGMA integrity_check` on the copy. For PostgreSQL, `pg_dump --format=custom --file="$CUTOVER_BACKUP_DIR/overlord.dump" "$CUTOVER_DATABASE_URL"`; inspect with `pg_restore --list`. Set these task-specific variables explicitly to the verified target and a new private backup directory. Restore a copy into a disposable target and confirm it opens before proceeding. Never print credentials in logs.
4. Build matching artifacts from the validated revision (`yarn build:prod`, `yarn desktop:build:prod`; package through the normal release process). Stage the backend, CLI, connectors and corrected mobile together. Do not install a new capture producer against an old service.
5. Apply the new migration chain to the verified database. SQLite migrations run on the matching backend's first startup. For PostgreSQL, with the verified `DATABASE_URL` and optional `OVERLORD_PG_SCHEMA` exported in the migration environment, run `node --import tsx scripts/migrate-postgres.ts`. Avoid an implicit `.env.prod` target. Verify `schema_migrations` contains `20261024120000` and `20261024130000`, `change_rationales` is absent, and known historical summaries/paths survived. The first migration drops rationale/VCS/window storage; the second removes only retired rationale-provenance presentation items. Historical payload keys remain inert. Pending compose jobs store a delivery id and reread the migrated report.
6. Install the matching CLI and connectors **0.3.56**, re-run `ovld agent-setup <agent>` for each harness actually used, and restart those harnesses so their hooks resolve the new executable. Install the matching web/Desktop/mobile clients. The new ledger upgrades v2 under its existing lock on write; preserve the original backup. Verify an explicit objective attach reports honest binding, then perform a successful native edit, a harmless read, a failed edit and a shell-only declared output on a disposable mission. Confirm native/declared provenance and gap diagnostics.
7. Use `ovld protocol changes --objective-id <id>` for retained local pending evidence and `ovld protocol objective-changes --objective-id <id>` for server history. Retry local recovery after delivery; verify duplicate replay does not add rows. Verify one old delivery's summary/actions, same-path cross-resource rows, 200-row truncation and changed-file/session refresh in each installed client. Resume writers only after these checks pass. Late evidence extends the cumulative list; it does not rewrite delivery summaries or snapshots.
8. **Rollback:** stop all new producers/workers first. Preserve the failed deployment's database and ledgers separately. Restore the matching pre-cutover database backup **and** per-device ledger/binding backups, old binaries/connectors/clients/config, and storage if changed. Validate the restored database before reopening traffic. Do not merely revert code over the destructive migration, and do not run a v2 reader over a v3 ledger. Reconcile post-cutover work explicitly from preserved evidence rather than replaying incompatible metadata blindly.
