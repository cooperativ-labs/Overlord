alter table public.tickets
  alter column project_id drop not null;

alter table public.tickets
  drop constraint if exists tickets_project_org_fkey;

alter table public.tickets
  add constraint tickets_project_org_fkey
  foreign key (project_id, organization_id)
  references public.projects(id, organization_id)
  on update cascade
  on delete set null
  not valid;

alter table public.tickets
  validate constraint tickets_project_org_fkey;

create or replace function public.can_access_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.tickets t
    where t.id = p_ticket_id
      and (
        (t.project_id is null and t.created_by = (select auth.uid()))
        or (t.project_id is not null and public.is_org_member(t.organization_id))
      )
  );
$$;

create or replace function public.can_write_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.tickets t
    where t.id = p_ticket_id
      and public.has_org_role(
        t.organization_id,
        array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
      and (
        t.project_id is not null
        or t.created_by = (select auth.uid())
      )
  );
$$;

create or replace function public.is_ticket_org_member(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.can_access_ticket(p_ticket_id);
$$;

drop policy if exists "tickets_insert_agent_plus" on public.tickets;
drop policy if exists "tickets_select_member" on public.tickets;
drop policy if exists "tickets_update_agent_plus" on public.tickets;
drop policy if exists "tickets_delete_manager_plus" on public.tickets;

create policy "tickets_insert_agent_plus"
on public.tickets
as permissive
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (
    (project_id is null and public.is_org_member(organization_id))
    or (
      project_id is not null
      and public.has_org_role(
        organization_id,
        array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
    )
  )
);

create policy "tickets_select_member"
on public.tickets
as permissive
for select
to authenticated
using (
  (project_id is null and created_by = (select auth.uid()))
  or (project_id is not null and public.is_org_member(organization_id))
);

create policy "tickets_update_agent_plus"
on public.tickets
as permissive
for update
to authenticated
using (
  (
    project_id is null
    and created_by = (select auth.uid())
    and public.is_org_member(organization_id)
  )
  or (
    project_id is not null
    and public.has_org_role(
      organization_id,
      array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
    )
  )
)
with check (
  (
    project_id is null
    and created_by = (select auth.uid())
    and public.is_org_member(organization_id)
  )
  or (
    project_id is not null
    and public.has_org_role(
      organization_id,
      array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
    )
  )
);

create policy "tickets_delete_manager_plus"
on public.tickets
as permissive
for delete
to authenticated
using (
  (project_id is null and created_by = (select auth.uid()))
  or (
    project_id is not null
    and public.has_org_role(
      organization_id,
      array['MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
    )
  )
);

drop policy if exists "objectives_select_member" on public.objectives;
drop policy if exists "objectives_insert_agent_plus" on public.objectives;
drop policy if exists "objectives_update_agent_plus" on public.objectives;
drop policy if exists "objectives_delete_manager_plus" on public.objectives;

create policy "objectives_select_member"
on public.objectives
as permissive
for select
to authenticated
using (public.can_access_ticket(ticket_id));

create policy "objectives_insert_agent_plus"
on public.objectives
as permissive
for insert
to authenticated
with check (public.can_write_ticket(ticket_id));

create policy "objectives_update_agent_plus"
on public.objectives
as permissive
for update
to authenticated
using (public.can_write_ticket(ticket_id))
with check (public.can_write_ticket(ticket_id));

create policy "objectives_delete_manager_plus"
on public.objectives
as permissive
for delete
to authenticated
using (public.can_write_ticket(ticket_id));
