# JJ Integration Research

## Executive Recommendation

Jujutsu (`jj`) is a strong conceptual fit for Overlord's agent-history problem, but I would not make it the mandatory core state engine yet.

Recommended path:

1. Build a **shadow JJ integration** as an internal, opt-in snapshot and isolation backend.
2. Keep Git as the external contract: user repos, GitHub PRs, and accepted output remain normal Git.
3. Store Overlord metadata in Overlord's database, keyed to JJ `change_id`, `commit_id`, `operation_id`, workspace name, and Overlord checkpoint IDs.
4. Never mutate a user's existing `.jj` repository by default.
5. Treat JJ as replaceable infrastructure until the integration has survived real parallel-agent load, large repos, colocation edge cases, and existing-JJ-user workflows.

Why: JJ has unusually good primitives for AI-agent workflows: working-copy commits, mutable changes with stable change IDs, first-class operation history, workspaces, anonymous heads, first-class conflicts, revsets, and Git compatibility. Those map directly to "attempts", "checkpoints", "restore points", "parallel runs", "merge/reject", and "what happened when?" However, JJ is still pre-1.0, its CLI/docs surface is evolving, `jj-lib` is not an obvious stable application API yet, and colocated Git/JJ plus arbitrary Git tooling creates compatibility risk.

## Sources And Assumptions

Primary sources:

- JJ operation log docs: https://docs.jj-vcs.dev/latest/operation-log/
- JJ technical concurrency docs: https://docs.jj-vcs.dev/latest/technical/concurrency/
- JJ working copy docs: https://docs.jj-vcs.dev/latest/working-copy/
- JJ glossary: https://docs.jj-vcs.dev/latest/glossary/
- JJ Git compatibility docs: https://docs.jj-vcs.dev/latest/git-compatibility/
- JJ bookmarks docs: https://docs.jj-vcs.dev/latest/bookmarks/
- JJ conflicts docs: https://docs.jj-vcs.dev/latest/conflicts/
- JJ CLI reference: https://docs.jj-vcs.dev/latest/cli-reference/
- JJ technical architecture docs: https://docs.jj-vcs.dev/latest/technical/architecture/
- JJ Git comparison: https://docs.jj-vcs.dev/latest/git-comparison/
- JJ Sapling comparison: https://docs.jj-vcs.dev/latest/sapling-comparison/
- JJ GitHub repository / README: https://github.com/jj-vcs/jj

Local note: `jj` is not installed in this workspace, so command examples are based on the current official docs rather than local CLI verification.

## 1. Architectural Fit

JJ maps unusually well to Overlord because it already treats repository state as a mutable DAG plus an operation DAG.

### Parallel Coding Agents

JJ workspaces are the closest native primitive to "one isolated checkout per agent". A workspace has its own working copy and working-copy commit, while commits and operations live in the shared repository. The working-copy docs state that each workspace can have a different commit checked out and that `jj workspace add` creates another working copy backed by the same repo.

For Overlord:

- Agent session = one Overlord run record.
- Agent filesystem = one JJ workspace directory.
- Agent current state = that workspace's working-copy commit, usually `@` from inside that workspace.
- Agent attempt line = a JJ change, or a short stack of JJ changes if the agent intentionally separates work.

This is more natural than Git worktrees because JJ does not require every line of work to be anchored to a branch name. Anonymous heads are first-class visible state, not a "detached HEAD" footgun.

### Autonomous Agent Retries

JJ's "change" model is useful for retries. A change ID identifies a logical change as it evolves; rewriting the commit changes the commit ID but generally keeps the change ID. This maps to:

- Attempt identity: stable `change_id`.
- Attempt versions/checkpoints: evolving `commit_id`s under that change.
- User-facing label: Overlord attempt ID, not JJ hash.

If an agent retries after a failed tool call, Overlord can either:

- Continue the same JJ change and produce a new commit ID for the same logical attempt.
- Fork a new sibling change from a checkpoint and mark it as a retry branch in Overlord metadata.

The first model is compact; the second is easier to explain and compare in product UI.

### Speculative Execution

JJ is good at speculative execution because it does not require branch names for every speculative head. Visible anonymous heads are tracked by the view. That means Overlord can create dozens of agent attempts without creating dozens of user-visible Git branches.

Git can do this with worktrees plus ephemeral branches or detached HEAD commits, but preserving, comparing, naming, and garbage-collecting speculative histories becomes application logic. JJ already has a model for visible heads, mutable changes, and operation history.

### Agent Branching And Merging

JJ can represent merges with normal commits. More importantly, JJ can record conflicts in commits, so a merge/rebase operation can succeed even when file conflicts exist. The conflict is logical repository state, not just an interrupted command. This is a major product advantage for agents:

- Agent A and B can both finish.
- Overlord can produce a merge candidate even if it has conflicts.
- The UI can say "Attempt B conflicts with Attempt A in these files" without the repository being stuck halfway through a merge.
- Conflict resolution can become a later Overlord task.

Git's merge/rebase conflict states are process states in the working tree/index. They are much harder to store as durable agent artifacts without building a separate conflict-state model.

### Semantic Checkpoints

JJ automatically snapshots the working copy at the beginning of most commands. It also exposes `jj util snapshot` as a command in the CLI reference. A JJ operation stores a repo view, including bookmarks, tags, Git refs, visible heads, and working-copy commits per workspace.

This gives Overlord two checkpoint layers:

- **Commit checkpoint:** exact file tree at an agent point in time, keyed by commit ID.
- **Operation checkpoint:** whole repo view at an agent point in time, keyed by operation ID.

Overlord should still create explicit semantic checkpoint rows because JJ's automatic operations are too low-level. A tool call may produce multiple filesystem changes before the next JJ command. Overlord should call a controlled snapshot command after semantically meaningful events and store why that snapshot exists.

### Replayable Timelines

JJ's operation log is a strong substrate for "what happened?" It records every repo-mutating operation, with metadata and parent operation pointers. `jj op log` shows this history; `jj op restore` can restore an earlier repo state; `--at-op` can load the repo at a specific operation for read-only inspection. `jj evolog` shows how a change evolved over time.

