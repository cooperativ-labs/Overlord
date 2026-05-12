# Per-Objective Git Checkpoints — Simplest Path

Follow-up to `git-jj-integration-review.md`. Translates the four product
goals into the smallest implementation that meets them.

## Goals (recap)

1. Per-objective revertable checkpoints.
2. `current-changes/page.tsx` shows **all and only** uncommitted changes,
   each annotated with the file-change-rationales (and therefore the
   objectives) responsible for it.
3. Backed by **git** — every target user already has it.
4. Keep it simple.

## TL;DR

- Drop JJ. One backend.
- One checkpoint = one **hidden git ref**
  `refs/overlord/checkpoints/<objectiveId>` pointing at a tree+commit
  snapshot of the working copy taken at the moment the objective starts.
- Revert per objective = `git read-tree --reset -u <ref>` (with a
  confirm-and-safety-stash wrapper).
- Current Changes = `git status` ∪ join `file_changes` on `file_path`,
  grouped by `objective_id` from `ticket_events`.
- Trim the DB: drop `jj_*`, `snapshot_backend`, `workspace_*` from
  `file_changes`; trim `project_checkpoints` to the IDs that matter.
- Collapse three deliver paths to one (Next route); MCP edge calls it.

That's the whole feature. Everything below is detail.

## 1. The checkpoint primitive

Hidden refs are git's built-in answer to "I want to remember a tree
without putting it on a branch." They are not shown by `git log`,
`git branch`, or `git status`; they ARE protected from `git gc`, which
is what we want.

### Create (called when objective transitions to `executing`)

```sh
# stage everything in the working tree, including untracked
git add -A
TREE=$(git write-tree)
PARENT=$(git rev-parse HEAD)
SHA=$(git commit-tree "$TREE" -p "$PARENT" -m "overlord checkpoint <objectiveId>")
git update-ref refs/overlord/checkpoints/<objectiveId> "$SHA"
git reset                  # un-stage so we leave the index untouched
```

- Captures tracked + untracked + staged + unstaged.
- Does not modify the user's branch or HEAD.
- One shell helper; ~30 lines including error handling.
- Idempotent: if the ref already exists for that objective, skip.

### Restore

```sh
# safety net: stash whatever's currently uncommitted under another ref
git add -A
SAFETY=$(git commit-tree $(git write-tree) -p HEAD -m "overlord pre-revert safety")
git update-ref refs/overlord/safety/<timestamp> "$SAFETY"
git reset

# restore tree + index from the checkpoint, leaving HEAD where it is
git read-tree --reset -u refs/overlord/checkpoints/<objectiveId>
```

UI flow: show diff between current working tree and target checkpoint,
require explicit confirm, then run.

### Garbage collection

- Periodically prune `refs/overlord/checkpoints/*` for objectives whose
  ticket has been `complete` for > 30 days.
- Always prune `refs/overlord/safety/*` older than 7 days.
- Single nightly job in the desktop app or a manual "Clean checkpoints"
  button in project settings.

## 2. Where the helper lives

One file: `lib/snapshot/git-checkpoint.ts`. Esbuild already bundles the
CLI, so the same TS file ships into both the Next.js server and the CLI
bundle. Today the CLI inlines a separate copy in `protocol.mjs` — that
copy goes away.

Functions:

- `createCheckpoint({ workspacePath, objectiveId }) -> { sha, headSha, ref }`
- `restoreCheckpoint({ workspacePath, objectiveId, dryRun })`
- `listCheckpoints({ workspacePath })`
- `pruneCheckpoints({ workspacePath, keepPredicate })`

No mode parameter. No backend abstraction. If we ever re-add JJ it
lives behind a separate, opt-in helper — not woven through this one.

## 3. When does a checkpoint get taken?

Trigger on the **first agent activity for an objective**. Concretely:

- The Overlord server already knows when an event has an `objective_id`
  it hasn't seen before for this project.
- On `attach`, `update`, `record-change-rationales`, and `deliver`, the
  server response includes `pendingCheckpoints: string[]` (objective
  IDs needing a snapshot).
- The local CLI/agent runs `createCheckpoint` for each, then POSTs back
  the resulting sha so a `project_checkpoints` row is written.

