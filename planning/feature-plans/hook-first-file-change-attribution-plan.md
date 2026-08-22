# Hook-First File-Change Attribution: Implementation Plan

Mission `coo:825`, objective `coo:825.j6ae`.

This plan combines the findings in:

- `planning/feature-plans/delivery-format-investigation.md`
- `planning/feature-plans/file-change-attribution-audit.md`

It replaces the current delta-first attribution model with paired mutation windows: capture a
workspace snapshot at the harness's pre-tool boundary, capture a second snapshot at its post-tool
boundary, and bind the resulting path evidence to the objective that invoked the tool.

## Outcome

After this work, a normal agent delivery supplies a summary and nothing else about file paths.
Overlord obtains paths from objective-bound hooks, syncs those paths independently of the delivery
payload, and treats rationales as optional annotations. Two objectives may both record the same path;
neither record owns the file and neither competes with the other. File-attribution uncertainty,
missing rationales, malformed advisory evidence, or a failed hook sync can warn, but cannot reject an
otherwise valid delivery.

Keep JSON as the machine boundary. The earlier investigation showed that YAML and TOON do not fix
the observed rejection modes: shell quoting fails before parsing, and schema failures occur after
parsing. The useful format change is to remove agent-authored file structures from the delivery path,
not replace JSON.

## Requirements translated into invariants

| Requirement                                                  | Implementation invariant                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Several agents can edit the same file in one worktree        | A path claim is non-exclusive and keyed by objective. `(objective, path)` is independent from every sibling objective's record.                        |
| A delivery should not require a total JSON rewrite           | Delivery and file-evidence sync are independent operations. Optional evidence is salvaged per item and returns warnings.                               |
| Agents should not track their own file changes               | The CLI reads the objective ledger automatically. The agent neither enumerates paths nor supplies a rationale in the normal case.                      |
| Overlord records proactive agent edits, not every dirty file | Only hook evidence enters the authoritative objective ledger. A worktree-wide delta is never promoted to exact attribution.                            |
| Unrelated edits must not block                               | `missing_rationale` is removed as a delivery gate. Incomplete or ambiguous attribution remains review metadata.                                        |
| File contents remain private                                 | Snapshots store local fingerprints and path metadata only. No content, patch, command output, transcript, or environment value is sent to the backend. |

## A necessary limitation

A before/after filesystem comparison proves that a path changed during a time window. By itself it
does **not** prove which process wrote it. If agent A and agent B have overlapping shell-tool windows,
or a person saves a file while an agent's shell command is running, both events are inside the same
snapshot interval.

The implementation must not label that evidence “exact.” It uses three sources:

| Source            | Meaning                                                                      | Authoritative path record?                                     |
| ----------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `declared_edit`   | A successful edit/write tool named the path in its native payload            | Yes                                                            |
| `window_observed` | A path fingerprint changed between paired pre/post snapshots                 | Yes, with explicit observed quality; never exclusive ownership |
| `fallback_delta`  | A connector has no usable paired hooks, so the attach/deliver delta was used | Review-only inferred evidence                                  |

An overlap flag is stored on `window_observed` evidence. Direct edit evidence stays attributable
during overlap because the tool itself names its target. Shell/unknown-tool evidence remains honest
about the window: it can say “observed during this objective's tool call,” not “only this objective
wrote these bytes.” Because no rationale gate remains, uncertainty cannot force an agent to claim a
peer's work or fabricate prose.

For stronger shell attribution, the CLI should add a cooperative per-worktree mutation lease. Every
hook-aware file-edit, notebook, shell, and unknown mutation-capable tool acquires the lease at pre-tool
and releases it at post-tool. This serializes mutation execution, not agent reasoning. The lease is an
accuracy aid, not an availability dependency: a timeout or abandoned lease marks the window
overlapping/degraded and lets the harness continue. Arbitrary external processes remain outside this
coordination, which is why the evidence name remains `window_observed` rather than `exact`.

## Target data flow

```text
harness PreToolUse / equivalent
  -> local scope gate (must identify objective + protocol session)
  -> acquire mutation lease or record degraded overlap
  -> write local pre-snapshot keyed by objective + native call id

harness executes tool

harness PostToolUse / equivalent
  -> resolve the same objective + native call id
  -> write post-snapshot
  -> derive declared paths + snapshot delta
  -> atomically append evidence to the objective-local ledger
  -> release mutation lease

ovld protocol update / changes / deliver
  -> read ledger automatically
  -> sync new path evidence in bounded batches
  -> backend upserts one changed_files record per objective + path
  -> optional rationale is attached when available

deliver
  -> persists the delivery even if hook health, file sync, rationale, or advisory
     deliveryReport evidence is incomplete
  -> returns warnings and changeTrackingStatus for review
```

## Local attribution model

### Identity and pairing

