-- Target-ownership-aware write authority for project resource directories.
--
-- The single predicate (mirrored in application code, which is the real gate
-- since write paths use the service-role client):
--
--   can_manage(user, project, target):
--     oet = organization_execution_targets[project.org, target]
--     if oet.owner_user_id is not null: user == oet.owner_user_id   (personal target)
--     else:                             has_org_role(org, ADMIN|MANAGER) (org-owned)

create or replace function public.can_manage_project_resource_directory(
  p_project_id uuid,
  p_execution_target_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_org_id integer;
  v_owner uuid;
begin
  select organization_id into v_org_id
  from public.projects
  where id = p_project_id;

  if v_org_id is null then
    return false;
  end if;

  select owner_user_id into v_owner
  from public.organization_execution_targets
  where organization_id = v_org_id
    and execution_target_id = p_execution_target_id;

  -- Personal target: only the owner may manage.
  if found and v_owner is not null then
    return v_owner = (select auth.uid());
  end if;

  -- Organization-owned target (owner null) or no association yet:
  -- require project edit permission.
  return public.has_org_role(
    v_org_id,
    ARRAY['ADMIN'::public.organization_role, 'MANAGER'::public.organization_role]
  );
end;
$$;

-- Broaden visibility: any member of the project's org can SELECT the directories
-- (and therefore see the shared primary), not just the row's author or an admin.
drop policy if exists "project_resource_directories_select_self_or_org_admin"
  on public.project_resource_directories;

create policy "project_resource_directories_select_org_member"
  on public.project_resource_directories for select to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and public.is_org_member(p.organization_id)
    )
  );

-- Replace the self-scoped write policies with the ownership-aware predicate.
drop policy if exists "project_resource_directories_insert_self"
  on public.project_resource_directories;
drop policy if exists "project_resource_directories_update_self"
  on public.project_resource_directories;
drop policy if exists "project_resource_directories_delete_self"
  on public.project_resource_directories;

create policy "project_resource_directories_insert_manage"
  on public.project_resource_directories for insert to authenticated
  with check (public.can_manage_project_resource_directory(project_id, execution_target_id));

create policy "project_resource_directories_update_manage"
  on public.project_resource_directories for update to authenticated
  using (public.can_manage_project_resource_directory(project_id, execution_target_id))
  with check (public.can_manage_project_resource_directory(project_id, execution_target_id));

create policy "project_resource_directories_delete_manage"
  on public.project_resource_directories for delete to authenticated
  using (public.can_manage_project_resource_directory(project_id, execution_target_id));
