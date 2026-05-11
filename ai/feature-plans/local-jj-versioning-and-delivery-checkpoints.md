# Local JJ Versioning And Delivery Checkpoints

## Objective

Make Overlord's file-change history and checkpointing model line up with the intended product behavior:

- Users inspect current uncommitted changes in the project's original workspace.
- Delivery automatically creates a local checkpoint before the API request.
- File-change rationales are anchored to the checkpoint created for the same objective/session.
- Non-git folders can opt into versioning by initializing Jujutsu (`jj`) directly in that folder.
- The API remains a storage and coordination surface; local filesystem mutation stays in Electron and CLI code.

## Product Decisions

1. Checkpoint creation should be a local helper, invoked before the protocol `deliver` API request.
2. The helper should be shared by Electron and `ovld` CLI so checkpoint policy cannot drift.
3. The API should only receive and persist checkpoint ids/provenance.
4. Non-git project folders should not be versioned automatically.
5. Project settings should expose an opt-in toggle:

   ```text
   Install version control in this folder
   Overlord uses jujutsu (link to docs) to let you clearly track and revert changes AI agents make in this folder.
   ```

6. Enabling the toggle initializes JJ directly in the project's original local folder.
7. Current Changes should inspect the original project workspace, because JJ is expected to manage that folder in the usual case.

## Current State

The current code already has several pieces of the desired model:

- `file_changes` stores structured rationale rows and has JJ provenance columns.
- Protocol `update`, `deliver`, and `record-change-rationales` accept optional `snapshot` metadata.
- `insertFileChanges` maps snapshot metadata onto each file-change row.
- `JjCliSnapshotBackend.snapshot` can run `jj util snapshot` and capture `change_id`, `commit_id`, and `operation_id`.
- Electron launch can prepare a managed snapshot workspace and expose `OVERLORD_SNAPSHOT_JSON`.
- CLI `deliver` can merge `OVERLORD_SNAPSHOT_JSON` with payload-level snapshot metadata.

The gaps are mostly orchestration and source-of-truth alignment:

- Delivery does not automatically create a checkpoint before calling the API.
- The local helper is currently oriented around managed shadow workspaces rather than in-place project-folder JJ.
- Plain folders are not inspectable in Current Changes because the workspace client uses Git status/diff commands.
- There is no project setting that records whether the user opted into in-folder JJ initialization.
- There is no first-class checkpoint table that connects objectives, sessions, snapshot ids, and file-change records.

## Target Architecture

```text
Project settings
  local_working_directory = /Users/jake/Work/My Content Folder
  local_version_control = off | jj

User enables "Install version control in this folder"
  Electron validates local folder access
  Electron runs jj init in the project folder
  App persists local_version_control = jj

Agent works in original project folder
  cwd = local_working_directory
  JJ manages the same folder

Agent delivers
  shared local helper runs checkpoint before API request
  helper returns backend + workspace path + jj ids + checkpoint id
  CLI/Electron merges those ids into protocol deliver payload
  API writes deliver event, checkpoint row, and file_changes rows

Current Changes
  reads original project folder
  uses JJ status/diff if local_version_control = jj or .jj exists
  uses Git status/diff if Git repo and JJ is not active
  shows rationale and checkpoint provenance from file_changes/checkpoints
```

## Data Model

### Project User Preference

The local working directory is already user-scoped in `project_user`, not globally stored on `projects`. The version-control installation setting should follow the same ownership model because it depends on the user's local folder.

Add columns to `project_user`:

```sql
alter table public.project_user
  add column local_version_control text not null default 'off',
  add column local_version_control_installed_at timestamptz,
  add column local_version_control_error text;

alter table public.project_user
  add constraint project_user_local_version_control_check
  check (local_version_control in ('off', 'jj'));
```

Recommended semantics:

- `off`: do not initialize or use JJ for plain folders.
- `jj`: the user opted into in-folder JJ for this local folder.
- `local_version_control_installed_at`: last successful local initialization time.
- `local_version_control_error`: last setup failure, for settings UI diagnostics.

Do not store absolute `.jj` internals in the hosted database unless needed. The local directory path already exists in `project_user.local_working_directory`.

### Checkpoint Records

Add a dedicated checkpoint table. `file_changes` should keep its denormalized provenance fields for fast display, but checkpoint rows should be the canonical rollback anchors.

```sql
create table public.project_checkpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id integer not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete set null,
  objective_id uuid references public.objectives(id) on delete set null,
  session_id uuid references public.agent_sessions(id) on delete set null,
  event_id uuid references public.ticket_events(id) on delete set null,
  checkpoint_kind text not null default 'delivery',
  backend text not null,
  workspace_path text,
  workspace_name text,
  jj_change_id text,
  jj_commit_id text,
  jj_operation_id text,
  git_commit_id text,
  summary text,
  diff_stat text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index project_checkpoints_project_created_idx
  on public.project_checkpoints (project_id, created_at desc);

create index project_checkpoints_ticket_created_idx
  on public.project_checkpoints (ticket_id, created_at desc)
  where ticket_id is not null;

create index project_checkpoints_objective_idx
  on public.project_checkpoints (objective_id)
  where objective_id is not null;
```

Add a nullable `checkpoint_id` to `file_changes`:

```sql
alter table public.file_changes
  add column checkpoint_id uuid references public.project_checkpoints(id) on delete set null;
```

RLS should mirror project/ticket access:

- members can select checkpoints for projects in their organizations.
- service role can insert/update as part of protocol handling.
- direct authenticated insert is not required for the initial implementation.

## Local Helper Design

Create a shared Node helper under `lib/snapshot/`, for example:

```text
lib/snapshot/local-checkpoint.ts
```

Suggested API:

```ts
export type LocalCheckpointInput = {
  backendPreference?: 'auto' | 'jj' | 'git';
  checkpointKind: 'delivery' | 'manual' | 'objective';
  projectId: string;
  ticketId: string;
  objectiveId?: string | null;
  sessionId: string;
  workspacePath: string;
  workspaceName?: string | null;
  summary?: string | null;
};

export type LocalCheckpointResult = {
  backend: 'jj' | 'git';
  workspacePath: string;
  workspaceName: string | null;
  jjChangeId: string | null;
  jjCommitId: string | null;
  jjOperationId: string | null;
  gitCommitId: string | null;
  diffStat: string | null;
};

export async function createLocalCheckpoint(input: LocalCheckpointInput): Promise<LocalCheckpointResult>;
```

Behavior:

- If `backendPreference` is `jj`, require a healthy JJ repo in `workspacePath`.
- If `backendPreference` is `auto`, prefer JJ when `.jj` exists or `jj root` succeeds.
- If no JJ repo exists and the workspace is a Git repo, use Git fallback metadata.
- For delivery on a project with `local_version_control = jj`, fail delivery if JJ checkpointing fails. The user explicitly opted into revertable history, so silently delivering without a checkpoint would violate the product promise.
- For delivery on a normal Git project without JJ, preserve existing behavior and attach Git metadata where available.

For JJ checkpoints:

```bash
jj --repository <workspacePath> util snapshot
jj --repository <workspacePath> log -r @ -T 'change_id ++ " " ++ commit_id'
jj --repository <workspacePath> op log --at-op=@ --ignore-working-copy -n 1 -T id
jj --repository <workspacePath> diff --stat
```

For Git fallback:

```bash
git -C <workspacePath> rev-parse HEAD
git -C <workspacePath> diff --stat HEAD
```

Git fallback cannot provide revertable per-objective checkpoints unless it creates commits/stashes, so it should be treated as weaker provenance. The product guarantee for non-git folders should depend on JJ being installed and initialized.

## In-Folder JJ Installation

