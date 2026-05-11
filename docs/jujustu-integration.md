# Jujutsu (jj) integration and change-tracking

This document explains how Overlord uses **Jujutsu** (`jj`) for local versioning, delivery checkpoints, and **change-tracking** (`file_changes` in the database). It is written so an agent can **diagnose and explain** change-tracking issues to a user without guessing.

For product-level research and tradeoffs, see [`ai/feature-plans/jj-integration-research.md`](../ai/feature-plans/jj-integration-research.md).

## What problem jj solves here

Overlord needs **durable, inspectable file state** per session: stable anchors to attach **file-change rationales** and checkpoints. For local Desktop projects, users opt in under **Workflow → Initialize in this folder**; Overlord runs `jj` in the **real** project working directory (no shadow clone or managed workspace under Application Support). JJ then provides:

- **`change_id`** (logical line of work) and **`commit_id`** (immutable tree snapshot) after `jj util snapshot`.
- **`operation_id`** from the operation log for timeline evidence.

The hosted API stores checkpoint metadata; `jj` runs on the user’s machine (Electron or CLI). Version control for snapshots is **off by default** until the user enables it for that project.

## How checkpoints run in code

- **`installLocalVersionControl`** (`lib/snapshot/install-local-version-control.ts`) — ensures `jj` is available, initializes or adopts a repo in the chosen directory, runs an initial snapshot.
- **`createLocalCheckpoint`** (`lib/snapshot/local-checkpoint.ts`) — runs `jj util snapshot` (or Git fallback) in **`workspacePath`** and collects ids + diff stat for delivery / persistence.

Desktop sets `OVERLORD_SNAPSHOT_JSON` when the API sends `X-Local-Version-Control: jj` so the agent’s cwd matches the folder where jj was initialized (`apps/desktop/electron/services/agent-launcher.ts`).

## Change-tracking: database and protocol

### `file_changes` row model

Relevant columns (see `types/database.types.ts` and insert helpers in `lib/overlord/file-changes.ts` / `supabase/functions/mcp/handlers/_change-rationales.ts`):

| Column             | Meaning |
| ------------------ | ------- |
| `snapshot_backend` | `jj` or `git-worktree` (or null if not supplied). |
| `workspace_name` | Optional label for the tree that was snapshotted. |
| `workspace_path`   | Absolute path to that workspace (usually the project working directory). |
| `jj_change_id`     | JJ change id when backend is jj. |
| `jj_commit_id`     | JJ commit id at time of recording. |
| `jj_operation_id`  | JJ operation id at time of recording. |

Semantic fields (`label`, `summary`, `why`, …) are **Overlord-native**; JJ fields are **anchors** for provenance.

### How snapshot metadata gets attached

Protocol validation (`lib/overlord/validation.ts`) allows an optional **`snapshot`** object on `update`, `deliver`, `record_change_rationales` (and MCP equivalents). Shape includes `backend`, `workspaceName`, `workspacePath`, and optional `jjChangeId`, `jjCommitId`, `jjOperationId`.

**Agent rule:** after a local `jj util snapshot`, pass **`jjChangeId`**, **`jjCommitId`**, **`jjOperationId`**, plus **`workspacePath`** / **`workspaceName`** and **`backend: 'jj'`** so DB rows match the tree that was snapshotted.

## Troubleshooting (short)

### No `jj_change_id` / `jj_operation_id`

- **Expected** if `snapshot_backend` is `git-worktree` or null — Git fallback or no jj repo in `workspacePath`.
- **Check:** is `jj` on `PATH` for the process (GUI apps on macOS often need Homebrew paths; Overlord prepends common bin dirs for install/checkpoint helpers)?
- **Check:** did the protocol **`snapshot`** block omit JJ fields?

### Wrong or empty diff / stats

- Confirm **`workspacePath`** in `snapshot` matches the directory where edits and `jj util snapshot` ran.
- Take a snapshot **after** meaningful edits and before recording rationales.

## Code map

| Area | Location |
| ---- | -------- |
| Initialize jj in project folder | `lib/snapshot/install-local-version-control.ts` |
| Local checkpoint (jj + Git fallback) | `lib/snapshot/local-checkpoint.ts` |
| Public exports | `lib/snapshot/index.ts` |
| Protocol context header | `apps/web/app/api/protocol/context/[ticketId]/route.ts` (`X-Local-Version-Control`) |
| Desktop launch + `OVERLORD_SNAPSHOT_JSON` | `apps/desktop/electron/services/agent-launcher.ts` |
| Rationale inserts (app) | `lib/overlord/file-changes.ts` |
| Rationale inserts (MCP) | `supabase/functions/mcp/handlers/_change-rationales.ts` |
| Snapshot validation | `lib/overlord/validation.ts` |
| Tests | `tests/lib/snapshot/local-version-control.test.ts` |

## References (external)

- JJ operation log: [https://docs.jj-vcs.dev/latest/operation-log/](https://docs.jj-vcs.dev/latest/operation-log/)
- JJ Git compatibility: [https://docs.jj-vcs.dev/latest/git-compatibility/](https://docs.jj-vcs.dev/latest/git-compatibility/)
- JJ working copy / workspaces: [https://docs.jj-vcs.dev/latest/working-copy/](https://docs.jj-vcs.dev/latest/working-copy/)