The current local artifacts are hashed from `(cwd, missionId)`. That is the wrong unit: two parallel
objectives of one mission share and overwrite their state. Replace it with a versioned local key based
on:

```text
canonical repository root
objective UUID (preferred; display id is an alias, not the durable key)
protocol session id
native session/call id
```

`OVERLORD_OBJECTIVE_ID`, already injected by the runner, is the first objective hint. The CLI resolves
it through the objective-scoped cached protocol session created by `attach`. The hook payload's native
session id and call id pair pre/post invocations; they never authorize or select an objective. A cwd is
only the snapshot root. It must never choose the most recently attached mission.

If objective/session resolution is missing or ambiguous, the hook records a local health failure and
does not guess. This deliberately removes `resolveActiveMissionForCwd(...).mostRecent` from the
attribution path.

### Snapshot contents

Persist snapshots under the Overlord global data directory, outside the checkout, with owner-only
permissions and atomic rename. Each snapshot contains:

- schema version, objective id, protocol session id hash, native session/call id;
- canonical repository root and resource id/key when known;
- tool class and declared path candidates, but no raw tool input;
- start/end timestamps and mutation-lease state;
- repository HEAD/index identity when VCS exists;
- normalized repo-relative path fingerprints: existence, kind, size, mtime, and content digest;
- hook version, adapter key, and completion/overlap flags.

For direct edit tools, fingerprint only declared paths. For shell and unknown mutation-capable tools,
use a repository snapshot provider:

1. In Git checkouts, read porcelain v2 with full untracked expansion, hash every currently dirty or
   untracked path, and retain HEAD/index identity. At post-tool, newly dirty paths are candidates,
   already-dirty paths are detected by a changed digest, and paths committed during the window are
   recovered by comparing the pre/post revisions.
2. Without VCS, walk the project using the same ignore policy and compare path fingerprints. This is
   slower but keeps attribution available for non-Git resources.
3. Apply `.overlordignore` before ledger insertion in both providers.

No net change across the window means no path evidence. Creating and then removing a temporary file,
or formatting and restoring a file to the same bytes, should not become review noise.

### Objective ledger

Replace the mission-keyed touched log, Bash snapshot, and rationale-note files with one versioned,
objective/session-keyed ledger. Append observations atomically under a local lock and fold them by
normalized path:

```ts
type PathEvidence = {
  objectiveId: string;
  sessionId: string;
  resourceId?: string;
  filePath: string;
  state: 'present' | 'resolved' | 'unknown';
  source: 'declared_edit' | 'window_observed' | 'fallback_delta';
  toolWindowId?: string;
  overlap: boolean;
  firstObservedAt: string;
  lastObservedAt: string;
  rationaleSeed?: string;
};
```

The ledger is append-safe across processes and idempotent by `(objective, session, toolWindow,
path, postFingerprint)`. A second objective recording the same path creates a separate ledger entry.
Repeated edits by one objective fold into one current path record while retaining bounded provenance.

Rationale seeds remain local and optional. Direct edit tools can provide a mechanical phrase such as
“updated via apply_patch”; a high-confidence shell command parser may add a better seed. Do not read a
transcript to manufacture intent, and do not require the agent to turn a seed into prose.

## Server and delivery behavior

### Sync path evidence separately

Add a bounded, idempotent `sync-changes` protocol/service operation. The CLI calls it automatically
from progress updates, preflight, and immediately before delivery. It accepts CLI-generated path
evidence in small batches and returns per-item `accepted`, `ignored`, or `warning` results. One bad
path does not roll back the other paths and never rolls back a delivery.

The CLI keeps unsynced ledger entries locally for retry. The agent never handles this JSON and never
rewrites a delivery payload because a path item was malformed.

Persist normalized evidence in `changed_files`; use `observed_metadata_json` for source, overlap,
tool-window, hook-health, and adapter-version metadata. Do not persist fingerprints or raw commands.
Change the active uniqueness rule from `(session_id, objective_id, file_path)` to
`(objective_id, file_path)` and retain `session_id` as last-observer/provenance metadata. Update
`recordWork` and upsert lookups for the new conflict target before replacing the index.

### Make rationales optional

Remove `missing_rationale` as a delivery error. A changed-file row without prose is a valid,
reviewable result. `change_rationales` remains available when an agent or human supplies useful
context, but no placeholder row and no generated prose is required.

The File Changes panel must start from `changed_files` and left-join the optional rationale. This
fixes the existing rationale-first inversion that hides mechanically observed files and shows phantom
rationales as though they were observations.

### Make delivery tolerant

Retain JSON and make the normal delivery input small:

```text
required: summary
automatic: synced objective ledger
optional: rationale overrides, artifacts, deliveryReport.agentReport
```

Apply the prior delivery-format recommendation in the same program:

