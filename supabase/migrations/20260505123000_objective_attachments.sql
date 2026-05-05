create table if not exists "public"."objective_attachments" (
  "id" uuid not null default gen_random_uuid(),
  "ticket_id" uuid not null,
  "objective_id" uuid not null,
  "label" text not null,
  "storage_path" text not null,
  "content_type" text not null default 'application/octet-stream'::text,
  "file_size" bigint not null default 0,
  "metadata" jsonb not null default '{}'::jsonb,
  "session_id" uuid,
  "created_by" uuid references auth.users(id) on delete set null,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now())
);

alter table "public"."objective_attachments" enable row level security;

create unique index if not exists objective_attachments_pkey
  on public.objective_attachments using btree (id);

create unique index if not exists objective_attachments_storage_path_key
  on public.objective_attachments using btree (storage_path);

create index if not exists objective_attachments_ticket_objective_created_idx
  on public.objective_attachments using btree (ticket_id, objective_id, created_at desc);

create unique index if not exists objectives_id_ticket_id_key
  on public.objectives using btree (id, ticket_id);

alter table "public"."objective_attachments"
  add constraint "objective_attachments_pkey" primary key using index "objective_attachments_pkey";

alter table "public"."objective_attachments"
  add constraint "objective_attachments_ticket_id_fkey"
  foreign key (ticket_id) references public.tickets(id) on delete cascade not valid;

alter table "public"."objective_attachments" validate constraint "objective_attachments_ticket_id_fkey";

alter table "public"."objective_attachments"
  add constraint "objective_attachments_objective_id_fkey"
  foreign key (objective_id) references public.objectives(id) on delete cascade not valid;

alter table "public"."objective_attachments" validate constraint "objective_attachments_objective_id_fkey";

alter table "public"."objective_attachments"
  add constraint "objective_attachments_objective_ticket_fkey"
  foreign key (objective_id, ticket_id) references public.objectives(id, ticket_id) on delete cascade not valid;

alter table "public"."objective_attachments" validate constraint "objective_attachments_objective_ticket_fkey";

alter table "public"."objective_attachments"
  add constraint "objective_attachments_session_id_fkey"
  foreign key (session_id) references public.agent_sessions(id) on delete set null not valid;

alter table "public"."objective_attachments" validate constraint "objective_attachments_session_id_fkey";

grant select, insert, update, delete on table "public"."objective_attachments" to "authenticated";
grant select, insert, update, delete on table "public"."objective_attachments" to "service_role";

create policy "objective_attachments_select_member"
on "public"."objective_attachments"
as permissive
for select
to authenticated
using (
  exists (
    select 1
    from public.tickets t
    where t.id = objective_attachments.ticket_id
      and public.is_org_member(t.organization_id)
  )
);

create policy "objective_attachments_insert_agent_plus"
on "public"."objective_attachments"
as permissive
for insert
to authenticated
with check (
  exists (
    select 1
    from public.tickets t
    where t.id = objective_attachments.ticket_id
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

create policy "objective_attachments_update_agent_plus"
on "public"."objective_attachments"
as permissive
for update
to authenticated
using (
  exists (
    select 1
    from public.tickets t
    where t.id = objective_attachments.ticket_id
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
    where t.id = objective_attachments.ticket_id
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

create policy "objective_attachments_delete_manager_plus"
on "public"."objective_attachments"
as permissive
for delete
to authenticated
using (
  exists (
    select 1
    from public.tickets t
    where t.id = objective_attachments.ticket_id
      and public.has_org_role(
        t.organization_id,
        array['MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
  )
);