Add a second shared helper:

```text
lib/snapshot/install-local-version-control.ts
```

Suggested API:

```ts
export type InstallLocalVersionControlInput = {
  directory: string;
  mode: 'jj';
};

export type InstallLocalVersionControlResult = {
  ok: true;
  backend: 'jj';
  rootPath: string;
  alreadyInstalled: boolean;
  jjVersion: string | null;
} | {
  ok: false;
  error: string;
};
```

Behavior:

1. Validate the directory exists and is writable.
2. Run `jj version` and return a clear install error if the binary is missing.
3. Detect existing JJ with `jj root` from the directory.
4. If no JJ root exists, run `jj git init --colocate` or `jj init --git` in the folder depending on the installed JJ CLI support.
5. Run an initial `jj util snapshot`.
6. Return the root path and version.

Important implementation note: use the currently installed JJ command shape after local verification. JJ CLI flags have changed over time, so the implementation should have tests with mocked command runners and a small manual verification note in docs.

Safety behavior:

- Never initialize JJ unless the user toggles the setting.
- Show a confirmation dialog because this writes `.jj` and likely `.git` metadata into the folder.
- If `.git` already exists, initialize JJ colocated with the existing Git repo only after explaining that JJ will manage the same workspace.
- If `.jj` already exists, treat enablement as adopting the existing JJ repo and do not reinitialize.
- Do not enable this setting for SSH workspaces in the first pass unless the remote helper can run JJ initialization safely on the remote host.

## Project Settings UX

Place the control on the existing `WorkflowPage` near the local working directory section.

UI states:

- Local directory missing: disabled with copy that a local folder is required.
- Version control off: toggle/action available.
- Installing: disable controls and show progress.
- Installed: show `Jujutsu enabled` plus last installed/verified time.
- Error: show the last setup error and a retry action.

Recommended copy:

```text
Install version control in this folder
Overlord uses jujutsu to let you clearly track and revert changes AI agents make in this folder.
```

The word `jujutsu` should link to the existing docs page or the official JJ docs. Prefer the internal docs route once updated, because it can explain Overlord-specific behavior.

Required app actions/API:

- Add a server action to persist `local_version_control`, `installed_at`, and error state for the current user's `project_user` row.
- Add an Electron IPC action that runs the local installation helper against the selected directory.
- Wire the UI so enabling the toggle first runs Electron local setup, then persists success to Supabase.
- On web without Electron local access, show the setting as informational/disabled or provide CLI instructions.

## Protocol Delivery Flow

### CLI

Update `packages/overlord-cli/bin/_cli/protocol.mjs`:

1. Add a pre-deliver checkpoint step before `validateDeliverFileChanges`.
2. Resolve workspace path from:
   - `OVERLORD_SNAPSHOT_JSON.workspacePath`
   - `--snapshot-json` / `--snapshot-file`
   - current working directory
3. Run the shared local checkpoint helper when:
   - `--skip-checkpoint` is not set
   - command is `deliver`
   - workspace path exists locally
4. Merge the checkpoint ids into the outgoing `snapshot` object.
5. Include `checkpoint` data in the deliver payload if the API schema adds it separately.

Add flags:

```text
--skip-checkpoint
--checkpoint-backend <auto|jj|git>
```

Default behavior:

- `deliver` attempts a checkpoint automatically.
- If the workspace is a JJ repo and checkpointing fails, fail with an actionable error.
- If the workspace is only Git and Git metadata collection fails, preserve today's deliver behavior unless `--checkpoint-backend jj` was requested.

### Electron

Update `apps/desktop/electron/services/agent-launcher.ts` and the terminal/session path:

- Continue launching agents in the original local project folder when that is the configured workspace.
- Set `OVERLORD_SNAPSHOT_JSON` with at least `backend`, `workspacePath`, `workspaceName`, and `projectId` when JJ is active.
- Ensure the local helper is available to the CLI process started by Electron.