- salvage advisory `deliveryReport` entries independently, with warnings;
- lift obvious wrapper mistakes instead of silently dropping them;
- clamp or skip invalid optional items instead of throwing;
- keep `--*-file -` as the documented path for shell-special or large prose;
- never let Gemini availability delay delivery;
- use Gemini only after persistence for optional presentation/extraction.

The delivery response additively reports `changeTrackingStatus` (`complete`, `partial`, `unavailable`)
and bounded warnings. This is review truth, not a gate.

## Contract impact

This is cross-module work and must be contract-first. The first implementation change must update
the contract before code:

| Surface/component             | Required contract work                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connector -> CLI hook surface | Replace the PostToolUse-only edit-capture description with harness-native paired pre/post mutation windows. Describe it through behavior capabilities (`observe.toolCall`, `observe.toolResult`, `observe.fileEdit`), not by adding `PreToolUse` to the deprecated four-value `approvedHookTypes` projection. |
| CLI                           | Declare the local snapshot/ledger owner, scope rules, privacy boundary, and local-only pre/post hook command.                                                                                                                                                                                                 |
| Protocol/service              | Add `sync-changes`, per-item salvage semantics, additive `changeTrackingStatus`, and the rule that change evidence/rationales cannot reject delivery. Update `contract/protocol-commands.yaml` and `contract/components.yaml`.                                                                                |
| Database                      | Update the schema contract and migrations for objective/path uniqueness. Keep source details in existing `observed_metadata_json`; no file-content column is added.                                                                                                                                           |
| REST/web                      | Add the changed-file-first review projection and additive attribution-quality fields.                                                                                                                                                                                                                         |
| Local and Cloud editions      | Hooks and snapshots run on the execution target; both editions send the same metadata-only Protocol payload to their configured backend. No Cloud-only filesystem access is introduced.                                                                                                                       |
| Connectors                    | Update descriptors, executable fixtures, conformance manifests, generated projections, adapter versions, and installed skills from the shared connector source.                                                                                                                                               |

Increment the contract version because this adds a stable protocol command, changes delivery
semantics, changes a database uniqueness constraint, and promotes paired pre-tool observation into
the connector interaction surface.

## Implementation sequence

### Phase 0 — prove the hook pairs and freeze the contract

1. Record real pre/post payload pairs for Claude, Codex, Cursor, Antigravity, Pi, and OpenCode.
2. Prove a stable native call id, session id, cwd/root field, tool name, result/success signal, and
   direct-edit path field for each supported integration shape.
3. Benchmark direct-path and repository snapshots on small, medium, and large repositories.
4. Write the contract/version changes and conformance fixtures before implementation code.
5. Define hook failure behavior: local scope gate before logging/spawn, short bounded execution,
   fail toward the harness, no database/network access from adapter scripts.

Exit criterion: each connector is classified `paired`, `post-only`, or `unsupported` from executable
evidence. Do not infer parity from similar event names.

### Phase 1 — remove delivery pressure first

1. Remove rationale coverage as a delivery gate.
2. Make advisory delivery evidence per-item tolerant and return warnings.
3. Invert the review query/UI to start from `changed_files`.
4. Add the objective/path unique index, after updating both `recordWork` and normal upserts.
5. Add regression tests proving a delivery persists with no rationale, malformed optional evidence,
   or unavailable Gemini.

This phase must precede attribution cutover. It makes every later hook imperfection visible but
non-blocking.

### Phase 2 — objective-keyed local ledger

1. Add the versioned ledger and migrate only trustworthy current-session state; do not merge old
   mission-keyed logs into an objective by guessing.
2. Key attach/reset/session-key lookup by objective and session.
3. Remove most-recent-mission resolution from writes; unresolved hooks record health only.
4. Add local `sync-changes` batching and retry state.
5. Keep the existing delta path in shadow mode for comparison, never as exact evidence.

Exit criterion: two objectives in one mission can attach in the same cwd without resetting or reading
each other's ledger.

### Phase 3 — paired hooks on the verified callback adapters

1. Implement one shared CLI pre/post parser and thin adapter scripts.
2. Register paired hooks for the adapters Phase 0 proved (expected first: Claude, Codex, Cursor).
3. Add direct-path fast paths, shell repository snapshots, call pairing, abandoned-window cleanup,
   overlap detection, and the cooperative mutation lease.
4. Run old and new attribution in shadow mode and compare only path metadata.
5. Promote a connector only when its executable fixtures prove bound, unbound, success, failure,
   malformed payload, timeout, missing post-hook, and concurrent-window behavior.

Exit criterion: shadow telemetry shows no objective cross-talk and hook latency stays within the
budget established in Phase 0.

### Phase 4 — cut over the product path