For Overlord, this enables:

- "Show repository state before tool call 17."
- "Diff after the failed migration edit."
- "Restore this attempt to before the formatting command."
- "Show all versions of this attempt."

But JJ's op log is repository-mechanical. The product timeline should be Overlord's semantic event stream, with JJ operation IDs attached as low-level evidence.

### Is JJ Better Than Git Here?

Yes, for Overlord's internal state problem. Git is better as a public interchange format and user expectation. JJ is better as an internal mutable agent DAG because:

- Working copy is a commit.
- Dirty-worktree blockers mostly disappear.
- Changes have stable identities across rewrites.
- Operation log tracks whole-repo state, not per-ref reflogs.
- Anonymous branches are normal.
- Conflict states can be committed and manipulated.
- Workspaces are native.
- Automatic rebase of descendants matches patch-stack and agent-attempt workflows.

The caveat: JJ's strengths are also user-model differences. Users who think in Git branches may be confused if Overlord leaks JJ concepts.

## 2. Recommended Integration Architecture

### Default Repository Layout

Use shadow repos by default.

```text
<user-project>/
  .git/
  src/
  package.json

~/Library/Application Support/Overlord/projects/<project-id>/jj/
  repo/                         # shadow JJ repository root
  workspaces/
    session-<session-id>/
    session-<session-id>-retry-2/
  metadata/
    config.toml                 # Overlord-owned JJ config if needed
```

On Linux:

```text
~/.local/share/overlord/projects/<project-id>/jj/
```

On Windows:

```text
%LOCALAPPDATA%\Overlord\projects\<project-id>\jj\
```

The shadow JJ repo should be Git-backed but non-colocated unless a specific workflow requires `.git` in each agent workspace.

Initialization options:

```bash
# From a remote URL:
jj git clone --no-colocate <git-url> <shadow-root>/repo

# From an existing local Git repository:
jj git init --git-repo=<user-project>/.git <shadow-root>/repo
jj git import
```

The existing-Git-repo mode uses the user's Git object database as backing storage. Safer MVP is a true clone into Overlord storage because it avoids mutating or depending on the user's `.git` during active agent work.

### Colocated vs Shadow

Default: **shadow non-colocated**.

Use colocated only for agent workspaces where tools hard-require a `.git` directory at the workspace root. The Git compatibility docs say colocated workspaces share the Git and JJ working copy and automatically import/export on every JJ command. That is convenient, but it increases risk when Git commands, IDEs, background fetches, and JJ commands interleave.

Recommended modes:

| Mode | Description | Default | Use case |
| --- | --- | --- | --- |
| `shadow-clone` | Overlord clones Git into private JJ repo | Yes | safest for Git and JJ users |
| `shadow-linked-git` | JJ repo backed by user's `.git`, separate working copies | No | faster local storage, more coupling |
| `managed-colocated` | Overlord-owned workspace has `.git` and `.jj` siblings | No | tools require `.git` |
| `user-jj-native` | Overlord creates ovld workspaces inside user's JJ repo | No, advanced | user explicitly wants shared JJ graph |

### Per-Agent Workspaces

Each agent gets one workspace:

```bash
jj --repository <shadow-root>/repo workspace add <shadow-root>/workspaces/session-<session-id>
```

Inside that workspace:

```bash
jj new <base-rev>
jj describe -m "ovld: ticket 1:973 session <session-id>"
```

Base revision selection:

- Git users: `trunk()` after `jj git fetch`, or the Git commit selected by the user.
- Existing PR: target branch remote bookmark plus current PR head imported into shadow repo.
- Retry: prior Overlord checkpoint's `commit_id`.
- Merge attempt: `jj new <attempt-a-commit> <attempt-b-commit>`.

Workspace naming:

```text
ovld-<project-short>-<ticket-seq>-<session-short>
```

Keep filesystem path and JJ workspace name distinct but related:

```text
path: ~/.../workspaces/1-973-389dc3e6
workspace_name: ovld-1-973-389dc3e6
```

### One Session = One Change?

Use this as the default mental model, but not as a hard invariant.

Default:

- One agent run creates one primary JJ change.
- The working-copy commit for that workspace is the latest version of the attempt.
- Overlord checkpoints store the `commit_id` versions of that same change.

Exceptions:

- Agent explicitly produces separable commits: allow a short stack, but group it under one Overlord attempt.
- Agent merge/resolution tasks: create a merge change with multiple parents.
- Retry from checkpoint: create a new sibling change so comparison is easy.

### Metadata Mapping

JJ should store source snapshots and low-level state. Overlord stores product semantics.

```ts
type JjRepositoryBinding = {
  id: string;
  project_id: string;
  mode: 'shadow-clone' | 'shadow-linked-git' | 'managed-colocated' | 'user-jj-native';
  user_project_path: string;
  shadow_repo_path: string;
  git_remote_url: string | null;
  git_default_remote: string | null;
  git_default_bookmark: string | null;
  jj_version: string;
  created_at: string;
  last_health_check_at: string | null;
};

type AgentWorkspaceBinding = {
  id: string;
  project_id: string;
  ticket_id: string;
  session_id: string;
  jj_repo_binding_id: string;
  workspace_name: string;
  workspace_path: string;
  base_git_commit_id: string;
  base_jj_commit_id: string;
  primary_change_id: string | null;
  latest_commit_id: string | null;
  latest_operation_id: string | null;
  state: 'active' | 'paused' | 'accepted' | 'rejected' | 'forgotten' | 'gc_pending';
};

type AgentCheckpoint = {
  id: string;
  ticket_id: string;
  session_id: string;
  tool_call_id: string | null;
  event_id: string;
  label: string;
  reason: 'before_tool' | 'after_tool' | 'agent_message' | 'test_passed' | 'manual' | 'acceptance_candidate';
  jj_change_id: string;
  jj_commit_id: string;
  jj_operation_id: string;
  parent_checkpoint_id: string | null;
  files_changed: string[];
  diff_summary: string | null;
  created_at: string;
};

type FileChangeProvenance = {
  id: string;
  file_change_id: string;
  checkpoint_id: string;
  jj_change_id: string;
  jj_commit_id: string;
  introduced_by_tool_call_id: string | null;
  last_touched_by_tool_call_id: string | null;
  rationale: {
    summary: string;
    why: string;
    impact: string;
  };
};
```

