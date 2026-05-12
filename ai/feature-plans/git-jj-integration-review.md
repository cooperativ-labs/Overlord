# Review: Git + Jujutsu Integration

Critical read of how Overlord currently implements the git/jj checkpoint
model that the plan in
`ai/feature-plans/local-jj-versioning-and-delivery-checkpoints.md` set out
to build. Goal: keep the software simple.

## TL;DR

- The "single shared local checkpoint helper" the plan promised has
  shipped as **two parallel implementations** — `lib/snapshot/local-checkpoint.ts`
  (TypeScript, used nowhere) and the inlined `createLocalDeliveryCheckpoint`
  in `packages/overlord-cli/bin/_cli/protocol.mjs`. Anywhere the CLI
  actually runs delivery, it does not import `lib/snapshot`.
- The deliver flow is **triplicated**: Next.js route, Supabase Edge MCP
  handler, and the CLI's own validation/checkpoint logic. Schema drift is
  already visible.
- The validation schema still accepts the **legacy shadow-workspace
  fields** (`backend: 'git-worktree'`, `shadowRepoPath`, `baseGitCommitId`,
  `baseJjCommitId`) that the plan said go away. No production code path
  produces them anymore; tests still do.
- JJ is dragged into a lot of places (CLI, Electron, web routes, MCP
  handler, workspace client, settings UI, two DB tables, validation
  schema) for **almost zero realised user value** — restore is deferred,
  Current Changes already works through git, and the only thing JJ
  uniquely buys today (auto-snapshot of untracked files) can be solved
  with a git stash or a hidden `refs/overlord/checkpoints/...` ref.
- Recommendation: **rip JJ out for now.** Replace with a tiny
  git-checkpoint helper, delete `lib/snapshot/install-local-version-control.ts`,
  the settings toggle, the `local_version_control` columns, the JJ branch
  in `LocalWorkspaceClient`, and the JJ branch of `createLocalDeliveryCheckpoint`.
  Re-add JJ only when a concrete user-facing restore feature requires it.

The rest of this document lists the specific issues that led to that
conclusion.

## 1. Duplicated checkpoint logic

`lib/snapshot/local-checkpoint.ts` (153 lines) and
`packages/overlord-cli/bin/_cli/protocol.mjs::createLocalDeliveryCheckpoint`
(~115 lines) implement the *same* JJ command sequence, the *same* Git
fallback, the *same* output shape — independently.

Cause: the CLI is shipped as a plain `.mjs` bundle and can't import
TypeScript from `lib/snapshot` without a bundling step.

Consequences:

- Bug fixes have to be made in two places.
- The two helpers have already drifted: the CLI helper supports
  `OVERLORD_WORKSPACE_PATH` env-var fallback for `workspacePath`; the TS
  helper does not. Neither offers a runner for tests, while the TS one
  does — but no production caller uses it.
- The TS helper's `runner` injection is dead surface area until something
  in the web app or Electron actually calls it. Today nothing does.

Fix: pick one. Either compile `lib/snapshot/local-checkpoint.ts` into
the CLI bundle (esbuild step that already exists for the CLI), or drop
the TS file and keep the JS one as the canonical helper, exposed to
Electron via IPC if/when Electron-side delivery ever needs it.

## 2. Triplicated deliver handlers

`POST /api/protocol/deliver`
(`apps/web/app/api/protocol/deliver/route.ts`) and the Supabase Edge MCP
handler (`supabase/functions/mcp/handlers/deliver.ts`) both:

- Insert a `ticket_events` row
- Insert a `project_checkpoints` row from `snapshot`/`checkpoint`
- Call `insertFileChanges` (or its Deno mirror)
- Map exactly the same fields (`snapshot?.gitCommitId ?? snapshot?.baseGitCommitId ?? null`)

Plus the CLI does its own pre-flight checks
(`validateDeliverFileChanges`, `createLocalDeliveryCheckpoint`).

This is three places that have to be kept in lockstep for a single
"deliver" semantic. The Edge function will not auto-redeploy when the
Next route changes; the CLI bundle ships out of band from both.

Fix: keep one server-side implementation. The MCP edge function should
either be removed or should call the Next.js route over HTTP instead of
re-implementing the SQL.

## 3. Schema still carries the dead shadow-workspace shape

`lib/overlord/validation.ts::snapshotContextSchema` accepts:

- `backend: 'git-worktree' | 'jj' | 'git'`
- `shadowRepoPath`
- `baseGitCommitId`
- `baseJjCommitId`

Nothing in `apps/desktop/electron/services/agent-launcher.ts` or the CLI
emits these anymore. The deliver route still consults `baseGitCommitId`
defensively (`snapshot?.gitCommitId ?? snapshot?.baseGitCommitId ?? null`).
Only `tests/protocol-deliver.test.mjs` exercises them.

