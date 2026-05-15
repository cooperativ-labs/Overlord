# Checkpoints and change-tracking

This document explains how Overlord registers checkpoints for file-change records and how those checkpoints tie back to tickets, objectives, and review history.

For product-level background and workflows, see the web docs page for [File changes & checkpoints](../apps/web/app/docs/workflow/file-changes/page.tsx) and [Context & artifacts](../apps/web/app/docs/for-agents/context-and-artifacts/page.tsx).

## What problem checkpoints solve here

Overlord needs durable, inspectable file state per session: stable anchors to attach file-change rationales and checkpoints. Checkpoints give the system a git-backed reference point for the workspace that was current when the rationale or delivery was recorded.

## How checkpoints are registered

Checkpoint registration happens in the protocol layer:

- The client captures snapshot metadata from git, including `gitCommitId`, `headSha`, and optional `diffStat`.
- `update`, `deliver`, and `record_change_rationales` can send that snapshot to the API.
- The server writes or updates a `project_checkpoints` row keyed by `project_id` and `objective_id`.
- File-change rows link to that checkpoint so review can show the exact tree that was current when the rationale was recorded.

Delivery can also include explicit checkpoint metadata. When present, Overlord stores the checkpoint kind alongside the git commit and links the rationale rows to the same checkpoint record.

## Change-tracking data model

Relevant checkpoint fields stored in the database:

| Column | Meaning |
| --- | --- |
| `checkpoint_kind` | `objective`, `delivery`, or `manual`. |
| `git_commit_id` | Git commit recorded for the checkpoint. |
| `git_ref_name` | Hidden ref used to store the checkpoint commit. |
| `head_sha` | Repository HEAD at the time the checkpoint was created. |
| `summary` | Human-readable summary of the checkpoint. |
| `diff_stat` | Optional diff stat captured with the checkpoint. |

Semantic change-rationale fields such as `label`, `summary`, `why`, and `impact` are Overlord-native. The checkpoint fields are provenance anchors for the workspace state.

## Where it is implemented

| Area | Location |
| --- | --- |
| Checkpoint upsert helper | `lib/overlord/checkpoints.ts` |
| Snapshot validation | `lib/overlord/validation.ts` |
| Deliver protocol route | `apps/web/app/api/protocol/deliver/route.ts` |
| Update protocol route | `apps/web/app/api/protocol/update/route.ts` |
| Change-rationale protocol route | `apps/web/app/api/protocol/record-change-rationales/route.ts` |
| Git checkpoint creation | `lib/snapshot/git-checkpoint.ts` |
| File-change inserts | `lib/overlord/file-changes.ts` |

## Troubleshooting

### No checkpoint was registered

- Check that the protocol payload included a `snapshot.gitCommitId`.
- Confirm the ticket belongs to a project, because checkpoint rows require a `project_id`.
- On `deliver`, confirm the payload included either a snapshot or explicit checkpoint metadata.

### Checkpoint metadata looks incomplete

- Confirm `workspacePath` points at the repository that was edited.
- Capture the snapshot after meaningful edits and before recording rationales.
- If the snapshot lacks `gitCommitId`, the server will not upsert a checkpoint row.

## Related pages

- [File changes & checkpoints](../apps/web/app/docs/workflow/file-changes/page.tsx)
- [Context & artifacts](../apps/web/app/docs/for-agents/context-and-artifacts/page.tsx)
- [CLI reference](../apps/web/app/docs/for-agents/cli-reference/page.tsx)
