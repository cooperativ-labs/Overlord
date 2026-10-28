# Review, Artifacts, And Change Tracking

## Goal

Port the review record that makes Overlord useful after an agent finishes: delivery summaries, artifacts, shared context, and a compact list of the files changed during each objective.

## Delivery Review Requirements

A delivery should preserve:

- What was asked.
- What happened.
- What was delivered.
- What changed and why, explained by behavior or component in the summary.
- What verification was run.
- What still needs follow-up.

Requirements:

- Delivery summary is a narrative, not a command log.
- Delivery moves the mission to review.
- Delivery stores the summary, artifacts, and delivery report as first-class records. There is no
  per-file explanation record; the objective's changed-file evidence is stored separately.
- Delivery is linked to the objective and, when work happened through an attached agent, the session. `record-work` deliveries may have no session.
- Follow-up deliveries should not destroy previous delivery history.

## Artifact Requirements

Supported structured artifact types:

- `test_results`
- `next_steps`
- `note`
- `url`
- `decision`
- `migration`

Requirements:

- Artifacts are part of delivery payloads.
- Artifacts should have `type`, `label`, and `content`.
- Artifacts can be rendered by CLI now and web app later.
- Large files should use objective attachments instead of inline artifact content.

## Objective Attachment Requirements

Requirements:

- Attachments belong to a specific objective.
- Agents see active objective attachments in attach/load-context responses.
- CLI supports list, upload, and download/open commands.
- Local MVP can store files on disk under an Overlord-managed attachment directory.
- Future hosted mode can swap in signed upload/download URLs without changing command names.
- Soft-deleting attachment metadata should enqueue storage cleanup for the underlying bytes instead of deleting them inside the same database write.

## Shared Context Requirements

Requirements:

- Store stable facts that future sessions need.
- Avoid using shared context as full transcript storage.
- Support small keys such as `repo.testing`, `deploy.target`, `arch`, or `env.secrets.path`.
- Support JSON values and strings.
- Support tags and filtered reads.

## Delivery Summary And File Evidence

Contract v165 removed per-file change rationales. Delivery explains the outcome, why it
matters, verification, and limitations by behavior or component in the summary. Reviewers see
a separate, cumulative **Files changed during this objective** list grouped by resource.

Rules:

- A summary is the only required delivery input. Tracking gaps and sync failures never block
  delivery.
- Before delivering, the agent reads the captured paths once (`ovld protocol changes`), declares
  only files it knows it changed that capture missed, and writes the summary. A handful of
  representative paths is enough; there is no exhaustive enumeration gate.
- `--change-rationales-*`, `--changed-files-*`, and the `changeRationales` / `changedFiles` payload
  fields are rejected.
- Do not send `file_changes` as a generic artifact.
- The optional delivery composer may condense the summary and report facts, but it never
  generates per-file explanations, behavior, or test claims from filenames.

## Mechanical Changed File Capture

Changed-file capture must not depend on the agent remembering to enumerate what it
changed:

- The **objective ledger** is authoritative. Hook-aware connectors append path evidence keyed by
  objective and protocol session, and the CLI syncs it automatically on `update`, `changes`, and
  `deliver`. The agent supplies no file list.
- A path claim is **non-exclusive**. Two objectives editing the same file in one worktree each
  record it; neither overwrites nor suppresses the other.
- `capture-change` requires an explicit objective-bound session. CWD only supplies the workspace
  root and never selects an objective.
- A native post-tool payload that the connector codec normalizes as a file edit **with a
  successful outcome** records `source=declared_edit` (shown as Native). Failed, blocked, and
  cancelled calls add no path; unknown outcomes record `outcome_unavailable` and partial failures
  `outcome_partial`. Shell callbacks record `shell_activity_unverified` (coverage uncertainty,
  never a claimed write), and other pathless or unmapped callbacks `direct_path_unavailable`.
  Overlord never promotes a shared-worktree delta to attribution.
- Known shell, script, and generator outputs, deletes, and both rename endpoints that capture
  missed are declared with `--paths a,b` or `--paths-file <path|->` (a JSON string array) on
  `update` or `deliver`, and record `source=agent_declared` (shown as Declared). A later
  declaration never downgrades native evidence.
- Declarations also work with an explicit session key and objective when the local binding
  or ledger is unavailable. The CLI applies the same path/ignore policy in memory and sends
  batches through authenticated `sync-changes`; the server session determines the objective
  and resource. These fallback rows appear in `objective-changes`, not the local ledger.
  If synchronization fails, delivery continues with a warning to repeat the declarations;
  there is no durable local retry copy in this fallback.