Fix: drop the legacy fields from the Zod schema, drop the fallback in
both deliver implementations, delete the matching test fixtures. The
public MCP tool schema in `supabase/functions/mcp/tools.ts` lists the
same enum and should be tightened to `'jj' | 'git'`.

## 4. `installLocalVersionControl` mode parameter is decorative

- `lib/snapshot/install-local-version-control.ts`:
  `if (input.mode !== 'jj') return { ok: false, error: 'Only JJ … supported.' }`
- `apps/desktop/electron/ipc/filesystem.ts` calls it with
  `mode: 'jj'` hard-coded.
- `apps/web/components/modals/project-settings/WorkflowPage.tsx:339`
  passes `mode: 'local'` into the IPC. The IPC ignores it. The renderer
  passes a value that's neither in the helper's union nor in any type.

This is two bugs hiding each other: (a) the renderer is sending the
wrong literal; (b) the IPC discards the renderer's input. If anyone ever
adds a second mode, the renderer code will silently keep sending the
wrong value.

Fix: collapse `mode` to a constant in the helper signature for now (it
is a Boolean question: "install JJ here?"). Remove it from the IPC and
the renderer. Add the mode back only when there's a real second backend.

## 5. JJ init tries four command variants in a row

```ts
const initAttempts = hasGit
  ? [['git', 'init', '--colocate'], ['git', 'init', directory, '--colocate']]
  : [
      ['git', 'init', '--colocate'],
      ['git', 'init', directory, '--colocate'],
      ['init', '--git'],
      ['init', directory, '--git']
    ];
```

The plan flagged JJ CLI variance, but the response is to brute-force the
flag combinations until one works. That:

- Hides which CLI version the user actually has.
- Will succeed silently with subtly different repo shapes (colocated vs
  non-colocated).
- Will mask environment problems (e.g. the directory isn't a Git repo
  but the user picked "colocate").

Fix: read `jj version`, branch on it, choose the right command once. If
the version is unsupported, fail with an actionable error rather than
trying alternatives.

## 6. Inconsistent checkpoint creation across protocol verbs

| Verb                       | Accepts `snapshot` | Writes `project_checkpoints` |
|----------------------------|--------------------|------------------------------|
| `deliver`                  | yes                | yes                          |
| `update`                   | yes                | **no**                       |
| `record-change-rationales` | yes                | **no**                       |

`file_changes` written via `update` or `record-change-rationales` carry
denormalized `jj_*` columns and `snapshot_backend`, but their
`checkpoint_id` is always `NULL`. The plan was for checkpoint rows to be
the canonical anchor; instead they're the canonical anchor only for
delivery, and an orphan column the rest of the time.

Fix: either always create a checkpoint when `snapshot.backend` is
present (regardless of verb), or stop accepting `snapshot` outside
`deliver`. The current middle ground gives you the storage cost without
the queryability benefit.

## 7. Denormalized JJ columns on `file_changes` duplicate the checkpoint

`file_changes` has `jj_change_id`, `jj_commit_id`, `jj_operation_id`,
`snapshot_backend`, `workspace_name`, `workspace_path` — and now also
`checkpoint_id`. `project_checkpoints` has the same fields again. The
UI (`current-changes/DiffPane.tsx`) already prefers checkpoint values
over file-change values:

```ts
const backend = file.checkpoint?.backend ?? file.snapshot_backend;
const jjChangeId = file.checkpoint?.jj_change_id ?? file.jj_change_id;
```

So the denormalized columns exist for "fast reads" but the read path is
already paying for the checkpoint join. They are mostly drift bait.

Fix: drop the JJ columns from `file_changes` and read through
`checkpoint_id`. If you want denormalization for kanban perf, do it via
a materialized view, not a duplicated row.

## 8. CLI deliver validation is git-only

`packages/overlord-cli/bin/_cli/protocol.mjs::validateDeliverFileChanges`
runs `git status --porcelain` to check that every changed file is
covered by a rationale. In a JJ-only repo (the supposed happy path for
"non-git folders with JJ enabled") this returns `null` and silently
skips validation.

Fix: parametrise on the detected backend, or — simpler — only run the
validation when a git repo is present and treat the JJ check as nice to
have.

## 9. `workspace_path` is an absolute local path in the hosted DB

`project_checkpoints.workspace_path` and `file_changes.workspace_path`
get the absolute filesystem path of the user's working tree (e.g.
`/Users/jake/Development/Cooperativ/Overlord`). That:

- Leaks usernames / OS into a row that's visible to every org member
  with project access.
- Becomes wrong when the user moves the folder; the row stays.

This was an open question in the plan and got resolved by accident in
the "store everything" direction.

Fix: drop `workspace_path` from server storage, or replace it with a
short workspace label. The original directory already lives in
`project_user.local_working_directory` per-user.

## 10. Redundant JJ probing in `LocalWorkspaceClient`