1. Make the objective ledger the candidate set for paired connectors.
2. Stamp post-only/hookless delta results `fallback_delta`; never label them exact.
3. Auto-sync on update/preflight/deliver and surface hook health locally and in review.
4. Remove peer-claim arbitration, `mine/claimed/unclaimed`, auto-generated skip reasons,
   `observedDirtyPaths` coverage reconciliation, and the rationale preflight burden.
5. Rewrite the mission skill and CLI help so agents are not instructed to enumerate paths or satisfy
   rationales.

Exit criterion: the normal agent delivery includes no file list or rationale fields and cannot fail
for either.

### Phase 5 — finish the connector fleet and retire the old model

1. Implement paired integrations for Pi/OpenCode/Antigravity only where recorded harness evidence
   supports them; otherwise retain honest inferred status.
2. Add the no-VCS snapshot provider and performance safeguards.
3. Delete the mission-keyed baseline/touched/Bash snapshot/peer-claim code after one compatibility
   release.
4. Remove or repair the documented `record-change-rationales` surface; do not leave a 404 in the
   skill.
5. Update `cli/docs/11-review-artifacts-and-change-tracking.md`, connector capability docs, and the
   generated connector projections.

## Verification matrix

| Case                                                                  | Required result                                                                                                       |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Two objectives directly edit the same file                            | Both objectives show the path; neither row conflicts or overwrites the other.                                         |
| Two objectives directly edit different files with overlapping windows | Each ledger contains only its declared path.                                                                          |
| Shell window overlaps another agent's edit                            | Shell candidates carry overlap/window quality; the direct edit stays bound to its objective; both deliveries succeed. |
| User saves a file during a shell window                               | The path may be window-observed but can never trigger a rationale or delivery failure.                                |
| File was dirty before pre-tool and changes again                      | Fingerprint change records the path; status-letter equality does not hide it.                                         |
| New directory with several untracked files                            | Every file is recorded individually; no directory-valued pseudo-path.                                                 |
| Rename/delete                                                         | Normalized old/new path semantics are deterministic and covered by fixtures.                                          |
| Tool changes then restores a file                                     | No final path evidence.                                                                                               |
| Tool commits its change                                               | Pre/post revision comparison retains the path even though post status is clean.                                       |
| Pre-hook succeeds and post-hook never arrives                         | Window expires as incomplete, lease is released, health is partial, delivery succeeds.                                |
| Hook payload has no objective binding                                 | Nothing is attributed; no most-recent-session guess; delivery succeeds with an unavailable warning.                   |
| Connector has no paired hooks                                         | Delta is review-only `fallback_delta`; delivery succeeds.                                                             |
| Optional rationale/evidence item is malformed                         | Valid siblings persist, invalid item returns a warning, delivery persists.                                            |
| No Git repository                                                     | Filesystem provider records path fingerprints without sending content.                                                |

Add integration tests with two actual CLI processes sharing one temporary repository. Unit tests alone
cannot prove cross-process locking, objective isolation, atomic ledger writes, or same-file behavior.

## Rollout and observability

Ship shadow mode first. Record counts only:

- pre windows opened, paired, expired, or ambiguous;
- paths by evidence source and overlap state;
- old-delta/new-ledger disagreement counts;
- sync accepted/warned/retried counts;
- hook latency by adapter and tool class;
- deliveries rejected for change tracking (target: zero).

Never log path content, fingerprints, raw commands, transcript paths, environment values, or tool
output. Path names already enter the review record; operational telemetry should use counts rather
than duplicate them.

Cut over per connector behind a capability-derived flag, not an agent-name conditional. Roll back by
returning that connector to `fallback_delta`; do not restore the rationale gate.

## Acceptance criteria

The program is complete when:

1. two concurrent objectives in one worktree can each report the same path without collision;
2. no hook write is scoped by mission-only or cwd-most-recent resolution;
3. a normal delivery requires no agent-authored file path or rationale;
4. no file-attribution or optional-evidence error can reject delivery;
5. every observed file is visible without a rationale;
6. source/quality/overlap and hook health are visible to reviewers;
7. paired connectors pass real pre/post, unbound, crash, and concurrent-process fixtures;
8. neither local snapshots nor backend records contain file contents or diffs;
9. Local and Cloud pass the same protocol conformance suite; and
10. old mission-keyed/peer-claim attribution is removed after the compatibility window.

## Recommended first implementation slice

Do not begin with every connector. The smallest end-to-end slice is:

1. contract/version changes;
2. non-blocking delivery and changed-file-first review;
3. objective-keyed local ledger;
4. paired pre/post hooks for one fixture-rich adapter;
5. `sync-changes` plus the `(objective_id, file_path)` upsert; and
6. a two-process same-worktree integration test where both objectives edit the same file.

That slice proves the hard data model and concurrency behavior before multiplying adapter-specific
work. Once it works, the remaining connectors are capability/fixture work rather than a second
architecture.