If Electron performs delivery directly in any flow, call the same shared helper before posting to `/api/protocol/deliver`.

### API

Update `deliverSchema` to accept optional checkpoint metadata, or extend the existing `snapshot` block with `checkpointKind` and `diffStat`.

Recommended payload shape:

```json
{
  "snapshot": {
    "backend": "jj",
    "workspacePath": "/Users/jake/Work/My Folder",
    "workspaceName": "My Folder",
    "jjChangeId": "...",
    "jjCommitId": "...",
    "jjOperationId": "..."
  },
  "checkpoint": {
    "kind": "delivery",
    "summary": "Ticket delivered",
    "diffStat": "..."
  }
}
```

API behavior:

1. Persist the `ticket_events` deliver row first.
2. Insert `project_checkpoints` when checkpoint/snapshot metadata exists.
3. Pass `checkpointId` into `insertFileChanges`.
4. Keep denormalized `jj_*` fields on `file_changes` for direct UI reads.
5. Do not run local JJ/Git commands in API routes.

## Current Changes

Current Changes should inspect the original project workspace selected in project settings.

Replace Git-only assumptions in the workspace client with backend-neutral operations:

```ts
getWorkingTreeStatus(): Promise<WorkingTreeStatusResult>
getWorkingTreeDiff(options: WorkingTreeDiffOptions): Promise<WorkingTreeDiffResult>
getAggregateWorkingTreeDiff(): Promise<AggregateDiffResult>
```

Implementation strategy:

- Keep existing Git implementations.
- Add JJ implementations in `LocalWorkspaceClient`.
- Select JJ when `.jj` exists, `jj root` succeeds, or project settings say `local_version_control = jj`.
- Keep the old `getGitStatus` / `getGitDiff` IPC names initially as wrappers to avoid a large frontend rename, then migrate names when the UI is stable.

JJ commands to evaluate:

```bash
jj --repository <workspacePath> status
jj --repository <workspacePath> diff --git
jj --repository <workspacePath> diff --stat
```

Current Changes behavior:

- Show files from the original project folder.
- Show file-change rationales from `file_changes` joined through tickets.
- Prefer path-level attribution when rationale hunk metadata is absent.
- Use checkpoint metadata in the diff header so the user sees whether a file has JJ-backed provenance.
- Do not add a workspace selector for the initial in-folder JJ model.

## Revert Model

Delivery checkpoints are only useful if they become revert targets.

Initial revert UX can be conservative:

- Show checkpoint details in Current Changes and ticket file-change panels.
- Add a "Restore checkpoint" action later, after checkpoint rows are proven reliable.

Future restore helper:

```ts
restoreLocalCheckpoint({
  workspacePath,
  backend: 'jj',
  jjOperationId,
  jjCommitId
})
```

Possible JJ restore approaches:

- Use `jj restore --from <commit>` for file/tree restoration.
- Use `jj op restore <operation_id>` for whole-repo operation restoration only when the UX is explicit about the blast radius.

Recommendation:

- For per-objective rollback, prefer restoring file contents from `jj_commit_id`.
- Avoid automatic `jj op restore` in the first product pass because it can rewrite broader repo view state, not just the files changed by one objective.

## Implementation Phases

### Phase 1: Schema And Types

- Add `project_user.local_version_control`, install timestamp, and error columns.
- Add `project_checkpoints`.
- Add `file_changes.checkpoint_id`.
- Regenerate `types/database.types.ts`.
- Add RLS policies and indexes.
- Add Zod schemas for checkpoint payloads.

### Phase 2: Local JJ Installation

- Build `installLocalVersionControl` helper with injectable command runner.
- Add Electron IPC for install/check status.
- Add server action to persist the setting.
- Add Workflow settings UI toggle and confirmation dialog.
- Add tests for missing directory, missing JJ, existing JJ, and successful init command sequence.

