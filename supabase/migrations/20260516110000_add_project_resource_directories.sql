-- Flexible per-(project, user, device) resource directories. Replaces the
-- single project_user.local_working_directory column over the migration
-- window. organization_id is intentionally omitted — it is fully determined
-- by project_id via the projects table.
create table public.project_resource_directories (
  id uuid default gen_random_uuid() primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  directory_path text not null,
  label text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id, device_id, directory_path)
);

-- Hot-path: agent flows filter by user_id, then match on path.
create index project_resource_directories_user_path_idx
  on public.project_resource_directories (user_id, directory_path);

-- "What dirs does this device have?"
create index project_resource_directories_device_idx
  on public.project_resource_directories (device_id)
  where device_id is not null;

create index project_resource_directories_project_idx
  on public.project_resource_directories (project_id);

alter table public.project_resource_directories enable row level security;

create policy "project_resource_directories_select_self_or_org_admin"
  on public.project_resource_directories for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.projects p
      where p.id = project_id
        and public.has_org_role(p.organization_id, ARRAY['ADMIN'::public.organization_role])
    )
  );

create policy "project_resource_directories_insert_self"
  on public.project_resource_directories for insert to authenticated
  with check (user_id = auth.uid());

create policy "project_resource_directories_update_self"
  on public.project_resource_directories for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "project_resource_directories_delete_self"
  on public.project_resource_directories for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.touch_project_resource_directories_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger project_resource_directories_set_updated_at
  before update on public.project_resource_directories
  for each row execute function public.touch_project_resource_directories_updated_at();
