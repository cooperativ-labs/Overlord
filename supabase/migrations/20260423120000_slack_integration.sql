-- Slack integration: workspaces, event dedupe, ticket source tracking

-- Store one row per (Overlord user, Slack workspace) install
create table "public"."slack_workspaces" (
  "id"                        uuid        primary key default gen_random_uuid(),
  "user_id"                   uuid        not null references auth.users(id) on delete cascade,
  "organization_id"           integer     not null references organizations(id) on delete cascade,
  "team_id"                   text        not null,
  "team_name"                 text        not null,
  "bot_user_id"               text        not null,
  "bot_access_token"          text        not null,
  "slack_user_id"             text        not null,
  "default_project_id"        uuid        references projects(id) on delete set null,
  "default_status"            text        not null default 'next-up',
  "default_priority"          text        not null default 'medium',
  "default_execution_target"  public.ticket_execution_target not null default 'human',
  "include_context"           boolean     not null default true,
  "restrict_to_owner"         boolean     not null default true,
  "created_at"                timestamptz not null default now(),
  "updated_at"                timestamptz not null default now(),
  unique(user_id, team_id)
);

alter table "public"."slack_workspaces" enable row level security;

create policy "slack_workspaces_select"
  on "public"."slack_workspaces" for select
  using (user_id = auth.uid());

create policy "slack_workspaces_update"
  on "public"."slack_workspaces" for update
  using (user_id = auth.uid());

create policy "slack_workspaces_delete"
  on "public"."slack_workspaces" for delete
  using (user_id = auth.uid());

-- Deduplication table: prevents processing Slack retry deliveries twice
create table "public"."slack_event_dedupe" (
  "event_id"    text        primary key,
  "received_at" timestamptz not null default now()
);

-- Add source tracking columns to tickets
alter table "public"."tickets"
  add column "source"             text null,
  add column "slack_workspace_id" uuid null references slack_workspaces(id) on delete set null,
  add column "slack_channel_id"   text null,
  add column "slack_thread_ts"    text null;

-- Per-project default status for Slack-created tickets (overrides workspace default)
alter table "public"."projects"
  add column "slack_default_status" text null;

-- Index to speed up thread-based ticket lookups
create index on "public"."tickets" (slack_workspace_id, slack_thread_ts)
  where slack_thread_ts is not null;