Important mapping rules:

- `change_id` is the logical attempt identity.
- `commit_id` is the immutable file snapshot identity.
- `operation_id` is the whole-repo timeline identity.
- Overlord event ID is the product timeline identity.
- File-change rationales attach to Overlord events/checkpoints, not directly to JJ only.

### Syncing With Git

Shadow repo import:

```bash
jj git fetch --remote origin
jj git import
```

In non-colocated mode, `jj git import` updates JJ from the underlying Git repo and `jj git export` updates the Git repo from JJ. In colocated mode, docs say import/export happen automatically on each JJ command.

Accepted result export:

```bash
# Create/move an Overlord-owned bookmark.
jj bookmark set ovld/1-973/<attempt-id> -r <accepted-commit-id>

# Export to backing Git repo if non-colocated.
jj git export

# Push only Overlord-owned bookmark.
jj git push --bookmark ovld/1-973/<attempt-id> --remote origin
```

For GitHub PRs, Overlord should still use normal GitHub APIs/CLI after pushing an `ovld/...` branch. Users do not need to know JJ existed.

### Importing Existing User Work

Git user:

```bash
git -C <user-project> rev-parse HEAD
git -C <user-project> status --porcelain=v1
jj git fetch --remote origin
```

If user has uncommitted Git changes, do not silently ingest them into a shadow agent run unless the user explicitly selected "include current working tree". For inclusion:

1. Copy project files into a temporary import workspace.
2. Snapshot with JJ.
3. Store checkpoint reason `user_uncommitted_import`.

JJ user:

Do not use the user's `.jj` by default. Export from their repo through Git-visible commits/bookmarks or a patch:

```bash
jj git export
git -C <user-project> rev-parse HEAD
```

If using advanced `user-jj-native` mode, create only Overlord-owned workspaces and bookmarks.

### Isolation Guarantees

Overlord should guarantee:

- Agent file writes happen only inside that agent's workspace path.
- Agent JJ commands run with `--repository <workspace-path-or-repo>` or cwd set to the agent workspace.
- Agents never run JJ commands in the user's project root in shadow modes.
- Overlord-created bookmarks are under `ovld/`.
- Overlord never moves `main`, `master`, `trunk`, user feature bookmarks, or remote-tracking state except through explicit fetch/import.
- Accepted work exports only the selected commit(s).

### Cleanup And Garbage Collection

Session completion:

```bash
jj --repository <workspace-path> workspace forget <workspace-name>
```

Then remove workspace files from disk using Overlord's filesystem cleanup layer. Do not delete a workspace before preserving:

- final commit ID,
- final operation ID,
- diff,
- file-change rationales,
- transcript/tool timeline,
- exported patch or Git branch if accepted.

Periodic cleanup:

```bash
jj op abandon ..<old-operation-id>
jj util gc
```

Use carefully. `jj operation abandon` can discard operation history and previous versions if unreachable. For Overlord, operation history is product evidence, so retention should be policy-driven:

- Keep active ticket operations indefinitely.
- Keep delivered ticket operations for a retention window, e.g. 30-90 days.
- Keep accepted commit snapshots until PR merge or user deletion.
- Keep Overlord database metadata even after JJ GC, but mark snapshot material unavailable if pruned.

### Operation-Log Usage

Use operation IDs for low-level recovery and forensic inspection:

```bash
jj op log --at-op=@ --ignore-working-copy
jj op show <operation-id>
jj --at-op=<operation-id> diff -r <change-id-or-commit-id>
jj op restore <operation-id>
jj op revert <operation-id>
```

Use `--at-op=@ --ignore-working-copy` for read-only polling to avoid creating extra snapshots. The CLI reference explicitly notes `jj op log` otherwise snapshots and reconciles operations.

### Recovery And Rollback Flows

Restore one agent attempt to a checkpoint:

```bash
jj --repository <workspace-path> edit <checkpoint-commit-id>
jj new <checkpoint-commit-id>
```

Prefer creating a new attempt from the checkpoint over mutating the old attempt in place. Product UI can label it "Retry from checkpoint".

Restore entire shadow repo view:

```bash
jj --repository <shadow-root>/repo op restore <operation-id>
```

This should be an admin/diagnostic action, not a normal user action, because it affects repo-wide view state including workspaces and bookmarks.

Undo latest Overlord operation:

```bash
jj undo
```

Only safe when Overlord knows the latest operation belongs to the same session and workspace. In multi-agent mode, prefer operation-specific `jj op revert <operation-id>` or new derived changes.

## 3. Existing JJ User Compatibility

This is the critical product risk.

### What Can Go Wrong If Overlord Mutates The Same `.jj`

Workspace collisions:

- Overlord workspace names can conflict with user workspaces.
- Forgetting a workspace could accidentally target the wrong workspace if names are not namespaced and validated.

Operation-log pollution:

- Every Overlord snapshot, describe, rebase, bookmark move, merge, and cleanup adds operations to the user's op log.
- The user's `jj op log` becomes full of agent machinery.

Concurrent operation issues:

- JJ is designed for lock-free concurrent operations, but concurrent writes can still create divergent changes/bookmark conflicts that users must understand.
- If Overlord rewrites a change the user is editing, the user's workspace can become stale.

Bookmark conflicts:

- JJ bookmarks map to Git branches.
- If Overlord moves user bookmarks or uses normal names like `feature/foo`, it can create user-visible conflicts and push surprises.

User confusion:

- Agent changes appear as anonymous heads.
- Hidden/rewritten commits appear in evolog.
- Divergent change IDs may show up if Overlord and user rewrite the same change.

Graph pollution:

- Agent attempts, retries, abandoned attempts, and merge experiments can clutter `jj log`.

