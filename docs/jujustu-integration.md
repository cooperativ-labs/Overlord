# Jujutsu (jj) integration and change-tracking

This document explains how Overlord uses **Jujutsu** (`jj`) for local versioning, delivery checkpoints, and **change-tracking** (`file_changes` in the database). It is written so an agent can **diagnose and explain** change-tracking issues to a user without guessing.

For product-level research, tradeoffs, and future modes (colocation, user-native jj repos, and so on), see [`ai/feature-plans/jj-integration-research.md`](../ai/feature-plans/jj-integration-research.md).

## What problem jj solves here

Overlord needs **durable, inspectable file state** per agent session: where work happened, what revision represents a checkpoint, and stable anchors to attach **file-change rationales** to. For plain local folders, users can opt in from Desktop with **Install version control in this folder**; Overlord initializes JJ in the original project folder and Current Changes reads that same folder. JJ provides:

- **Shadow Git-backed repos** (`jj git clone --no-colocate`) so agent work stays out of the user’s project tree by default.
- **Per-session workspaces** (`jj workspace add`) so parallel sessions do not share a single working tree.
- **`change_id`** (logical line of work) and **`commit_id`** (immutable tree snapshot) after `jj util snapshot`.
- **`operation_id`** from the operation log for **whole-repo timeline** evidence (useful for support and forensics).

Git remains the interchange format users expect; JJ is the **local checkpoint engine** when the `jj` binary is available and healthy. The hosted API only stores checkpoint metadata; JJ/Git commands run in Electron or the local CLI.

## How Overlord selects jj vs Git worktrees

Implementation: `createSnapshotBackend` in `lib/snapshot/backend.ts`.

1. Unless callers **force** `prefer: 'git-worktree'`, Overlord constructs `JjCliSnapshotBackend` and runs a **`jj version`** health check.
2. If that succeeds, **jj is used**.
3. Otherwise Overlord falls back to **`GitWorktreeSnapshotBackend`** (plain `git worktree`), which **does not** produce `jj_change_id` / `jj_operation_id`.

**User-visible implication:** missing or broken `jj` is not fatal; change-tracking still works, but **JJ-specific columns** on `file_changes` may stay empty and anchors are weaker.

## Where data lives on disk

Managed storage is rooted with `resolveManagedSnapshotBaseDirectory` (`lib/snapshot/root.ts`):

| OS      | Base directory |
| ------- | -------------- |
| macOS   | `~/Library/Application Support/Overlord` |
| Linux   | `~/.local/share/overlord` |
| Windows | `%LOCALAPPDATA%\Overlord` (or `~/AppData/Local/Overlord`) |

Per project (`projectId` UUID), paths are built in `lib/snapshot/paths.ts`:

```text
{base}/projects/{projectId}/jj/
  repo/                          # shadow jj repo (git backend, non-colocated clone)
  workspaces/
    ovld-{projectShort}-{ticketSeq}-{sessionShort}   # optional: -retry-2, -retry-3, ...
```

- **`projectShort` / `sessionShort`**: first 8 alphanumeric characters of the respective IDs (lowercased), for filesystem safety.
- **Workspace directory names** always start with `ovld-` (`isManagedWorkspaceName`).

The user’s real project clone is only referenced as **source** for `jj git clone` (or remote URL when used); agent **writes** target the workspace under Overlord-managed storage, not the user’s `local_working_directory` (for Electron-managed launches described below).

## Lifecycle: prepare project, workspace, snapshot

All of this is implemented on `JjCliSnapshotBackend` (`lib/snapshot/backend.ts`).

### 1. `prepareProject`

- Ensures `{snapshotRoot}` exists.
- If `{shadowRepoPath}` is missing, runs  
  `jj git clone --no-colocate <source> <shadowRepoPath>`  
  where `<source>` is either a **remote URL** or a **local Git repo path** (must contain `.git`).
- Returns binding metadata: `shadowRepoPath`, `snapshotRoot`, `gitRemoteUrl`, `jjVersion`, etc.

**Failure modes:**

- **Not a Git repo** at `sourceDirectory` → prepare throws (jj backend requires Git source or remote).
- **Clone errors** (network, permissions, disk) → same; Electron context falls back to the user’s directory without a managed workspace (see protocol section).

### 2. `createWorkspace`

- Runs `jj --repository <shadowRepoPath> workspace add <workspacePath>` (from `snapshotRoot` as cwd).
- Optionally runs `jj --repository <workspacePath> edit <baseCommitId>` when a base JJ or Git commit id is supplied (retries / restore-from-checkpoint flows).

