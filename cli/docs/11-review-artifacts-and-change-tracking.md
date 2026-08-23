# Review, Artifacts, And Change Tracking

## Goal

Port the review record that makes Overlord useful after an agent finishes: delivery summaries, artifacts, shared context, and file-level change rationales.

## Delivery Review Requirements

A delivery should preserve:

- What was asked.
- What happened.
- What was delivered.
- What changed and why.
- What verification was run.
- What still needs follow-up.

Requirements:

- Delivery summary is a narrative, not a command log.
- Delivery moves the mission to review.
- Delivery stores artifacts and change rationales as first-class records.
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

## Change Rationale Requirements

Rationales are optional reviewer annotations for mechanically observed paths:

```json
{
  "label": "Short reviewer title",
  "filePath": "path/to/file.ts",
  "summary": "What changed.",
  "why": "Why it changed.",
  "impact": "Behavioral impact.",
  "hunks": [{ "header": "@@ -10,6 +10,14 @@" }]
}
```

Rules:

- Changed files are captured mechanically, so delivery neither requires a rationale nor can
  fail for lacking one.
- When one is supplied, `filePath`, `label`, `summary`, `why`, and `impact` are all required
  on that entry; a malformed entry is salvaged per item and returns a warning.
- `hunks` should be captured when available.
- Formatting-only changes may remain mechanically observed without a rationale.
- Do not send `file_changes` as a generic artifact.
- Record rationales during `update` or during `deliver`.

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
- A native post-tool payload that directly names an edited path records
  `source=declared_edit`, `quality=direct`. A shell/no-path callback records unavailable health
  and claims no file. Overlord never promotes a shared-worktree delta to attribution.
- `source=window_observed`, `quality=window` is reserved for a connector whose strict fixtures
  and runtime both prove a matched pre/post mutation window; no shipped connector currently does.
- The owner-only ledger stores normalized workspace-relative paths and bounded source, quality,
  overlap, window, and hook-health metadata. It never stores or transmits file content, diffs,
  commands, transcripts, environment values, fingerprints, or absolute host paths.
- `.overlordignore` patterns are applied before ledger insertion. Matching paths never enter the
  ledger or reach the backend.
- `sync-changes` processes bounded batches independently. Invalid items become warnings; valid
  siblings persist. Sync and hook failures are advisory and cannot reject delivery.
- Run `ovld protocol changes --objective-id <id>` to drain the ledger and inspect
  `objectiveId`, `synced`, `warning`, `unsyncedEvidence`, and bounded health entries.

## Review State

- The active changed-file identity is `(objective_id, file_path)` across sessions. A later
  observation refreshes last-observer provenance instead of creating a duplicate row.
- A changed-file row can exist without a rationale and remains fully reviewable.
- Review starts from mechanically observed `changed_files` and joins the latest optional
  rationale, whether it was recorded during update or delivery. It never starts from rationale
  prose.
- `record-work` is the sole path that accepts explicit `changedFiles`, because completed chat work
  has no attached execution target capable of producing a ledger.

Future web/desktop requirements are documented in [web-app.md](../../webapp/docs/web-app.md).

## Review Workflow Requirements

Humans should be able to review:

- Mission title/objective and human-only notes.
- Session progress updates.
- Blocking questions and answers.
- Delivery summary.
- Artifacts.
- Changed files, attribution metadata, hook health, and optional rationales.
- Follow-up objectives.

CLI review commands can be added before UI:

- `ovld mission context <id>`
- `ovld mission events <id>`
- `ovld mission deliveries <id>`
- `ovld mission artifacts <id>`
- `ovld mission rationales <id>`

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
- Change rationales store descriptions and hunk headers, not necessarily full file contents.

## Acceptance Criteria

- A delivered mission can be reviewed without opening the original agent chat.
- Mechanically observed paths remain reviewable with or without optional rationale prose.
- A later objective can read shared context written by an earlier objective.
- Artifacts and attachments are distinguishable.