That keeps the actual `git` invocation on the local machine (where the
working tree lives) without scattering checkpoint creation across every
verb. Server is the source of truth for "do we already have a
checkpoint for this objective?" via the unique `(project_id,
objective_id)` constraint.

## 4. Database

### `project_checkpoints` (trimmed)

```
id              uuid pk
project_id      uuid fk
objective_id    uuid fk           -- UNIQUE with project_id
ticket_id       uuid fk
session_id      uuid fk
git_ref         text              -- 'refs/overlord/checkpoints/<id>'
git_commit_sha  text              -- the snapshot commit
head_sha        text              -- HEAD at time of capture
created_at      timestamptz
```

Drop: `backend`, `jj_change_id`, `jj_commit_id`, `jj_operation_id`,
`workspace_name`, `workspace_path`, `git_worktree_path`.

### `file_changes` (trimmed)

Drop: `jj_change_id`, `jj_commit_id`, `jj_operation_id`,
`snapshot_backend`, `workspace_name`, `workspace_path`. Keep
`checkpoint_id` (already exists, FKs into the trimmed table).

### Validation schema (`lib/overlord/validation.ts`)

`snapshotContextSchema` becomes:

```ts
z.object({
  backend: z.literal('git'),     // or drop entirely
  gitCommitId: z.string(),
  headSha: z.string(),
  ref: z.string()                 // 'refs/overlord/checkpoints/<id>'
})
```

Drop `git-worktree`, `shadowRepoPath`, `baseGitCommitId`,
`baseJjCommitId`. Same change in `supabase/functions/mcp/tools.ts`.

## 5. Deliver path consolidation

`POST /api/protocol/deliver` becomes the single server implementation.

- Supabase MCP edge handler stops re-implementing the SQL; it calls the
  Next route over HTTPS using the existing service key.
- CLI keeps only the local pre-flight (rationale coverage check using
  `git status --porcelain`); checkpoint creation is the same shared
  helper.
- Same applies to `update` and `record-change-rationales` once they
  start participating in checkpoint creation.

## 6. The Current Changes page

### Data sources

1. **Local agent** (Electron / CLI bridge) provides the live working
   copy state via existing IPC:
   - `git status --porcelain=v2 -uall`
   - `git diff` (unstaged) and `git diff --cached` (staged) per file
2. **Hosted DB** provides rationales:
   ```sql
   select fc.*, te.objective_id, o.objective as objective_text
   from file_changes fc
   join ticket_events te on te.id = fc.event_id
   left join objectives o on o.id = te.objective_id
   where fc.project_id = $1
     and fc.file_path = any($2::text[])
   ```

### Render

For each path returned by `git status`:

- Show the diff (existing `DiffPane.tsx` work mostly stands).
- Show a collapsible **Rationales** section grouped by objective:
  - Objective heading (objective text + ticket ref).
  - Each rationale as a card: label, summary, why, impact, agent +
    timestamp.
- Show a **Revert this objective** button per objective group, gated
  on the existence of `project_checkpoints` for that objective. Button
  triggers the restore flow described in §1.

### "All and only uncommitted changes"

Drive the file list strictly from `git status` output. Do **not** pull
the file list from `file_changes`. Rationales for files that are no
longer uncommitted (because the user committed or reverted them) simply
do not appear on this page — they live in the ticket history.

## 7. JJ removal checklist

Delete:

- `lib/snapshot/install-local-version-control.ts`
- `lib/snapshot/local-checkpoint.ts` (replaced by `git-checkpoint.ts`)
- JJ branches in `apps/web/lib/workspace/local.ts`
  (`isJjWorkspace`, `parseJjStatus`, JJ branches of `getGitStatus`/
  `getGitDiff`)
- `installLocalVersionControl` IPC in
  `apps/desktop/electron/ipc/filesystem.ts`
- "Install version control" section of
  `apps/web/components/modals/project-settings/WorkflowPage.tsx`
- `project_user.local_version_control*` columns
- The `X-Local-Version-Control` header read path

Rename `getGitStatus`/`getGitDiff` → `getWorkingTreeStatus`/
`getWorkingTreeDiff` (or just leave the git names — they're now
accurate again).

## 8. Migration order

1. Land `lib/snapshot/git-checkpoint.ts`. CLI starts using it (no DB
   change yet).
2. Add `pendingCheckpoints` to server responses; CLI starts creating
   hidden refs and POSTing the sha back.
3. Add unique `(project_id, objective_id)` to `project_checkpoints`;
   start populating new columns alongside the old ones.
4. Wire the **Revert** button in `current-changes` (gated; behind a
   feature flag if you want to dogfood first).
5. Migration: drop denormalized `jj_*` / `workspace_*` columns from
   `file_changes` and `project_checkpoints`. Drop legacy fields from
   validation. Delete the JJ files and IPC.
6. Stop writing to the dropped columns at the same release.

Steps 1–4 are additive and reversible. Step 5 is the breaking change
and should be one PR with a single SQL migration.

## 9. What we are explicitly not doing

- Per-file revert. Per-objective is the contract; granularity below
  that re-introduces all the JJ-shaped complexity.
- Restoring across branch switches. If the user changes branches the
  checkpoint ref still points where it pointed; behaviour is "best
  effort" and the safety-stash protects them.
- Submodule / sparse-checkout / git-LFS edge cases. Document as
  out-of-scope; revert button can early-exit if it detects them.
- Storing diff content server-side. The diff is computed from local
  git on demand; only the sha + objective_id pairs go to the DB.

## 10. Why this is simpler than what we have

| Today | Proposed |
|-------|----------|
| 2 checkpoint helpers (TS + JS) | 1 |
| 3 deliver implementations | 1 (+ 1 thin proxy) |
| 2 backends (git, jj) + legacy git-worktree shape | 1 backend |
| 6 denormalized cols on `file_changes` + checkpoint_id | checkpoint_id only |
| Mode mismatch across renderer / IPC / helper | No mode |
| `parseJjStatus` regex | Plumbing-grade `git status --porcelain=v2` |
| Settings page to install JJ | Removed |
| Workspace path leaked into shared DB | Removed |

Estimated deletion: ~700–900 lines of code + one settings page + one
IPC call + six table columns. Estimated addition: one ~120-line shared
helper + one rationales-grouped section in the Current Changes page +
one migration.