Returns `workspaceName`, `workspacePath`, base commit fields, and copies of project binding fields.

### 3. `snapshot` (checkpoint)

For JJ, one snapshot does:

1. `jj --repository <workspacePath> util snapshot`
2. `jj log -r @ -T 'change_id ++ " " ++ commit_id'`
3. `jj op log --at-op=@ --ignore-working-copy -n 1 -T id`
4. `jj diff --stat`

The returned `CheckpointRef` carries:

- **`commitId`** — JJ commit id (immutable snapshot of the tree).
- **`operationId`** — latest operation id (repo-wide timeline).
- **`summary`** — populated with the **change id** from the log template (implementation detail: field name is `summary` on the ref).

These values are what agents should pass through to **`snapshot`** on protocol/MCP calls when recording rationales (see below).

### 4. `exportAccepted` / `cleanupWorkspace`

- **Export:** sets a managed bookmark `ovld/{sanitized-ticket}/{sanitized-attempt}`, runs `jj git export`, optionally `jj git push` with `--bookmark`.
- **Cleanup:** `jj workspace forget <name>` then deletes the workspace directory.

**Bookmark naming** matches `buildManagedBookmarkName` — segments are sanitized, lowercase, hyphenated, max 64 chars per segment.

## When Electron uses a managed workspace

Managed snapshot workspaces are created **on the user’s machine** in `apps/desktop/electron/services/agent-launcher.ts` after the context markdown is fetched. `prepareManagedSnapshotWorkspace` (`lib/snapshot/prepare-managed-workspace.ts`) runs `jj` / git-worktree commands against `local_working_directory` — not the web API host.

Preparation runs when **all** of the following hold:

- Launch is **not** remote SSH (`workspace=ssh` flow)
- The web app passed a **`projectId`** into `terminal:launch-agent` (project-scoped ticket)
- **`cwd`** is set to the project’s local working directory
- The ticket resolves to a human-readable id (`{org}:{sequence}`) so `ticketSequence` is known (see `lib/overlord/human-ticket-id.ts`)

If preparation **throws**, the launcher logs a warning and **falls back** to `cwd` / `X-Working-Directory` from the context response so the agent still opens.

**Agent guidance for “wrong directory” complaints:** verify `local_working_directory` in project settings and Desktop Files & Folders access; confirm the ticket has a human `ticket_id` before launch (UUID-only ids skip managed workspace creation).

## Change-tracking: database and protocol

### `file_changes` row model

Relevant columns (see `types/database.types.ts` and insert helpers in `lib/overlord/file-changes.ts` / `supabase/functions/mcp/handlers/_change-rationales.ts`):

| Column             | Meaning |
| ------------------ | ------- |
| `snapshot_backend` | `jj` or `git-worktree` (or null if not supplied). |
| `workspace_name`   | Managed workspace name (`ovld-…`). |
| `workspace_path`   | Absolute path to that workspace. |
| `jj_change_id`     | JJ change id (logical attempt line); stable across many rewrites. |
| `jj_commit_id`     | JJ commit id at time of recording. |
| `jj_operation_id`  | JJ operation id at time of recording. |

Semantic fields (`label`, `summary`, `why`, `impact`, `hunks`, …) are **Overlord-native**; JJ fields are **anchors** for provenance and debugging.

### How snapshot metadata gets attached

Protocol validation (`lib/overlord/validation.ts`) allows an optional **`snapshot`** object on:

- `update`
- `deliver`
- `record_change_rationales` (and MCP equivalents)

Shape (all fields optional except as noted):

- `backend`: `jj` | `git-worktree`
- `workspaceName`, `workspacePath`
- `jjChangeId`, `jjCommitId`, `jjOperationId`
- `shadowRepoPath`, `projectId`, `baseGitCommitId`, `baseJjCommitId`

When inserting rationales, **per-row** `jj_*` fields override; otherwise values **fall through** from `snapshot` (`insertChangeRationales` / `insertFileChanges`).

**Agent rule:** if you took a checkpoint with `JjCliSnapshotBackend.snapshot`, pass **`jjChangeId`** = change id from the log, **`jjCommitId`** = commit id, **`jjOperationId`** = operation id, plus **`workspacePath`** / **`workspaceName`** and **`backend: 'jj'`**. That keeps DB rows consistent with the real repo.

## Concept mapping (for user conversations)

Use **Overlord vocabulary** by default; use JJ terms only when explaining internals.