### Phase 3: Shared Delivery Checkpoint Helper

- Build `createLocalCheckpoint` helper.
- Integrate it into CLI `deliver`.
- Integrate it into any Electron-owned deliver path if present.
- Add `--skip-checkpoint` and `--checkpoint-backend`.
- Add tests proving `deliver` merges checkpoint ids into snapshot payload before API submission.

### Phase 4: API Persistence

- Extend protocol schemas and routes for checkpoint metadata.
- Insert checkpoint rows during `deliver`.
- Link `file_changes` rows to the checkpoint row.
- Add protocol tests for delivery with checkpoint, delivery without checkpoint, and malformed checkpoint metadata.

### Phase 5: Current Changes Backend-Neutral Inspection

- Add JJ status/diff support to local workspace client.
- Keep Git fallback for ordinary repos.
- Update Electron IPC/types if adding new method names.
- Update Current Changes hooks to consume backend-neutral status/diff.
- Add tests for path-only rationale fallback and JJ provenance display.

### Phase 6: Docs And Agent Guidance

- Update `docs/jujustu-integration.md` to reflect in-folder opt-in JJ instead of shadow workspace as the normal folder-versioning path.
- Update agent docs so delivery checkpointing is automatic and agents do not need to manually fabricate snapshot metadata.
- Update connector surfaces if CLI flags or MCP deliver schema changes.

## Acceptance Criteria

- A project with a normal Git repo can still inspect Current Changes and deliver with file-change rationales.
- A project with a plain folder has version control off by default.
- Enabling "Install version control in this folder" from Electron initializes JJ in that folder and persists the setting.
- A plain folder with JJ enabled appears in Current Changes with status and diffs.
- `ovld protocol deliver` creates a local checkpoint before sending the API request when the workspace is JJ-managed.
- Delivered `file_changes` rows link to a checkpoint row and include matching JJ ids.
- The API never attempts to access or mutate the user's local filesystem.
- Current Changes reads the original project folder, not a shadow workspace, for the in-folder JJ mode.

## Testing Plan

- Unit test `installLocalVersionControl` with mocked command runner.
- Unit test `createLocalCheckpoint` with mocked JJ and Git command runners.
- CLI test: deliver in a temp JJ repo includes checkpoint ids in the submitted payload.
- CLI test: `--skip-checkpoint` preserves existing behavior.
- API test: deliver with checkpoint inserts `project_checkpoints` and links `file_changes`.
- Workspace test: plain folder with JJ enabled returns changed files and diffs.
- UI test: Project settings toggle disabled without local directory and enabled in Electron with a local directory.
- Current Changes view-model test: path-level rationales remain visible when hunk metadata is absent.

## Risks And Mitigations

- **JJ CLI variance:** detect command support during installation and keep command-runner tests isolated from exact local versions.
- **Unexpected folder mutation:** require explicit user toggle and confirmation before running `jj init`.
- **Delivery retry duplicates:** include idempotency metadata in checkpoint rows, such as `session_id + checkpoint_kind + event_id` where possible, and reuse local checkpoint ids during retry if available.
- **SSH workspace gap:** defer remote JJ initialization until the remote helper has explicit support.
- **Revert blast radius:** start with checkpoint display and file/tree restore from commit ids; avoid whole-operation restore until the UX is clear.
- **Git/JJ confusion:** keep UI copy focused on Overlord version control and rollback. Expose JJ ids as provenance, not as the primary user model.

## Open Follow-Up Decisions

- Whether `project_checkpoints` should store local absolute `workspace_path`, or whether the API should store only a redacted path label plus local-only metadata in Electron storage.
- Whether enabling JJ in an existing Git repo should be offered in the same setting or limited to non-git folders for the first release.
- Whether Current Changes should show a persistent "version control off" banner for plain folders until the user enables JJ.
- Whether manual checkpoints should be exposed in the UI before restore controls ship.