Colocated Git interactions:

- In colocated workspaces, `jj` imports/exports Git refs automatically.
- Mutating Git commands from IDEs/background tools can interleave with Overlord's JJ commands.
- JJ docs explicitly warn that interleaving Git and JJ in colocated workspaces can cause confusing branch/bookmark conflicts, slow imports in repos with many refs, and bugs around branch pointers.

### Should Overlord Use The User's Existing JJ Repo?

Default answer: **No.**

Overlord should create a shadow JJ repo by default, even for existing JJ users. The user may already have a carefully curated JJ graph, aliases, revsets, workspaces, bookmarks, and op log. Overlord should not pollute or rewrite it without explicit opt-in.

### Should There Be Different Modes?

Yes.

1. **Safe default: shadow clone**
   - Works for Git users and JJ users.
   - No mutation of user `.jj`.
   - No mutation of user working copy.
   - Accepted output is exported as Git branch/patch/PR.

2. **Power-user: user JJ repo, Overlord-owned workspaces**
   - Explicit opt-in per project.
   - Overlord creates `ovld/...` workspaces and bookmarks only.
   - User can inspect the actual JJ graph.
   - Good for JJ-first users who want native integration.

3. **Managed colocated workspace**
   - Overlord-owned directory only.
   - Used when tools need `.git`.
   - Still not the user's primary workspace.

### Ownership Rules

Hard operational rules:

- Overlord may only mutate workspaces whose names start with `ovld-` and whose workspace paths are under Overlord's managed directory.
- Overlord may only create/move/delete bookmarks under `ovld/`.
- Overlord must never move, delete, abandon, rebase, squash, split, or describe a user-authored change automatically.
- Overlord must never run `jj op restore`, `jj op abandon`, or `jj util gc` in a user-owned JJ repo without explicit confirmation.
- Overlord must not call `jj workspace forget` on a workspace unless its path and name both match an Overlord binding row.
- Overlord must not push bookmarks outside `ovld/`.
- Overlord must not enable or disable colocation in a user workspace.
- Overlord must not rely on global JJ config; pass repo/workspace config explicitly where possible.
- Overlord must store a manifest of every JJ object it owns.
- Overlord must refuse destructive cleanup if ownership cannot be proven.

Detection rules:

```bash
test -d <user-project>/.jj
jj workspace list
jj git colocation status
jj op log --at-op=@ --ignore-working-copy -n 1
```

If `.jj` exists, show:

- "This project already uses JJ."
- Default: "Use private Overlord workspace."
- Advanced: "Use my JJ repo with Overlord-owned workspaces."

## 4. Concurrency And Parallel Agents

### How JJ Behaves

JJ's operation log is designed for lock-free concurrency. Each command loads the latest operation at start, sees a consistent view, writes a new operation with the start operation as parent, and later commands merge divergent operation heads. Conflicting view updates, such as bookmarks moved to different commits, are represented as conflicts.

This is highly relevant for parallel agents. Multiple agents can run `jj` commands at the same time without ordinary repository corruption from logical races. However, this does not mean every product-level race is harmless.

The technical concurrency docs include important caveats:

- With the Git backend, repository corruption is possible because the backend is not entirely lock-free, though recovery may be possible with `jj debug reindex`.
- Concurrent modification from different computers is not thoroughly tested, especially colocated repositories.
- Commit contents should be safe, but bookmark pointers might be lost in some distributed-filesystem scenarios.

### Can Multiple Agents Operate Simultaneously?

Yes, if:

- Each agent has its own workspace.
- Each agent owns a distinct current change or stack.
- Shared mutable refs/bookmarks are minimized.
- Overlord serializes repo-wide operations like import/export/push/gc.
- Overlord treats JJ conflicts/divergence as normal state to surface, not as fatal corruption.

### Failure Mode: Two Agents Modify The Same Change

If two agents rewrite the same change concurrently, the change can become divergent: the same change ID has multiple visible commits. `jj log` labels divergent changes; resolving them requires choosing, merging, rebasing, or abandoning one side.

Mitigation:

- Never assign the same `change_id` to two active agents.
- Retry by creating a new sibling change from a checkpoint unless the retry is single-threaded.
- Enforce a DB lease on `AgentWorkspaceBinding.primary_change_id`.
- If divergence appears, stop automated mutation and create a "needs resolution" Overlord event.

### Failure Mode: One Agent Rebases While Another Snapshots

If agent A rebases commits that agent B's workspace points to, B's workspace may become stale. JJ has `jj workspace update-stale` for this.

Mitigation:

- Agents should not rebase other agents' changes directly.
- Merge/rebase orchestration should happen in a separate integration workspace.
- Before every agent tool call, Overlord can run a cheap stale check via `jj status` or handle stale errors by running `jj workspace update-stale` only for that agent's workspace.
- If updating stale would alter files under an active process, pause the agent first.

### Failure Mode: Git Mutates While JJ Mutates

In non-colocated shadow mode:

- Git mutations in the user's repo do not affect the agent workspace until Overlord imports/fetches intentionally.
- This is safe and predictable.

In colocated mode:

- JJ auto-imports/exports on every command.
- Mutating Git commands may detach/switch HEAD, move branches, create rebase/merge states, or touch the index.
- JJ ignores Git's staging area and does not understand unfinished Git merge/rebase states like Git does.

Mitigation:

- Avoid colocated mode by default.
- In managed colocated workspaces, disable IDE background Git operations where possible.
- Use Overlord-owned branches/bookmarks only.
- Serialize Git import/export/push with a project-level mutex.
- Run health checks before export:

```bash
git -C <workspace> status --porcelain=v1
jj --repository <workspace> status
jj --repository <workspace> bookmark list
```

### Failure Mode: Bookmark Conflicts

Two operations move `ovld/foo` differently. JJ can record a conflicted bookmark.

Mitigation:

- Use append-only bookmark names per attempt, e.g. `ovld/ticket-1-973/session-389dc3e6`.
- Do not have multiple agents move the same bookmark.
- For "best result", create a new bookmark `ovld/ticket-1-973/accepted` only after user selection, under a project-level lock.