| User-facing term   | JJ / implementation |
| ------------------ | --------------------- |
| Managed workspace  | JJ workspace under `…/jj/workspaces/ovld-…` |
| Checkpoint         | `jj util snapshot` + captured ids |
| Attempt / lineage  | Often one **change** (`change_id`) per session |
| Snapshot id        | **`commit_id`** (immutable tree) |
| “What changed when”| Overlord events + optional **`operation_id`** |
| Export branch      | Bookmark under `ovld/…` → `jj git export` |

## Troubleshooting playbooks (for agents)

### 1. “File changes have no jj_change_id / jj_operation_id”

- **Expected** if **`snapshot_backend`** is `git-worktree` or null — fallback path or snapshot block omitted.
- **Check:** is `jj` installed and on `PATH` for the process running snapshot prep (Electron server / local dev)?
- **Check:** did protocol **`snapshot`** omit JJ fields on `deliver` / `update` / `record_change_rationales`?

**Explain to user:** change-tracking still records rationales; only VCS anchors are missing. Installing `jj` or fixing PATH restores richer provenance for **new** sessions.

### 2. “Agent edited files but Overlord shows wrong or empty diff / stats”

- Managed workspace may not have been used (preparation failed — see server logs).
- Session may be writing to **user repo** while rationales reference **workspace** paths — paths in `file_changes` should match files relative to the tree being snapshotted.
- For JJ, a **snapshot** must run **after** meaningful edits; relying on read-only commands without snapshot can drift from what `jj diff --stat` sees.

**Action:** rerun checkpoint (`util snapshot` + capture ids) before recording rationales; align `workspacePath` in `snapshot` with cwd.

### 3. “jj errors / clone failures”

Typical causes:

- Invalid or non-Git `local_working_directory`.
- Network or auth for remote clone (if ever used).
- Disk space or permissions under Application Support / `.local/share`.

**Explain to user:** Overlord falls back to their configured working directory; **their project is not corrupted** by jj clone failures. Fix Git path or environment; retry launch.

### 4. “Stale workspace / wrong base after retry”

Implementation supports **retry index** in workspace names (`-retry-2`, …) via `createRetry` / `createWorkspace` options.

**Explain:** a retry should use a **new workspace** or explicit **base** commit ids so JJ does not silently continue from the wrong parent.

### 5. “Don’t pollute jj operation log / snapshots”

Research doc stresses: many JJ commands touch the op log; use  
`jj op log --at-op=@ --ignore-working-copy` for **read-only** inspection. Overlord’s snapshot flow already uses `--ignore-working-copy` for the operation-id read.

**Agent tip:** avoid hammering `jj status` in tight loops from automation; batch work and snapshot at **semantic** boundaries (after tool batches, before deliver).

## Security and isolation (summary)

- JJ child processes get **sanitized env**: `JJ_CONFIG`, `JJ_CONFIG_DIR`, `JJ_DATA_DIR` stripped; `NO_COLOR=1`.
- Git subprocesses for worktrees use `GIT_CONFIG_GLOBAL` nulled to reduce host bleeding.
- Commands use explicit `--repository` / `-C` paths; agents should **not** run arbitrary jj in the user’s home repo for managed sessions.

## Code map

| Area | Location |
| ---- | -------- |
| JJ + Git backends | `lib/snapshot/backend.ts` |
| Backend selection | `createSnapshotBackend` in same file |
| Paths / names | `lib/snapshot/paths.ts`, `lib/snapshot/root.ts` |
| Snapshot types | `lib/snapshot/types.ts` |
| Protocol workspace prep | `apps/web/app/api/protocol/context/[ticketId]/route.ts` |
| Rationale inserts (app) | `lib/overlord/file-changes.ts` |
| Rationale inserts (MCP) | `supabase/functions/mcp/handlers/_change-rationales.ts` |
| Snapshot validation | `lib/overlord/validation.ts` (`snapshotContextSchema`) |
| Tests | `tests/lib/snapshot/backend.test.ts`, `paths.test.ts`, `root.test.ts` |

## References (external)

- JJ operation log: [https://docs.jj-vcs.dev/latest/operation-log/](https://docs.jj-vcs.dev/latest/operation-log/)
- JJ Git compatibility: [https://docs.jj-vcs.dev/latest/git-compatibility/](https://docs.jj-vcs.dev/latest/git-compatibility/)
- JJ working copy / workspaces: [https://docs.jj-vcs.dev/latest/working-copy/](https://docs.jj-vcs.dev/latest/working-copy/)
