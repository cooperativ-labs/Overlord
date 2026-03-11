create table "public"."change_rationales" (
  "id" uuid not null default gen_random_uuid(),
  "organization_id" integer not null,
  "project_id" uuid not null,
  "ticket_id" uuid not null,
  "session_id" uuid not null,
  "event_id" uuid not null,
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

alter table "public"."change_rationales" enable row level security;

alter table "public"."change_rationales"
  add constraint "change_rationales_pkey" primary key ("id");

alter table "public"."change_rationales"
  add constraint "change_rationales_event_id_fkey"
  foreign key ("event_id") references "public"."ticket_events"("id") on delete cascade;

alter table "public"."change_rationales"
  add constraint "change_rationales_organization_id_fkey"
  foreign key ("organization_id") references "public"."organizations"("id") on delete cascade;

alter table "public"."change_rationales"
  add constraint "change_rationales_project_id_fkey"
  foreign key ("project_id") references "public"."projects"("id") on delete cascade;

alter table "public"."change_rationales"
  add constraint "change_rationales_session_id_fkey"
  foreign key ("session_id") references "public"."agent_sessions"("id") on delete cascade;

alter table "public"."change_rationales"
  add constraint "change_rationales_ticket_id_fkey"
  foreign key ("ticket_id") references "public"."tickets"("id") on delete cascade;

create index "change_rationales_project_file_idx"
  on "public"."change_rationales" using btree ("project_id", "file_path");

create index "change_rationales_ticket_id_idx"
  on "public"."change_rationales" using btree ("ticket_id");

create index "change_rationales_event_id_idx"
  on "public"."change_rationales" using btree ("event_id");

create index "change_rationales_session_id_idx"
  on "public"."change_rationales" using btree ("session_id");

create trigger set_change_rationales_updated_at
before update on public.change_rationales
for each row execute function public.set_updated_at();

create policy "change_rationales_select_member"
on "public"."change_rationales"
as permissive
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "change_rationales_insert_agent_plus"
on "public"."change_rationales"
as permissive
for insert
to authenticated
with check (
  public.has_org_role(
    organization_id,
    array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
  )
);

create policy "change_rationales_update_agent_plus"
on "public"."change_rationales"
as permissive
for update
to authenticated
using (
  public.has_org_role(
    organization_id,
    array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
  )
)
with check (
  public.has_org_role(
    organization_id,
    array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
  )
);

create policy "change_rationales_delete_agent_plus"
on "public"."change_rationales"
as permissive
for delete
to authenticated
using (
  public.has_org_role(
    organization_id,
    array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
  )
);
