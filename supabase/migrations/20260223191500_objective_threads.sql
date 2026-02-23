create table "public"."objectives" (
  "id" uuid not null default gen_random_uuid(),
  "ticket_id" uuid not null,
  "objective" text not null default ''::text,
  "is_executed" boolean not null default false,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
  "updated_at" timestamp with time zone not null default timezone('utc'::text, now())
);

alter table "public"."objectives" enable row level security;

create unique index objectives_pkey on public.objectives using btree (id);
create index objectives_ticket_created_idx on public.objectives using btree (ticket_id, created_at desc);
create index objectives_ticket_is_executed_idx on public.objectives using btree (ticket_id, is_executed);

alter table "public"."objectives" add constraint "objectives_pkey" primary key using index "objectives_pkey";
alter table "public"."objectives"
  add constraint "objectives_ticket_id_fkey"
  foreign key (ticket_id) references public.tickets(id) on delete cascade not valid;
alter table "public"."objectives" validate constraint "objectives_ticket_id_fkey";

grant delete on table "public"."objectives" to "anon";
grant insert on table "public"."objectives" to "anon";
grant references on table "public"."objectives" to "anon";
grant select on table "public"."objectives" to "anon";
grant trigger on table "public"."objectives" to "anon";
grant truncate on table "public"."objectives" to "anon";
grant update on table "public"."objectives" to "anon";

grant delete on table "public"."objectives" to "authenticated";
grant insert on table "public"."objectives" to "authenticated";
grant references on table "public"."objectives" to "authenticated";
grant select on table "public"."objectives" to "authenticated";
grant trigger on table "public"."objectives" to "authenticated";
grant truncate on table "public"."objectives" to "authenticated";
grant update on table "public"."objectives" to "authenticated";

grant delete on table "public"."objectives" to "service_role";
grant insert on table "public"."objectives" to "service_role";
grant references on table "public"."objectives" to "service_role";
grant select on table "public"."objectives" to "service_role";
grant trigger on table "public"."objectives" to "service_role";
grant truncate on table "public"."objectives" to "service_role";
grant update on table "public"."objectives" to "service_role";

create policy "objectives_delete_manager_plus"
on "public"."objectives"
as permissive
for delete
to authenticated
using (
  exists (
    select 1
    from public.tickets t
    where t.id = objectives.ticket_id
      and public.has_org_role(
        t.organization_id,
        array['MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
  )
);

create policy "objectives_insert_agent_plus"
on "public"."objectives"
as permissive
for insert
to authenticated
with check (
  exists (
    select 1
    from public.tickets t
    where t.id = objectives.ticket_id
      and public.has_org_role(
        t.organization_id,
        array[
          'AGENT'::public.organization_role,
          'MANAGER'::public.organization_role,
          'ADMIN'::public.organization_role
        ]
      )
  )
);

create policy "objectives_select_member"
on "public"."objectives"
as permissive
for select
to authenticated
using (
  exists (
    select 1
    from public.tickets t
    where t.id = objectives.ticket_id
      and public.is_org_member(t.organization_id)
  )
);

create policy "objectives_update_agent_plus"
on "public"."objectives"
as permissive
for update
to authenticated
using (
  exists (
    select 1
    from public.tickets t
    where t.id = objectives.ticket_id
      and public.has_org_role(
        t.organization_id,
        array[
          'AGENT'::public.organization_role,
          'MANAGER'::public.organization_role,
          'ADMIN'::public.organization_role
        ]
      )
  )
)
with check (
  exists (
    select 1
    from public.tickets t
    where t.id = objectives.ticket_id
      and public.has_org_role(
        t.organization_id,
        array[
          'AGENT'::public.organization_role,
          'MANAGER'::public.organization_role,
          'ADMIN'::public.organization_role
        ]
      )
  )
);

create trigger set_objectives_updated_at
before update on public.objectives
for each row execute function public.set_updated_at();

insert into public.objectives (ticket_id, objective, is_executed)
select t.id, coalesce(t.objective, ''), false
from public.tickets t
where not exists (
  select 1
  from public.objectives o
  where o.ticket_id = t.id
);
