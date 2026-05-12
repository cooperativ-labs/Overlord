-- Trim project_checkpoints and file_changes down to a single git-based
-- model. Drops every JJ-specific column, the local-version-control
-- toggle on project_user, and the absolute workspace_path leakage. The
-- new shape pivots on (project_id, objective_id) so each objective has
-- at most one checkpoint, anchored by a hidden git ref the local CLI
-- creates (refs/overlord/checkpoints/<objectiveId>).

-- ---- project_checkpoints --------------------------------------------------
alter table public.project_checkpoints
  drop column if exists backend,
  drop column if exists workspace_path,
  drop column if exists workspace_name,
  drop column if exists jj_change_id,
  drop column if exists jj_commit_id,
  drop column if exists jj_operation_id;

alter table public.project_checkpoints
  add column if not exists git_ref_name text,
  add column if not exists head_sha text;

-- A single checkpoint per (project, objective). Drop existing duplicates
-- before adding the constraint so the migration is idempotent on dev DBs.
delete from public.project_checkpoints t
using public.project_checkpoints u
where t.project_id = u.project_id
  and t.objective_id = u.objective_id
  and t.objective_id is not null
  and t.created_at < u.created_at;

create unique index if not exists project_checkpoints_project_objective_uniq
  on public.project_checkpoints (project_id, objective_id)
  where objective_id is not null;

-- ---- file_changes ---------------------------------------------------------
drop index if exists file_changes_checkpoint_id_idx;

alter table public.file_changes
  drop column if exists snapshot_backend,
  drop column if exists workspace_name,
  drop column if exists workspace_path,
  drop column if exists jj_change_id,
  drop column if exists jj_commit_id,
  drop column if exists jj_operation_id;

create index if not exists file_changes_checkpoint_id_idx
  on public.file_changes (checkpoint_id)
  where checkpoint_id is not null;

create index if not exists file_changes_file_path_idx
  on public.file_changes (file_path);

-- ---- project_user ---------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'project_user_local_version_control_check'
  ) then
    alter table public.project_user
      drop constraint project_user_local_version_control_check;
  end if;
end $$;

alter table public.project_user
  drop column if exists local_version_control,
  drop column if exists local_version_control_installed_at,
  drop column if exists local_version_control_error;
