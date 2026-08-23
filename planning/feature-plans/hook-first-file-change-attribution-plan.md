# Hook-First File-Change Attribution: Immediate Cutover Plan

Mission `coo:825`, objective `coo:825.j6ae`.

This document records the final contract-116 design. It supersedes the earlier
snapshot, VCS-delta, rationale-gate, and compatibility-rollout proposals in the
investigation notes.

## Outcome

A normal agent delivery supplies a summary and no file list. Overlord captures
bounded path evidence from an explicitly objective-bound connector callback,
synchronizes that evidence independently, and presents optional rationales as
review annotations. Change tracking is advisory: unavailable hooks, malformed
individual evidence items, and missing rationales never reject delivery.

The cutover is immediate. No active surface accepts or reconstructs the retired
delivery fields, and no compatibility path reads the shared worktree to guess
which objective changed a file.

## Invariants

| Requirement | Final invariant |
| --- | --- |
| Parallel objectives may edit the same path | Durable identity is `(objective_id, file_path)`; observations are non-exclusive. |
| Cwd must not select work | A callback must provide an objective id that matches one exact active objective/session binding. |
| Agents do not enumerate their changes | The CLI drains the local ledger automatically on update, preflight, and delivery. |
| Evidence must be honest | A post-only callback records only a path its connector-owned codec normalized as `file.edited`. Mutation-capable callbacks without such a path record unavailable health and no path. |
| File data remains private | The ledger and backend store path plus bounded attribution metadata only—never content, diffs, commands, transcripts, environment values, or fingerprints. |
| Delivery remains available | Sync failures and per-item warnings are visible and retryable but never gate lifecycle delivery. |
| Historical clients do not shape the new API | Retired flags and payload fields are rejected; they are not normalized, aliased, or silently ignored. |

## Evidence classes

The closed runtime vocabulary is:

| Source | Quality | Meaning |
| --- | --- | --- |
| `declared_edit` | `direct` | The connector-owned codec normalized a completion callback as `file.edited` and produced the path. |
| `window_observed` | `window` | Reserved for a future connector whose executable fixtures and runtime prove a matching pre/post mutation window. |

No shipped connector currently proves paired mutation-window support. Therefore
the shipped runtime emits `declared_edit`/`direct` only. `fallback_delta`,
worktree snapshots, VCS status inference, transcript parsing, and shell-command
path parsing are not evidence classes.

## Target data flow

```text
native post-tool callback
  -> connector scope gate requires OVERLORD_OBJECTIVE_ID
  -> bounded local `ovld protocol capture-change`
  -> exact objective/session binding lookup
  -> connector-owned codec normalization to file.edited
  -> workspace-boundary and ignore-policy validation of normalized paths
  -> atomic append to the owner-only objective/session ledger

ovld protocol update / changes / deliver
  -> drain all unsynced ledger records in bounded batches
  -> Protocol `sync-changes`
  -> validate and salvage each item independently
  -> upsert one changed_files row per objective + path

deliver
  -> persist the required summary and optional current annotations
  -> complete even when change sync is partial or unavailable
  -> retain unsynced local evidence for an explicit retry
```

## Local storage and identity

The active binding and ledger are keyed by:

```text
canonical workspace root
canonical objective UUID
protocol session key
```

Objective display ids are bounded aliases stored with the canonical objective.
Mission-only caches and most-recent-cwd selection do not exist. A native session
id may correlate harness activity but cannot authorize or select an objective.

Active bindings and ledgers live outside the checkout in owner-only directories
and files. Every read-modify-write operation uses the shared cross-process lock
and atomic rename path. Lock recovery never unlinks a successor's lock. Delivery
deletes a ledger only after every evidence row is synchronized; otherwise the
exact binding remains available for retry.

The local evidence shape is intentionally small:

```ts
type PathEvidence = {
  idempotencyKey: string;
  filePath: string;
  source: 'declared_edit' | 'window_observed';
  quality: 'direct' | 'window';
  overlap: boolean;
  toolWindowId?: string;
  observedAt: string;
  hookHealth?: string;
  syncedAt?: string;
};
```

Paths are canonical workspace-relative POSIX paths. Absolute paths, parent
traversal, backslashes, symlink escapes, overlong paths, and `.overlordignore`
matches are rejected at insertion. Evidence and health collections are bounded.

## Protocol and persistence

`sync-changes` accepts at most 25 items. Each item requires `filePath`,
`idempotencyKey`, `source`, `quality`, and `overlap`; window id, observation time,
and hook health are optional bounded metadata. The backend rejects rather than
normalizes non-canonical paths and returns an `accepted`, `ignored`, or `warning`
outcome for every item.