### Concurrency Control Layer

Overlord should add its own locks above JJ:

- `workspace_lock(session_id)` for commands that update one workspace.
- `repo_ref_lock(project_id)` for bookmark moves, import/export, push, op restore, op abandon, gc.
- `acceptance_lock(ticket_id)` for selecting accepted result.

This is not because JJ cannot handle concurrency. It is because Overlord needs predictable product semantics and fewer user-facing divergent states.

## 5. UX/Product Design

Users should not see JJ by default.

### Product Vocabulary

Expose:

- Agent run
- Attempt
- Checkpoint
- Restore point
- Snapshot
- Retry from here
- Compare attempts
- Merge attempt
- Accept result
- Reject attempt
- Conflict
- File rationale
- Timeline

Hide:

- working-copy commit
- change ID
- commit ID
- operation ID
- revset
- bookmark
- hidden commit
- divergent operation
- op restore
- evolog

Use JJ IDs only in "technical details" panels, logs, or support exports.

### Concept Mapping

| JJ concept | Overlord concept |
| --- | --- |
| Workspace | Agent sandbox |
| Change ID | Attempt ID / run lineage |
| Commit ID | Snapshot ID |
| Operation ID | Timeline evidence ID |
| Operation log | Recovery log |
| Evolog | Attempt version history |
| Bookmark | Export branch / accepted marker |
| Revset | Internal query |
| Hidden commit | Previous snapshot |
| Divergent change | Attempt fork conflict |
| Conflicted commit | Merge needs resolution |

### Ideal UX

Ticket view:

- Left: semantic Feed timeline.
- Middle: attempts list with status: running, passed tests, conflicts, accepted, rejected.
- Right: selected attempt details.

Attempt card:

- Title: "Attempt 3: Fix OAuth redirect"
- Agent: Codex / Claude / Cursor
- Status: "Tests passed", "3 files changed", "1 conflict", "Based on main@abc123"
- Actions: Compare, Retry from here, Accept, Reject

Timeline event:

- "Agent edited `lib/auth/callback.ts`"
- "Checkpoint created after typecheck"
- "Tests failed: `auth-callback.test.ts`"
- "Agent retried from checkpoint"
- "User accepted Attempt 2"

Restore UI:

- Every tool call boundary can have a small restore icon.
- Clicking it previews:
  - files changed since then,
  - what would be restored,
  - whether it creates a new attempt or resets current attempt.
- Default action: "Create retry from here", not destructive restore.

Merge UI:

- "Combine Attempt 2 and Attempt 4"
- Shows:
  - non-overlapping file changes,
  - overlapping hunks,
  - conflicts as review tasks,
  - generated merge attempt.

Support/debug UI:

- Expand "Version-control details":
  - JJ change ID,
  - commit ID,
  - operation ID,
  - workspace,
  - exported Git branch.

## 6. Comparison Against Alternatives

### Raw Git Worktrees

Strengths:

- Mature.
- Users understand Git.
- Works with every tool.
- Easy PR export.

Weaknesses:

- Every worktree needs a branch or detached state management.
- Dirty worktrees block many operations.
- Stash/index/rebase/merge state is hard to model durably.
- Reflogs are per-ref, not whole-repo semantic operation history.
- Conflict states are not durable first-class commits.

Verdict: safer infrastructure, weaker semantic substrate.

### Ephemeral Git Branches

Strengths:

- Simple mental model for Git users.
- Easy push/delete.
- GitHub-native.

Weaknesses:

- Branch explosion.
- Retrying/rebasing agents requires careful force-with-lease handling.
- Intermediate checkpoints either become commits users see or are hidden in custom storage.
- Does not solve per-tool-call restore cleanly.

Verdict: good fallback/export model, not ideal internal history.

### libgit2

Strengths:

- Embeddable.
- Mature enough for Git object manipulation.
- No shell-out dependency.

Weaknesses:

- You still build the snapshot engine, operation log, conflict model, workspace orchestration, and semantic history yourself.
- Git's index/merge state remains the foundation.

Verdict: useful for fallback and Git plumbing, not a product-level state model.

### Sapling

Strengths:

- Strong stacked-commit workflows.
- Mercurial lineage, revsets, good large-repo pedigree.
- Similar ideas around anonymous heads and evolution.

Weaknesses:

- Less natural Git-colocated story than JJ.
- Working copy is not automatically snapshotted like JJ.
- Conflict states are less aligned with JJ's "commit conflicts and continue" model.

Verdict: credible alternative, especially for large-scale VCS, but less directly matched to "every agent action becomes recoverable state".

### Custom Snapshot Engine

Strengths:

- Full control.
- Can model exactly Overlord's semantic events.
- No external VCS UX leakage.

Weaknesses:

- Hard to implement correctly: renames, binary files, symlinks, permissions, deletes, ignores, large files, submodules, merges, conflicts, GC, recovery.
- Hard to export cleanly to Git.
- Long-term maintenance burden.

Verdict: only worth it if JJ proves too risky and requirements stay narrow.

### Event-Sourced State System

Strengths:

- Excellent semantic timeline.
- Strong auditability.
- Easy to attach transcripts/tool calls/rationales.

Weaknesses:

- File trees are not naturally event-sourced unless every patch applies cleanly forever.
- Reconstructing arbitrary repo states can be slow and fragile.
- Merge/conflict logic still needed.

Verdict: use for Overlord metadata, not as the file snapshot source of truth.

### SQLite-Backed File Snapshots

Strengths:

- Simple MVP.
- Easy to query by file/checkpoint.
- Fully controlled retention.

Weaknesses:

- Scaling large repos and binary files gets expensive.
- Diff/merge/rename detection becomes custom.
- Git export still needs patch synthesis or worktree materialization.

Verdict: good emergency fallback for checkpoints, not enough for concurrent agent merging.

### CRDT Approaches

Strengths:

- Real-time collaborative editing.
- Fine-grained provenance possible.

Weaknesses:

- Code repositories are tree snapshots plus build artifacts, not just collaborative text buffers.
- Merge semantics for arbitrary files are domain-specific.
- Git/PR export remains custom.

Verdict: overkill and wrong abstraction for current Overlord agent execution.

### Where JJ Shines

- Mutable logical changes.
- Whole-repo operation history.
- Parallel workspaces.
- Anonymous speculative heads.
- First-class conflicts.
- Git compatibility.
- Built-in undo/restore/evolution-log semantics.

### Where JJ Is Dangerous

- Existing JJ user repos.
- Colocated Git/JJ interleaving.
- Pre-1.0 CLI and storage changes.
- Large-repo performance unknowns for Overlord workloads.
- Users may distrust invisible VCS mutation.
- Operation-log bloat if Overlord snapshots too aggressively.

## 7. Operational Risk Assessment

### Maturity Risk

Medium-high. JJ is used seriously by its developers and a growing community, but it is still experimental/pre-1.0. The README warns of possible bugs, backward-incompatible storage changes, UI changes, and workflow gaps.

### Ecosystem Risk

Medium. Git is universal; JJ is not. Most tools expect Git. JJ's Git backend helps, but unsupported/partial features matter:

- `.gitattributes`: not supported.
- hooks: not supported.
- submodules: not supported in working copy.
- partial clones: not supported.
- shallow clone deepening: limited.
- Git LFS: not supported according to the Git compatibility docs.

For many app repos this may be acceptable; for enterprise repos it can be blocking.

### CLI Stability Risk

Medium. The CLI reference itself says it is experimental and generated, with `jj help` more authoritative. Command names have evolved historically (`branch` to `bookmark` in newer docs). Overlord should pin a JJ version and wrap all commands behind an internal adapter.

### Performance Risk

Medium. Risks:

- Automatic snapshot on frequent commands.
- Large workspaces with many files.
- Colocated repos with many refs causing slow automatic import.
- Many agent workspaces.
- Operation log and evolog growth.

Mitigation:

- Use `--ignore-working-copy` for read-only status/log polling where correct.
- Snapshot only at semantic boundaries.
- Use sparse patterns for large repos.
- Avoid colocated mode by default.
- Measure command latency per repo.

### Corruption Risk

Low-medium in shadow local repos, higher in distributed-filesystem or colocated scenarios. JJ's operation log is designed to avoid lockfile corruption, but the technical docs note Git backend lock-free limitations and possible corruption recovery via `jj debug reindex`.

### Compatibility Risk

High if using user `.jj`; medium if using shadow clones. Existing JJ users are the main risk because Overlord could pollute or rewrite their graph. Git users are safer if Overlord stays in private directories and exports normal branches/PRs.

### Onboarding Risk

Low if hidden; high if exposed. Users should not need to install or learn JJ for the MVP. Bundle or manage JJ internally.

### User Trust Risk

High if Overlord touches the user's repo invisibly. Product must be explicit:

- "Overlord runs agents in private workspaces."
- "Your project directory is not modified until you accept changes."
- "Accepted work is exported as a normal Git branch/PR."

### Recommendation

Do not build Overlord's entire core architecture around JJ today.

Build a hybrid:

- Overlord DB/event stream remains the source of product truth.
- Git remains the user-facing interchange format.
- JJ is an internal optional execution/snapshot backend.
- Keep a Git-worktree or file-snapshot fallback.

Promote JJ from optional backend to default backend only after:

- pinned JJ version is bundled,
- shadow repos survive real projects,
- existing JJ user mode is proven safe,
- operation-log retention/GC is solved,
- performance is measured,
- export/import flows are reliable.

## 8. Recommended MVP

### MVP Goal

Use JJ for private parallel agent workspaces and checkpoints without touching user `.jj` or requiring user knowledge.

### MVP Non-Goals

- No user-JJ-native mode.
- No colocated user workspace mutation.
- No JJ graph UI.
- No automated multi-attempt merge beyond producing a merge preview.
- No dependence on `jj-lib`.

### Workflow

Project setup:

```bash
jj git clone --no-colocate <remote-url> <ovld-data>/projects/<project-id>/jj/repo
```

If no remote URL exists:

```bash
git -C <user-project> bundle create <tmp>/project.bundle --all
jj git clone --no-colocate <tmp>/project.bundle <ovld-data>/projects/<project-id>/jj/repo
```

Agent start:

```bash
jj --repository <repo> git fetch --remote origin
jj --repository <repo> workspace add <workspaces>/session-<session-id>
cd <workspaces>/session-<session-id>
jj new trunk()
jj describe -m "ovld ticket <ticket-id> session <session-id>"
```

Checkpoint after tool call:

```bash
jj util snapshot
jj log -r @ -T 'change_id ++ " " ++ commit_id'
jj op log --at-op=@ --ignore-working-copy -n 1 -T 'id'
jj diff --stat
```

Read-only timeline inspection:

```bash
jj --at-op=<operation-id> --ignore-working-copy diff -r <commit-id>
jj evolog -r <change-id>
```

Accept attempt:

```bash
jj bookmark set ovld/ticket-<ticket-id>/session-<session-id> -r <commit-id>
jj git export
jj git push --remote origin --bookmark ovld/ticket-<ticket-id>/session-<session-id>
```

Reject attempt:

```bash
jj workspace forget <workspace-name>
```

Keep the commit/checkpoint until retention expires; do not immediately abandon operations.

### Internal Abstractions

```ts
interface SnapshotBackend {
  prepareProject(project: Project): Promise<ProjectSnapshotBinding>;
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceBinding>;
  snapshot(input: SnapshotInput): Promise<CheckpointRef>;
  diff(input: DiffInput): Promise<UnifiedDiff>;
  createRetry(input: RetryInput): Promise<WorkspaceBinding>;
  exportAccepted(input: ExportInput): Promise<GitExportRef>;
  cleanupWorkspace(input: CleanupInput): Promise<void>;
  healthCheck(projectId: string): Promise<SnapshotHealth>;
}
```

Implement:

- `GitWorktreeSnapshotBackend` as fallback.
- `JjCliSnapshotBackend` as experimental/default-for-internal-dogfood.

### Migration Strategy

No schema should require JJ forever. Store generic fields plus JJ-specific nullable details:

```ts
type SnapshotRef = {
  backend: 'jj' | 'git-worktree' | 'sqlite-files';
  file_tree_id: string;       // generic snapshot identity
  git_commit_id?: string;
  jj_change_id?: string;
  jj_commit_id?: string;
  jj_operation_id?: string;
};
```

If abandoning JJ:

- Keep exported Git commits/branches.
- Keep Overlord diffs and rationales.
- Drop shadow repos after retention.
- Switch backend implementation to Git worktrees.

### Fallback Plan

If JJ command fails:

1. Record Overlord alert event with command, exit code, sanitized stderr.
2. Freeze the affected workspace.
3. Try read-only `jj op log --at-op=@ --ignore-working-copy`.
4. If repo health is bad, export last known commit as patch if possible.
5. Fall back to Git worktree for new attempts.

## 9. Advanced Opportunities

### Semantic Replay

Combine Overlord event stream with JJ checkpoints:

- Replay transcript/tool calls as semantic events.
- Use JJ commit IDs to materialize file state at each event.
- Use operation IDs to inspect repository view at that point.

This gives "why did this file end up like this?" with both natural-language rationale and exact diff provenance.

### Reversible Agent Execution

Every tool call can become:

- before checkpoint,
- after checkpoint,
- tool output,
- diff,
- rationale.

Default reversal creates a new retry attempt from the before checkpoint. Destructive reset is reserved for advanced controls.

### Branchless Agent Collaboration

Multiple attempts can be visible heads with no branch names. Overlord shows them as attempts. Only accepted output gets a Git branch/bookmark.

### Timeline Visualization

Use JJ operation DAG as the hidden mechanical layer and Overlord events as the visible layer:

```text
Ticket opened
  Agent A started        [workspace ovld-A, change abc]
    checkpoint 1         [commit c1, op o1]
    checkpoint 2         [commit c2, op o2]
  Agent B started        [workspace ovld-B, change def]
    checkpoint 1         [commit d1, op o3]
  Merge preview          [merge commit m1, op o4]
  User accepted A        [bookmark ovld/... -> c2]
```

### Restore Before This Tool Call

For every tool call, store a before/after checkpoint. The UI can offer:

- "Retry from before this"
- "Compare before/after"
- "Keep this file from before"
- "Revert only this hunk"

JJ commands like `jj restore`, `jj squash -i`, and `jj diffedit` could power advanced selective restore.

### Agent Diff Provenance

For each file-change rationale, store:

- first checkpoint where file changed,
- last checkpoint where file changed,
- tool call that introduced the hunk,
- tool call that last modified it,
- final accepted commit.

JJ gives stable snapshots; Overlord supplies the semantic reason.

### Agent Merge UIs

JJ's ability to commit conflicts enables a merge queue:

- "Attempt 2 + Attempt 3 can be combined cleanly"
- "Attempt 4 conflicts in `auth.ts`"
- "Ask an agent to resolve this merge"

The merge attempt itself is just another Overlord attempt.

### Speculative Execution Trees

Overlord can launch:

- one agent fixing tests,
- one agent refactoring,
- one agent doing minimal patch,
- one agent trying a library upgrade.

JJ tracks all attempts as heads/changes. Overlord ranks them by tests, diff size, risk, and rationale quality.

### Operation-Level Debugging

For internal support:

- `jj op show <operation-id>` for what repo-level mutation happened.
- `jj --at-op=<operation-id> log/diff/status` for point-in-time inspection.
- `jj evolog -r <change-id>` for how an attempt evolved.

This could be attached to Overlord support bundles.

## 10. Implementation Guidance

### Shell Out vs `jj-lib`

MVP: shell out to a pinned `jj` binary.

Reasons:

- CLI is the supported user-facing contract.
- `jj-lib` docs say it is intended for GUI/TUI/server use, but also note that not much attention has gone into details like exposed symbols and collection types.
- Using `jj-lib` ties Overlord to Rust dependency/API churn.
- Overlord appears to be primarily TypeScript/Node/Electron/Supabase; process isolation around CLI calls is simpler.

Medium term:

- Keep a narrow adapter so a Rust helper can replace shell-out later.
- Consider a small Rust sidecar only for high-volume operations after MVP bottlenecks are known.

### Process Architecture

```text
Overlord app/server
  SnapshotBackend interface
    JjCliSnapshotBackend
      JjCommandRunner
        - pinned binary path
        - cwd/workspace validation
        - env isolation
        - timeout
        - stdout/stderr capture
        - structured template parsing
      JjProjectLockManager
      JjHealthMonitor
```

Command runner requirements:

- Always pass explicit cwd or `--repository`.
- Never inherit arbitrary `JJ_CONFIG` from user shell.
- Set `NO_COLOR=1` or use `--color=never`.
- Use templates for parseable output.
- Time out long commands.
- Capture operation IDs after mutating commands.
- Redact paths/tokens from logs where needed.

### Sandboxing Agents

Agent process:

- cwd = Overlord workspace path.
- write allowlist = workspace path plus approved temp/cache dirs.
- no write access to user project root in shadow mode.
- no access to Overlord metadata DB credentials except scoped protocol token.
- no direct push credentials unless export step is explicit.

Filesystem:

```text
<ovld-data>/projects/<project-id>/jj/workspaces/<session-id>/
<ovld-data>/projects/<project-id>/tmp/<session-id>/
```

Environment:

```bash
GIT_CONFIG_GLOBAL=/dev/null       # or managed config
JJ_CONFIG=<managed-config>        # if supported by installed version
HOME=<agent-home>                 # optional stricter isolation
```

### Workspace Directory Structure

```text
<ovld-data>/projects/<project-id>/
  jj/
    repo/
    workspaces/
      ovld-1-973-389dc3e6/
      ovld-1-973-a12f99c1/
    exports/
      ticket-1-973-session-389dc3e6.patch
    logs/
      jj-command-log.ndjson
```

