-- project_resource_directories is now the source of truth for project checkout
-- paths. Primary directories are target-scoped by
-- project_resource_directories_primary_target_uidx.

drop index if exists public.project_user_local_working_directory_idx;

alter table public.project_user
  drop column if exists local_working_directory;
