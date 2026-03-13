-- SSH server profiles for cloud agent execution.
-- Users configure remote servers here; Overlord SSHs in and starts agents
-- in a named tmux session that the user can attach to via Termius or any
-- SSH client.

create table if not exists "public"."ssh_server_profiles" (
  "id"                uuid                     not null default gen_random_uuid(),
  "organization_id"   integer                  not null references "public"."organizations"("id") on delete cascade,
  "created_by"        uuid                     not null references auth.users("id") on delete cascade,
  "name"              text                     not null,
  "host"              text                     not null,
  "port"              integer                  not null default 22,
  "username"          text                     not null,
  -- Private key stored as PEM text. Encrypt at rest in production using
  -- pgcrypto or a secrets manager before storing sensitive keys.
  "private_key"       text                     not null,
  "working_directory" text                     not null default '/home',
  "last_tested_at"    timestamp with time zone,
  "created_at"        timestamp with time zone not null default now(),
  "updated_at"        timestamp with time zone not null default now(),
  constraint "ssh_server_profiles_pkey" primary key ("id")
);

alter table "public"."ssh_server_profiles" enable row level security;

create index if not exists "ssh_server_profiles_org_idx"
  on "public"."ssh_server_profiles" ("organization_id");

create index if not exists "ssh_server_profiles_created_by_idx"
  on "public"."ssh_server_profiles" ("created_by");

-- Org members can view all profiles in their org.
create policy "ssh_server_profiles_select"
  on "public"."ssh_server_profiles"
  as permissive
  for select
  to authenticated
  using (public.is_org_member(organization_id));

-- Any org member can create a profile (scoped to their org, owned by them).
create policy "ssh_server_profiles_insert"
  on "public"."ssh_server_profiles"
  as permissive
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_org_member(organization_id)
  );

-- Only the creator can update their profile.
create policy "ssh_server_profiles_update"
  on "public"."ssh_server_profiles"
  as permissive
  for update
  to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

-- Only the creator can delete their profile.
create policy "ssh_server_profiles_delete"
  on "public"."ssh_server_profiles"
  as permissive
  for delete
  to authenticated
  using (created_by = (select auth.uid()));
