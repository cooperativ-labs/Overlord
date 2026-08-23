# Hook-first attribution — Phase 5 cutover review evidence

Mission `coo:825`, review objective `coo:825.wyp4`.

This review audits the uncommitted contract-116 implementation as an immediate
cutover. It does not preserve or normalize the Phase 1–4 VCS-delta, touched-file,
rationale-gate, shared-stdin, or old connector-projection surfaces.

## Review outcome

The active design is now one objective-bound path-evidence flow:

```text
connector post-tool callback
  -> shared rendered capture hook
  -> connector-owned codec normalizes `file.edited` plus an exact path
  -> owner-only objective/session ledger
  -> bounded Protocol `sync-changes` batches
  -> one durable row per `(objective_id, file_path)`
  -> changed-file-first review projection with an optional latest rationale
```

Normal `update` and `deliver` payloads do not accept changed files, dirty paths,
no-file assertions, or rationale skips. Delivery requires only its summary;
rationales, artifacts, and the delivery report are optional annotations.
Sessionless `record-work` keeps its explicit canonical `changedFiles` input because
there is no attached connector ledger for already-completed work.

## Correctness fixes made during review

- Made ledger/session state owner-only, bounded, atomically replaced, and protected
  by a cross-process lock. Unsynchronized evidence has no wall-clock expiry.
- Made the persisted-ledger read boundary strict: unknown keys, non-canonical UTC
  timestamps, and malformed bounded idempotency keys are rejected before a row can be
  printed or transmitted. Rewrites discard rejected hostile rows instead of preserving
  hidden payloads.
- Required an exact objective plus session binding; mission-only, cwd-only, native
  session, and most-recent-session selection do not exist.
- Centralized exact evidence-path validation in core and made capture, ledger, and
  Protocol use it. Traversal, backslashes, controls, whitespace mutation, symlink
  escape, absolute paths, and every Windows drive-prefix form are rejected.
- Required explicit connector codec `filePathPaths`. Read/search/fetch callbacks are
  silent; shell, generic, unmapped, and mutation callbacks without an exact edit path
  record bounded unavailable health and claim no file.
- Matched synchronization acknowledgements by exact `(idempotencyKey, filePath)` and
  required explicit sync payloads to reproduce the complete local evidence tuple.
- Made server synchronization strict and per-item salvageable, preserved the strongest
  evidence for a path, bounded warning text, and emitted scoped realtime changes.
- Deduplicated historical changed-file rows before installing objective/path uniqueness,
  repointed rationale foreign keys, and kept the strongest evidence plus latest
  provenance.
- Made the review query start from `changed_files`, retain the same path independently
  for different objectives, and join the latest optional rationale regardless of whether
  it was recorded during update or delivery.
- Persisted new ledger and `record-work` observations with `current_diff_state =
  'unknown'`; path evidence does not pretend that Overlord inspected a VCS diff.
- Removed the unused public `diffState` projection while keeping historical internal
  lifecycle values readable.
- Made canonical rationale parsing and persistence shared by update, deliver,
  record-work, hosted MCP, and local MCP. Exact keys are enforced and duplicate paths
  use the last valid item.
- Preserved normalization warnings when delivery presentation is composed later.
- Removed hidden local-MCP `attach`, `update`, and `deliver` aliases; the 22 advertised
  tools are the only dispatch branches.
- Replaced three adapter-local capture callbacks with one shared core template rendered
  into the existing Claude, Codex, and Cursor native paths. Renderer callers must pass
  the adapter key explicitly; the former directory-name fallback is gone.
- Updated the repository's recurring refactor-review skill so scheduled publication uses
  the current summary-plus-artifact MCP delivery and no deleted VCS/touched-file modules.
- Fixed a cross-resource test that still sent retired `vcsStatus` metadata through
  `sync-changes`; the strict server correctly rejected that old item shape.
