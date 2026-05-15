-- Backfill project_resource_directories from existing
-- project_user.local_working_directory values. device_id is left NULL since
-- the legacy column was machine-implicit. is_primary defaults to true so the
-- backfilled row is the canonical entry for that (project, user) pair.
insert into public.project_resource_directories (
  project_id,
  user_id,
  device_id,
  directory_path,
  is_primary
)
select
  pu.project_id,
  pu.user_id,
  null::uuid,
  pu.local_working_directory,
  true
from public.project_user pu
where pu.local_working_directory is not null
  and length(trim(pu.local_working_directory)) > 0
  and not exists (
    select 1 from public.project_resource_directories prd
    where prd.project_id = pu.project_id
      and prd.user_id = pu.user_id
      and prd.device_id is null
      and prd.directory_path = pu.local_working_directory
  );