Do not place workspaces inside the user's repo. Do not place shadow `.jj` inside the user's repo.

### Avoid Snapshot Spam

JJ snapshots on most commands. Overlord should avoid making read-only polling accidentally mutate state.

Rules:

- Use `--ignore-working-copy` for read-only queries when fresh filesystem state is not needed.
- Use `--at-op=@ --ignore-working-copy` for op-log polling.
- Do not run `jj status` every second in active workspaces.
- Snapshot after semantic boundaries:
  - before tool call,
  - after tool call if files changed,
  - before/after dependency install,
  - before/after test fix loop,
  - before delivery,
  - before merge preview.
- Debounce checkpoints: if only timestamp/cache files changed and ignored rules catch them, skip.
- Configure `snapshot.auto-track` narrowly if repos generate unignored build outputs.

### Avoid Operation-Log Bloat

- Prefer fewer JJ commands per tool event.
- Batch metadata queries with templates.
- Keep read-only commands non-mutating.
- Retain op history per project policy.
- After retention, use `jj op abandon` and `jj util gc` only in shadow repos and only after exporting/recording durable Overlord metadata.

### Monitoring Repository Health

Track per project:

- JJ version.
- command latency p50/p95.
- snapshot duration.
- workspace count.
- operation count estimate.
- shadow repo disk size.
- number of visible heads under `ovld/`.
- divergent changes count.
- conflicted bookmarks count.
- stale workspace incidents.
- failed import/export/push count.
- gc duration and reclaimed bytes.

Health commands:

```bash
jj --repository <repo> op log --at-op=@ --ignore-working-copy -n 1
jj --repository <repo> workspace list
jj --repository <repo> log -r 'visible_heads()'
jj --repository <repo> bookmark list
jj --repository <repo> git import
```

For parseability, use `-T` templates rather than human output.

### Version Pinning

Bundle a tested JJ version with Overlord Desktop/agent runtime. Store:

- binary version,
- docs version used for adapter,
- minimum supported version,
- feature flags enabled.

At startup:

```bash
jj version
```

Refuse to use unsupported user-installed JJ for managed mode unless the user opts into "use system JJ".

### Security And Trust

User-facing guarantees:

- "Private Overlord workspaces are separate from your project folder."
- "Overlord will not modify your existing JJ repo unless you enable JJ-native mode."
- "Accepted changes are exported as normal Git branches/PRs."
- "Rejected attempts are retained for N days and can be deleted."

Audit:

- Store every JJ command Overlord runs with session ID, workspace, command kind, start/end time, exit code, and resulting operation ID.
- Do not store full command env if secrets may appear.

## Product Decision

Build the MVP with JJ as a shadow execution backend, not as the irreversible foundation of Overlord.

Success criteria before making JJ default:

- 20+ real repos exercised, including monorepos and generated-file-heavy repos.
- 50+ parallel agent sessions without workspace collision or lost work.
- Clean export to GitHub PRs.
- Existing JJ users can opt in or stay isolated without confusion.
- Operation-log retention and cleanup tested.
- Colocated mode documented as exceptional.
- Fallback backend can take over new attempts if JJ fails.

If these pass, JJ can become the default internal substrate while Git remains the public contract.

## Execution Checklist

This checklist turns the research above into concrete product and engineering decisions that can be acted on now. Items are marked complete when this document already resolves them well enough to guide implementation.

- [x] Confirm the adoption stance.
  Outcome: JJ should be introduced as a shadow execution backend, not as an irreversible core dependency or a user-visible requirement.
- [x] Decide the repository ownership model.
  Outcome: default to private non-colocated shadow repos under Overlord-managed storage; do not mutate a user's existing `.jj` repo by default.
- [x] Define agent isolation rules.
  Outcome: one Overlord agent session gets one Overlord-owned JJ workspace, with writes limited to that workspace path and Overlord-owned `ovld/` bookmarks only.
- [x] Define the snapshot identity model.
  Outcome: treat `change_id` as attempt lineage, `commit_id` as snapshot identity, and `operation_id` as repo-timeline evidence, while keeping Overlord event IDs as the product timeline.
- [x] Decide how file changes and rationales should work.
  Outcome: keep file-change rationales as Overlord-native metadata attached to events/checkpoints; JJ supplies durable snapshots and provenance anchors, but the user-facing file-change record remains semantic rather than JJ-native.
- [x] Decide whether non-JJ workflows still benefit.
  Outcome: yes. Git remains the public/export contract, so GitHub PR flows and other Git-based workflows can benefit from cleaner internal checkpointing and provenance without needing to understand JJ.
- [x] Decide the user compatibility policy for existing JJ users.
  Outcome: ship a safe shadow mode by default, add an explicit advanced `user-jj-native` mode later, and enforce strict ownership boundaries before allowing Overlord to touch a user's real JJ repo.
- [x] Define concurrency constraints for multiple agents.
  Outcome: allow parallel JJ workspaces, but add Overlord locks for workspace mutation, repo-wide ref/export operations, and acceptance selection to avoid confusing product-level races.
- [x] Decide what UX should expose.
  Outcome: expose attempts, checkpoints, restore points, compare/accept/reject flows, and conflicts; hide JJ mechanics like revsets, bookmarks, working-copy commits, and operation DAG details by default.
- [x] Define the MVP integration surface.
  Outcome: implement a `SnapshotBackend` abstraction with `JjCliSnapshotBackend` plus a fallback `GitWorktreeSnapshotBackend`, using a pinned bundled JJ binary and CLI shell-out rather than `jj-lib`.
- [x] Define safety, fallback, and retention rules.
  Outcome: freeze unhealthy workspaces, emit Overlord alerts on JJ failures, fall back to Git worktrees for new attempts if needed, and delay destructive JJ cleanup until retention/export requirements are satisfied.
- [x] Define the go/no-go gate for broader rollout.
  Outcome: only consider JJ the default internal substrate after real-world validation across many repos, parallel sessions, cleanup flows, export paths, and existing-JJ-user compatibility.