- Centralized resource-reference lookup scope for REST/Protocol resolution. Cloud calls
  use the immutable authorization snapshot (including an explicit empty snapshot), while
  process-local Local calls use only the active operator's live workspace memberships.
  Mission and objective display-id resolution now share that boundary instead of either
  failing locally or widening to every database workspace.

## Removed implementation and compatibility behavior

- `cli/src/vcs.ts`, `cli/src/vcs-sessions.ts`, `cli/src/record-touched.ts`, and their
  dedicated tests;
- mission baselines, worktree/current-delta scans, filesystem snapshots, touched logs,
  peer claims, transcript rationale notes, and `fallback_delta` evidence;
- changed-file update/delivery fields, `observedDirtyPaths`, `noFileChanges`, rationale
  skips, and shared `stdin` transport;
- snake-case rationale/delivery-report lifting and wrapper aliases;
- connector `capabilities`, `hookTypes`, legacy descriptor fields, old spawn command
  files, and implicit renderer adapter-key discovery; and
- unadvertised local-MCP lifecycle aliases.

Retired request names remain only in fail-fast rejection guards, negative tests, and
historical contract changelog entries. None is accepted, normalized, or executed.

## Local and Cloud parity

Hosted and local MCP publish the same canonical lifecycle schemas. Both execution modes
send the same metadata-only `sync-changes` request to Protocol; neither backend reads the
execution target filesystem. `changed_file` and `change_rationale` entity changes refresh
the same web review query in both modes. Connector version projections are synchronized at
`0.3.35`; contract projections are synchronized at version 116.

## Verification completed

- Contract, database, core, auth, automations, and CLI production builds: pass.
- CLI, backend, webapp, and automations typechecks: pass.
- Core attribution/delivery/context/resource/webhook tests: 91 pass after correcting the
  retired test payload.
- SQLite/Postgres migration-shape tests: 2/2 pass.
- Web changed-file grouping and realtime invalidation: 11/11 pass.
- Hosted/local MCP catalog and canonical rationale parity: 12/12 pass.
- CLI ledger/storage/cross-process/Protocol command hardening: 30/30 pass, including a
  hostile stored-row regression proving rejected fields are neither printed nor sent;
  cross-process stress passed 20 repeated runs.
- Backend Local/Cloud mission and objective addressing plus related authorization,
  artifact, launch, and PM Protocol coverage: 63/63 pass.
- Shared connector renderer: 8/8 pass; connector setup/doctor: 15/15 pass; bound and
  unbound source fixtures and installed-script syntax/executable checks pass.
- Conformance version and connector version checks: pass.
- `git diff --check`: pass.

Postgres runtime conformance was not run because `TEST_DATABASE_URL` is not configured.
A broader focused CLI run passed 85/87 tests; the two unrelated pre-existing assertions in
`cli/test/runner-and-changes.test.ts` still expect older execution-request error/default
text and neither exercises this cutover.

## Open review gate

`cli/src/agent-session/codec-registry.generated.ts` is still the pre-cutover generated
artifact: it lacks descriptor `filePathPaths` and still carries the removed OpenCode edit
classification. Consequently the direct capture integration currently passes 3/5 tests and
correctly reports that native edits contain no exact path evidence.

The source descriptors, generator, fixture runner, and pure codec tests are updated, but
`yarn connectors:capabilities` cannot run inside this sandbox because its `tsx` subprocess
cannot create the required IPC socket (`listen EPERM`). The request to run the generator
outside the sandbox was rejected by the approval service's usage quota. The generated file
was not hand-edited and no alternate generation path was used.

The review objective must remain open until an explicitly approved run of:

```bash
env -u npm_config_noproxy -u NPM_CONFIG_NOPROXY -u YARN_NO_PROXY yarn connectors:capabilities
env -u npm_config_noproxy -u NPM_CONFIG_NOPROXY -u YARN_NO_PROXY yarn connectors:check
```

updates the registry, after which the capture integration and final connector checks must be
rerun before delivery.
