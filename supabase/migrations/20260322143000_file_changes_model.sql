drop table if exists public.change_rationales cascade;

create table "public"."file_changes" (
  "id" uuid not null default gen_random_uuid(),
  "ticket_id" uuid not null,
  "session_id" uuid not null,
  "event_id" uuid not null,
  "file_name" text not null,
  "file_path" text not null,
  "label" text not null,
  "summary" text not null,
  "why" text not null,
  "impact" text not null,
  "change_kind" text not null default 'modify'::text,
  "attribution_source" text not null default 'explicit'::text,
  "confidence" text not null default 'explicit'::text,
  "hunks" jsonb not null default '[]'::jsonb,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
  "updated_at" timestamp with time zone not null default timezone('utc'::text, now())
);

alter table "public"."file_changes" enable row level security;

alter table "public"."file_changes"
  add constraint "file_changes_pkey" primary key ("id");

alter table "public"."file_changes"
  add constraint "file_changes_event_id_fkey"
  foreign key ("event_id") references "public"."ticket_events"("id") on delete cascade;

alter table "public"."file_changes"
  add constraint "file_changes_session_id_fkey"
  foreign key ("session_id") references "public"."agent_sessions"("id") on delete cascade;

alter table "public"."file_changes"
  add constraint "file_changes_ticket_id_fkey"
  foreign key ("ticket_id") references "public"."tickets"("id") on delete cascade;

create index "file_changes_ticket_id_idx"
  on "public"."file_changes" using btree ("ticket_id");

create index "file_changes_session_id_idx"
  on "public"."file_changes" using btree ("session_id");

create index "file_changes_event_id_idx"
  on "public"."file_changes" using btree ("event_id");

create index "file_changes_ticket_file_idx"
  on "public"."file_changes" using btree ("ticket_id", "file_path");

create trigger set_file_changes_updated_at
before update on public.file_changes
for each row execute function public.set_updated_at();

create policy "file_changes_select"
on "public"."file_changes"
as permissive
for select
to authenticated
using (
  exists (
    select 1
    from public.tickets
    where tickets.id = file_changes.ticket_id
      and public.is_org_member(tickets.organization_id)
  )
);

create policy "file_changes_insert"
on "public"."file_changes"
as permissive
for insert
to authenticated
with check (
  exists (
    select 1
    from public.tickets
    where tickets.id = file_changes.ticket_id
      and public.has_org_role(
        tickets.organization_id,
        array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
  )
);

create policy "file_changes_update"
on "public"."file_changes"
as permissive
for update
to authenticated
using (
  exists (
    select 1
    from public.tickets
    where tickets.id = file_changes.ticket_id
      and public.has_org_role(
        tickets.organization_id,
        array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
  )
)
with check (
  exists (
    select 1
    from public.tickets
    where tickets.id = file_changes.ticket_id
      and public.has_org_role(
        tickets.organization_id,
        array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
  )
);

create policy "file_changes_delete"
on "public"."file_changes"
as permissive
for delete
to authenticated
using (
  exists (
    select 1
    from public.tickets
    where tickets.id = file_changes.ticket_id
      and public.has_org_role(
        tickets.organization_id,
        array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
  )
);

alter publication supabase_realtime add table public.file_changes;