`isJjWorkspace` is called from `getGitStatus`, `getGitDiff`,
`getAggregateDiff`, `getGitBranches` independently. Each call spawns
`jj --repository <dir> root`. For plain Git repos that's one process
exec per read. Current Changes makes many reads.

Fix: detect once per `LocalWorkspaceClient` instance and cache (the
backend doesn't change at runtime).

## 11. `parseJjStatus` is fragile

```ts
.filter(line => /^[A-Z?] /.test(line))
```

JJ status output is not stable across versions — it prefixes lines with
single-character status codes, but it also has header lines, working-copy
description, conflict markers, and bookmark info. The plan even calls
out JJ CLI variance. This parser will skip files in newer JJ versions
and is silent when it does.

Fix: use `jj diff --summary` or `jj log -r @ -T 'commit_id' --no-graph`
combined with `jj diff --name-only` (or whatever the current stable
machine output is), and pin a JJ version in the install helper so output
shapes are known.

## 12. Method names still say "Git"

`LocalWorkspaceClient.getGitStatus`, `getGitDiff`, `getGitBranches` —
all of them now have a JJ branch. The plan said "keep Git names as
wrappers, migrate later." That migration hasn't happened, and the JJ
implementations are wedged into git-named methods that consumers reason
about as "Git" methods. New contributors will not realise reading
"getGitStatus" can spawn `jj`.

Fix: at minimum, rename the methods or wrap them behind
`getWorkingTreeStatus` etc. as the plan suggested.

## 13. The "Install version control" UI confirmation is anaemic

```ts
window.confirm(
  'Initialize Jujutsu (jj) in this folder?\n\nOverlord will run jj …'
)
```

This is a `window.confirm`. The plan was a confirmation dialog because
`jj init --colocate` writes `.jj` and `.git` to a user folder. Users who
get a generic browser prompt will not understand the blast radius.

Fix: use the existing modal system. Show what will happen, the path,
and the JJ version. This is a low-cost change once you've decided JJ
stays.

## Should we be using JJ at all?

The intended user model is git. JJ is described as "optionally overlaid
to manage AI checkpoints." Concrete benefits today:

| Claim                                           | Reality                                                        |
|-------------------------------------------------|----------------------------------------------------------------|
| Revertable per-objective checkpoints            | No restore UX shipped; deferred indefinitely in the plan.      |
| Snapshot untracked files automatically          | True. But achievable with `git stash -u` or a hidden ref.      |
| Independent from user's git workflow            | Colocate mode writes `.git` *and* `.jj`. Not independent.      |
| Same workspace inspection as git                | Implemented, but via fragile string parsing of `jj status`.    |
| Provenance fields on file-change rows           | Stored, but never rendered as anything actionable.             |

What it actually costs:

- ~115 lines in CLI checkpoint logic + ~150 in TS helper (duplicated).
- ~150 lines of JJ branches in `LocalWorkspaceClient`.
- Electron install IPC + helper + tests.
- Settings UI page.
- 6 new columns on `project_user`, a `project_checkpoints` table, and 6
  denormalized columns on `file_changes`.
- A second-class shadow path (mode mismatches, parser fragility) that's
  rarely exercised because the dogfood project is a git repo.

If restore is the prize, and restore is not shipping, the JJ branch is
all sunk cost.

Two pragmatic alternatives:

1. **Drop JJ entirely until restore ships.** Use `git stash create` or
   `git commit-tree` writing to `refs/overlord/checkpoints/<sessionId>`
   (a hidden ref invisible to user's branches/log). One backend, one
   parser, one install. When restore eventually ships you can pick
   between `git read-tree --reset` from that ref or move to JJ then.

2. **Keep JJ but quarantine it.** Make JJ a CLI-only feature behind a
   feature flag for power users, with no web/API/Electron surface
   beyond the optional install. Don't mix JJ ids into the cross-org DB
   schema; keep them in the local CLI manifest until restore is a
   product, not a plan.

I'd go with option 1. It removes ~700 lines of code and an entire
schema migration trail with negligible product loss.

## Short-list of cleanups, ranked

1. Decide JJ in/out. If out: do this first, the rest cascades.
2. Collapse the two checkpoint helpers into one (option 1 makes this
   "delete the JJ branch").
3. Decide on a single deliver implementation — Next route *or* MCP
   edge handler, not both.
4. Remove the legacy `git-worktree` / `shadowRepoPath` /
   `baseGitCommitId` / `baseJjCommitId` schema fields.
5. Stop writing absolute `workspace_path` into shared DB tables.
6. Drop denormalized `jj_*` / `snapshot_backend` / `workspace_*`
   columns from `file_changes`; rely on `checkpoint_id`.
7. Fix the `mode: 'local'` → IPC `mode: 'jj'` mismatch (or delete the
   parameter).
8. Cache backend detection in `LocalWorkspaceClient`.
9. Rename `getGitStatus`/`getGitDiff` to backend-neutral names — the
   plan called for it; the rename never landed.