- The owner-only ledger (schema v3) stores normalized workspace-relative paths with source,
  observation time, bounded hook health, sync state, and per-session capture binding/callback
  state. It never stores or transmits file content, diffs, commands, transcripts, environment
  values, fingerprints, or absolute host paths.
- `.overlordignore` patterns are applied before ledger insertion. Matching paths never enter the
  ledger or reach the backend.
- Paths under `.overlord/` are always excluded at the same boundary, including ephemeral runtime
  files and `project.json`.
- `sync-changes` processes bounded batches independently. Invalid items become warnings; valid
  siblings persist. Sync and hook failures are advisory and cannot reject delivery.
- Run `ovld protocol changes --objective-id <id>` to drain the ledger and read this checkout's
  evidence (`LocalObjectiveChangesDto`, `scope: local_objective_sessions`): synced and pending
  paths deduplicated by path, a 200-row cap with pre-cap `total` and `truncated`, sync counts,
  capture binding, and warnings. `coverage: unavailable` means no local session/ledger could
  be read, not that nothing changed. `capture.healthCodes` and stderr distinguish a missing
  binding file, unreadable/invalid storage, or an objective missing from this working directory.
  Re-run `protocol attach` in the intended checkout with the same `OVLD_HOME`, and check its
  storage permissions. A `bound_no_callback` warning means the binding exists but no native
  callback has arrived; check that the connector is installed and the launched process has
  `OVERLORD_OBJECTIVE_ID`. Attach warns if it cannot persist its binding. The 64-session
  retention limit applies per objective, not across all objectives ever run in a checkout;
  the manifest remains bounded to 512 KiB and never evicts another objective to make room.
- `ovld protocol objective-changes --objective-id <id>` (hosted MCP `overlord_changes`, REST
  `GET /api/missions/:id/file-changes?objectiveId=`) reads the objective's synchronized evidence
  across every session, resource, and device (`scope: server_objective`). It cannot see
  unsynchronized local rows.

## Review State

- The active changed-file identity is `(objective_id, resolved resource, file_path)` across
  sessions, so the same relative path in two resources stays two rows. A later observation
  refreshes the last observed time instead of creating a duplicate row.
- Rows are cumulative objective evidence, including edits later reverted. They are not a Git
  diff, a delivery-time snapshot, or proof of exclusive ownership; late sync may extend them.
- `source` is `declared_edit` (Native), `agent_declared` (Declared), or `null` (Unknown, for
  historical rows whose provenance could not be established).
- `record-work` accepts explicit `declaredPaths`, recorded as Declared with no session, because
  completed chat work has no attached execution target capable of producing a ledger.

Future web/desktop requirements are documented in [web-app.md](../../webapp/docs/web-app.md).

## Review Workflow Requirements

Humans should be able to review:

- Mission title/objective and human-only notes.
- Session progress updates.
- Blocking questions and answers.
- Delivery summary.
- Artifacts.
- Changed files by resource, their Native / Declared / Unknown source, and capture or sync warnings.
- Follow-up objectives.

CLI review commands can be added before UI:

- `ovld mission context <id>`
- `ovld mission events <id>`
- `ovld mission deliveries <id>`
- `ovld mission artifacts <id>`
- `ovld mission file-changes <id>`

Agents update an existing artifact in place with
`ovld protocol update-artifact` (or MCP `overlord_update_artifact`) rather than
delivering a duplicate copy. The command requires the current
`expectedRevision` and accepts any non-empty subset of label / content text /
external URL — the same mutation as the web/mobile PATCH editor.

## Security And Data Boundaries

Requirements:

- Linking a repository must not automatically store repository contents.
- Change capture never reads local VCS state. Separate explicit review commands may read status
  or diffs but cannot mutate the repository or turn a worktree delta into objective attribution.
- Terminal output should only be persisted when a user or agent records it.
- Secrets should not be pasted into missions, artifacts, updates, or shared context.
- Attachments are explicit uploads/imports.
- Changed-file evidence stores paths and bounded provenance metadata, never file contents.

## Acceptance Criteria

- A delivered mission can be reviewed without opening the original agent chat.
- The changed-file list distinguishes empty evidence, unavailable tracking, and truncated results.
- A later objective can read shared context written by an earlier objective.
- Artifacts and attachments are distinguishable.
