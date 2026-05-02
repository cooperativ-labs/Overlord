create table public.project_tag_definitions (
  id uuid not null default gen_random_uuid(),
  project_id uuid not null,
  key text not null,
  label text not null,
  description text,
  color text,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

alter table public.project_tag_definitions enable row level security;

alter table public.project_tag_definitions
  add constraint project_tag_definitions_pkey primary key (id);

alter table public.project_tag_definitions
  add constraint project_tag_definitions_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete cascade;

alter table public.project_tag_definitions
  add constraint project_tag_definitions_key_check
  check (btrim(key) <> '' and key = lower(key));

alter table public.project_tag_definitions
  add constraint project_tag_definitions_label_check
  check (btrim(label) <> '');

alter table public.project_tag_definitions
  add constraint project_tag_definitions_color_check
  check (color is null or color ~ '^#([0-9A-Fa-f]{6})$'::text);

create unique index project_tag_definitions_project_id_key_key
  on public.project_tag_definitions using btree (project_id, key);

create unique index project_tag_definitions_project_id_label_key
  on public.project_tag_definitions using btree (project_id, label);

create index project_tag_definitions_project_id_idx
  on public.project_tag_definitions using btree (project_id);

create trigger set_project_tag_definitions_updated_at
before update on public.project_tag_definitions
for each row execute function public.set_updated_at();

create table public.ticket_tag_assignments (
  ticket_id uuid not null,
  tag_definition_id uuid not null,
  source text not null,
  applied_by uuid,
  applied_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

alter table public.ticket_tag_assignments enable row level security;

alter table public.ticket_tag_assignments
  add constraint ticket_tag_assignments_pkey primary key (ticket_id, tag_definition_id, source);

alter table public.ticket_tag_assignments
  add constraint ticket_tag_assignments_ticket_id_fkey
  foreign key (ticket_id) references public.tickets(id) on delete cascade;

alter table public.ticket_tag_assignments
  add constraint ticket_tag_assignments_tag_definition_id_fkey
  foreign key (tag_definition_id) references public.project_tag_definitions(id) on delete cascade;

alter table public.ticket_tag_assignments
  add constraint ticket_tag_assignments_applied_by_fkey
  foreign key (applied_by) references auth.users(id) on delete set null;

alter table public.ticket_tag_assignments
  add constraint ticket_tag_assignments_source_check
  check (source = any (array['user'::text, 'engine'::text]));

create index ticket_tag_assignments_ticket_id_idx
  on public.ticket_tag_assignments using btree (ticket_id);

create index ticket_tag_assignments_tag_definition_id_idx
  on public.ticket_tag_assignments using btree (tag_definition_id);

create index ticket_tag_assignments_ticket_id_source_idx
  on public.ticket_tag_assignments using btree (ticket_id, source);

create trigger set_ticket_tag_assignments_updated_at
before update on public.ticket_tag_assignments
for each row execute function public.set_updated_at();

create table public.ticket_tag_engine_suppressions (
  ticket_id uuid not null,
  tag_definition_id uuid not null,
  suppressed_by uuid,
  reason text not null default 'user_removed_engine_tag'::text,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

alter table public.ticket_tag_engine_suppressions enable row level security;

alter table public.ticket_tag_engine_suppressions
  add constraint ticket_tag_engine_suppressions_pkey primary key (ticket_id, tag_definition_id);

alter table public.ticket_tag_engine_suppressions
  add constraint ticket_tag_engine_suppressions_ticket_id_fkey
  foreign key (ticket_id) references public.tickets(id) on delete cascade;

alter table public.ticket_tag_engine_suppressions
  add constraint ticket_tag_engine_suppressions_tag_definition_id_fkey
  foreign key (tag_definition_id) references public.project_tag_definitions(id) on delete cascade;

alter table public.ticket_tag_engine_suppressions
  add constraint ticket_tag_engine_suppressions_suppressed_by_fkey
  foreign key (suppressed_by) references auth.users(id) on delete set null;

alter table public.ticket_tag_engine_suppressions
  add constraint ticket_tag_engine_suppressions_reason_check
  check (btrim(reason) <> '');

create index ticket_tag_engine_suppressions_ticket_id_idx
  on public.ticket_tag_engine_suppressions using btree (ticket_id);

create index ticket_tag_engine_suppressions_tag_definition_id_idx
  on public.ticket_tag_engine_suppressions using btree (tag_definition_id);

create trigger set_ticket_tag_engine_suppressions_updated_at
before update on public.ticket_tag_engine_suppressions
for each row execute function public.set_updated_at();

create or replace function public.ticket_tag_matches_ticket_project(p_ticket_id uuid, p_tag_definition_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.tickets t
    join public.project_tag_definitions ptd
      on ptd.project_id = t.project_id
    where t.id = p_ticket_id
      and ptd.id = p_tag_definition_id
      and t.project_id is not null
  );
$$;

create or replace function public.enforce_ticket_tag_project_scope()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.ticket_tag_matches_ticket_project(new.ticket_id, new.tag_definition_id) then
    raise exception 'Ticket tag rows must reference a tag definition from the same non-personal project ticket.';
  end if;

  return new;
end;
$$;

create trigger enforce_ticket_tag_assignments_project_scope
before insert or update on public.ticket_tag_assignments
for each row execute function public.enforce_ticket_tag_project_scope();

create trigger enforce_ticket_tag_engine_suppressions_project_scope
before insert or update on public.ticket_tag_engine_suppressions
for each row execute function public.enforce_ticket_tag_project_scope();

create policy "project_tag_definitions_select_member"
on public.project_tag_definitions
as permissive
for select
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = project_tag_definitions.project_id
      and public.is_org_member(projects.organization_id)
  )
);

create policy "project_tag_definitions_insert_manager_plus"
on public.project_tag_definitions
as permissive
for insert
to authenticated
with check (
  exists (
    select 1
    from public.projects
    where projects.id = project_tag_definitions.project_id
      and public.has_org_role(
        projects.organization_id,
        array['MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
  )
);

create policy "project_tag_definitions_update_manager_plus"
on public.project_tag_definitions
as permissive
for update
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = project_tag_definitions.project_id
      and public.has_org_role(
        projects.organization_id,
        array['MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
  )
)
with check (
  exists (
    select 1
    from public.projects
    where projects.id = project_tag_definitions.project_id
      and public.has_org_role(
        projects.organization_id,
        array['MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
  )
);

create policy "project_tag_definitions_delete_manager_plus"
on public.project_tag_definitions
as permissive
for delete
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = project_tag_definitions.project_id
      and public.has_org_role(
        projects.organization_id,
        array['MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
  )
);

create policy "ticket_tag_assignments_select_member"
on public.ticket_tag_assignments
as permissive
for select
to authenticated
using (public.can_access_ticket(ticket_id));

create policy "ticket_tag_assignments_insert_agent_plus"
on public.ticket_tag_assignments
as permissive
for insert
to authenticated
with check (
  public.can_write_ticket(ticket_id)
  and public.ticket_tag_matches_ticket_project(ticket_id, tag_definition_id)
);

create policy "ticket_tag_assignments_update_agent_plus"
on public.ticket_tag_assignments
as permissive
for update
to authenticated
using (public.can_write_ticket(ticket_id))
with check (
  public.can_write_ticket(ticket_id)
  and public.ticket_tag_matches_ticket_project(ticket_id, tag_definition_id)
);

create policy "ticket_tag_assignments_delete_agent_plus"
on public.ticket_tag_assignments
as permissive
for delete
to authenticated
using (public.can_write_ticket(ticket_id));

create policy "ticket_tag_engine_suppressions_select_member"
on public.ticket_tag_engine_suppressions
as permissive
for select
to authenticated
using (public.can_access_ticket(ticket_id));

create policy "ticket_tag_engine_suppressions_insert_agent_plus"
on public.ticket_tag_engine_suppressions
as permissive
for insert
to authenticated
with check (
  public.can_write_ticket(ticket_id)
  and public.ticket_tag_matches_ticket_project(ticket_id, tag_definition_id)
);

create policy "ticket_tag_engine_suppressions_update_agent_plus"
on public.ticket_tag_engine_suppressions
as permissive
for update
to authenticated
using (public.can_write_ticket(ticket_id))
with check (
  public.can_write_ticket(ticket_id)
  and public.ticket_tag_matches_ticket_project(ticket_id, tag_definition_id)
);

create policy "ticket_tag_engine_suppressions_delete_agent_plus"
on public.ticket_tag_engine_suppressions
as permissive
for delete
to authenticated
using (public.can_write_ticket(ticket_id));
