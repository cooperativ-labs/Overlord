create table public.agent_transcript_events (
  id uuid not null default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  session_id uuid not null references public.agent_sessions(id) on delete cascade,
  promoted_event_id uuid references public.ticket_events(id) on delete set null,
  event_hash text not null,
  event_source text not null,
  external_session_id text,
  source_path text,
  parser_version text not null default 'transcript-v1',
  event_time timestamptz not null,
  event_kind text not null,
  actor text,
  tool_name text,
  file_path text,
  command_preview text,
  summary text,
  evidence jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  high_signal boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint agent_transcript_events_pkey primary key (id),
  constraint agent_transcript_events_session_hash_key unique (session_id, event_hash)
);

create index agent_transcript_events_ticket_time_idx
  on public.agent_transcript_events (ticket_id, event_time desc);

create index agent_transcript_events_session_time_idx
  on public.agent_transcript_events (session_id, event_time desc);

create index agent_transcript_events_ticket_file_idx
  on public.agent_transcript_events (ticket_id, file_path)
  where file_path is not null;

create trigger set_agent_transcript_events_updated_at
before update on public.agent_transcript_events
for each row execute function public.set_updated_at();

alter table public.agent_transcript_events enable row level security;

create policy "agent_transcript_events_select"
on public.agent_transcript_events
as permissive
for select
to authenticated
using (
  exists (
    select 1
    from public.tickets
    where tickets.id = agent_transcript_events.ticket_id
      and public.is_org_member(tickets.organization_id)
  )
);

create policy "agent_transcript_events_insert"
on public.agent_transcript_events
as permissive
for insert
to authenticated
with check (
  exists (
    select 1
    from public.tickets
    where tickets.id = agent_transcript_events.ticket_id
      and public.has_org_role(
        tickets.organization_id,
        array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
  )
);

create policy "agent_transcript_events_update"
on public.agent_transcript_events
as permissive
for update
to authenticated
using (
  exists (
    select 1
    from public.tickets
    where tickets.id = agent_transcript_events.ticket_id
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
    where tickets.id = agent_transcript_events.ticket_id
      and public.has_org_role(
        tickets.organization_id,
        array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
  )
);

create table public.change_rationale_drafts (
  id uuid not null default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  session_id uuid not null references public.agent_sessions(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  label text not null,
  summary text not null,
  why text not null,
  impact text not null,
  change_kind text not null default 'modify',
  attribution_source text not null default 'transcript_draft',
  confidence text not null default 'medium',
  hunks jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  source_event_hashes text[] not null default '{}'::text[],
  status text not null default 'draft',
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint change_rationale_drafts_pkey primary key (id),
  constraint change_rationale_drafts_session_file_status_key unique (session_id, file_path, status)
);

create index change_rationale_drafts_ticket_file_idx
  on public.change_rationale_drafts (ticket_id, file_path);

create index change_rationale_drafts_session_idx
  on public.change_rationale_drafts (session_id);

create trigger set_change_rationale_drafts_updated_at
before update on public.change_rationale_drafts
for each row execute function public.set_updated_at();

alter table public.change_rationale_drafts enable row level security;

create policy "change_rationale_drafts_select"
on public.change_rationale_drafts
as permissive
for select
to authenticated
using (
  exists (
    select 1
    from public.tickets
    where tickets.id = change_rationale_drafts.ticket_id
      and public.is_org_member(tickets.organization_id)
  )
);

create policy "change_rationale_drafts_insert"
on public.change_rationale_drafts
as permissive
for insert
to authenticated
with check (
  exists (
    select 1
    from public.tickets
    where tickets.id = change_rationale_drafts.ticket_id
      and public.has_org_role(
        tickets.organization_id,
        array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
  )
);

create policy "change_rationale_drafts_update"
on public.change_rationale_drafts
as permissive
for update
to authenticated
using (
  exists (
    select 1
    from public.tickets
    where tickets.id = change_rationale_drafts.ticket_id
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
    where tickets.id = change_rationale_drafts.ticket_id
      and public.has_org_role(
        tickets.organization_id,
        array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
      )
  )
);

alter publication supabase_realtime add table public.change_rationale_drafts;