Idempotency is objective/path-aware. Replaying a sync key is ignored. A stronger
direct observation replaces weaker window metadata; weaker evidence cannot
downgrade an existing row. The observing session is refreshed as provenance.
Existing duplicate rows are deterministically consolidated before the database
installs the `(objective_id, file_path)` unique index.

The mission File Changes query starts from `changed_files` and left-joins at most
one optional rationale, so an observed file never disappears for lack of prose
and duplicate rationales never duplicate the file row.

## Delivery surface

Normal attached-session delivery accepts:

```text
required: summary
optional: changeRationales, artifacts, deliveryReport
automatic: objective-ledger synchronization
```

It does not accept changed files, observed dirty paths, a no-file assertion, or
rationale skips. `update` likewise accepts no changed-file payload. The
sessionless `record-work` command keeps explicit `changedFiles` because it records
already-completed work and has no attached execution target or callback ledger.

Optional delivery-report items are salvaged independently. The canonical JSON
shape is the only accepted shape; snake-case aliases and wrapper lifting are not
compatibility surfaces.

## Connector rules

Every adapter is generated from its harness capability descriptor. Conformance
manifests contain only the current descriptor-derived fields:
`agentIdentifier`, `harnessCapabilities`, `integrationShape`, and
`capabilityTier`. The deprecated hook-named `capabilities` and `hookTypes`
projections are removed.

A shipped callback must:

1. reject unbound scope before logging or spawning;
2. pass the native payload to the shared local capture command;
3. remain bounded and best-effort;
4. make no network or database call itself; and
5. never log payloads, paths, commands, content, credentials, or environment.

Generated manifests, capability docs, matrix, CLI catalog, installed mission
skill, MCP shim, and connector versions change together.

## Removed implementation

The cutover deletes, rather than adapts:

- mission-keyed VCS baselines and current-delta scans;
- touched-file and Bash snapshot logs;
- transcript-derived rationale notes;
- peer claim arbitration and `mine`/`claimed`/`unclaimed` classification;
- `fallback_delta` evidence;
- snapshot/fingerprint providers, mutation leases, and unused pairing runtime;
- changed-file delivery/update inputs;
- `observedDirtyPaths`, `noFileChanges`, and rationale-skip inputs;
- snake-case rationale and delivery-report aliases;
- deprecated connector capability and hook-type projections; and
- mission-only session-key lookup and old local manifest upgrades.

Historical database columns may remain where they still serve `record-work` or
stored review records, but they are not accepted as inputs to the new ledger
surface.

## Verification matrix

| Case | Required result |
| --- | --- |
| Concurrent processes append distinct paths | No record is lost; state files remain mode `0600` in mode `0700` directories. |
| Two objectives share one workspace and path | Each objective retains an independent durable row. |
| Callback supplies no objective | No binding is selected and no path is recorded. |
| Callback supplies a mission id only | No binding is selected. |
| Direct path is absolute inside the workspace | It is reduced locally to its canonical relative path. |
| Path escapes through `..` or a symlink | It is rejected and bounded health is recorded. |
| Shell/no-path callback | No worktree scan occurs; unavailable health is recorded. |
| More than 25 pending records | The CLI drains every batch before delivery. |
| Backend receives valid and invalid siblings | Valid items persist; invalid items return warnings. |
| Same idempotency key is replayed | The replay is ignored without duplicating the row. |
| Weaker evidence follows direct evidence | Stored source/quality are not downgraded. |
| Delivery sync fails | Delivery succeeds and local unsynced evidence remains retryable. |
| Delivery contains a retired field | The request fails with a clear invalid-input error. |
| Delivery report contains malformed optional siblings | Valid siblings persist and bounded warnings identify invalid ones. |
| No Git repository exists | Direct capture and delivery behave identically. |

Tests must include real simultaneous CLI processes. Sequential promise loops do
not validate cross-process locking.

## Acceptance criteria

The program is complete when:

1. contract, CLI, backend, database, MCP, web, connector, and documentation
   surfaces all implement contract 116;
2. no active code or generated artifact references the retired attribution or
   compatibility model;
3. direct path evidence is objective-bound, workspace-safe, bounded, atomic, and
   fully drained;
4. per-item evidence failure and unavailable change tracking cannot reject a
   delivery;
5. every observed file is reviewable without a rationale;
6. source, quality, overlap, and hook health are visible to reviewers;
7. Local and Cloud share the same Protocol semantics; and
8. targeted builds, typechecks, unit tests, cross-process tests, connector
   generation checks, migration tests, and contract-version checks pass.
