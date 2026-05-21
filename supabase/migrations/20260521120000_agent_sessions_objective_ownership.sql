-- Migration: Move agent_sessions ownership from tickets to objectives
-- agent_sessions.objective_id replaces agent_sessions.ticket_id
-- Drop session_id from objective-level tables (artifacts, feed_posts, objective_attachments, shared_state, ticket_events)
-- Keep session_id on file_changes, project_checkpoints, execution_requests

-- ============================================================
-- 1. Add objective_id to agent_sessions
-- ============================================================

alter table public.agent_sessions
  add column objective_id uuid references public.objectives(id) on delete cascade;

-- Backfill from child tables that already have both session_id and objective_id
with child_objectives as (
  -- file_changes: session_id -> objective_id
  select distinct fc.session_id, fc.objective_id
  from public.file_changes fc
  where fc.objective_id is not null

  union

  -- project_checkpoints: session_id -> objective_id
  select distinct pc.session_id, pc.objective_id
  from public.project_checkpoints pc
  where pc.session_id is not null and pc.objective_id is not null

  union

  -- objective_attachments: session_id -> objective_id
  select distinct oa.session_id, oa.objective_id
  from public.objective_attachments oa
  where oa.session_id is not null

  union

  -- ticket_events: session_id -> objective_id
  select distinct te.session_id, te.objective_id
  from public.ticket_events te
  where te.session_id is not null and te.objective_id is not null

  union

  -- feed_posts: session_id -> objective_id
  select distinct fp.session_id, fp.objective_id
  from public.feed_posts fp
  where fp.session_id is not null and fp.objective_id is not null

  union

  -- execution_requests: launched_session_id -> objective_id
  select distinct er.launched_session_id as session_id, er.objective_id
  from public.execution_requests er
  where er.launched_session_id is not null
),
-- Deduplicate: prefer the executing objective, then most recently updated
ranked as (
  select
    co.session_id,
    co.objective_id,
    row_number() over (
      partition by co.session_id
      order by
        case when o.state = 'executing' then 0
             when o.state = 'submitted' then 1
             when o.state = 'complete' then 2
             else 3 end,
        o.updated_at desc nulls last,
        o.id desc
    ) as rn
  from child_objectives co
  join public.objectives o on o.id = co.objective_id
)
update public.agent_sessions s
set objective_id = r.objective_id
from ranked r
where r.session_id = s.id
  and r.rn = 1
  and s.objective_id is null;

-- Fallback: for sessions not mapped by child data, use ticket_id to find the best objective
update public.agent_sessions s
set objective_id = sub.objective_id
from (
  select
    s2.id as session_id,
    o.id as objective_id,
    row_number() over (
      partition by s2.id
      order by
        case when o.state = 'executing' then 0
             when o.state = 'submitted' then 1
             when o.state = 'complete' then 2
             else 3 end,
        o.updated_at desc nulls last,
        o.id desc
    ) as rn
  from public.agent_sessions s2
  join public.objectives o on o.ticket_id = s2.ticket_id
  where s2.objective_id is null
) sub
where sub.session_id = s.id
  and sub.rn = 1;

-- Delete old orphan sessions that cannot be linked to any objective. Recent
-- unmapped sessions should still fail loudly so active work is not lost.
delete from public.agent_sessions
where objective_id is null
  and created_at < now() - interval '14 days';

do $$
declare
  recent_unmapped_count integer;
begin
  select count(*)
  into recent_unmapped_count
  from public.agent_sessions
  where objective_id is null;

  if recent_unmapped_count > 0 then
    raise exception 'agent_sessions objective_id backfill left % recent sessions unmapped', recent_unmapped_count;
  end if;
end $$;

-- Make objective_id NOT NULL
alter table public.agent_sessions
  alter column objective_id set not null;

-- Add indexes
create index agent_sessions_objective_id_idx
  on public.agent_sessions(objective_id);

create index agent_sessions_objective_attached_idx
  on public.agent_sessions(objective_id, attached_at desc);

-- Drop old RLS policies before dropping ticket_id
drop policy if exists "agent_sessions_select" on public.agent_sessions;
drop policy if exists "agent_sessions_insert" on public.agent_sessions;
drop policy if exists "agent_sessions_update" on public.agent_sessions;
drop policy if exists "agent_sessions_delete" on public.agent_sessions;
drop policy if exists "agent_sessions_select_local" on public.agent_sessions;
drop policy if exists "agent_sessions_insert_local" on public.agent_sessions;
drop policy if exists "agent_sessions_update_local" on public.agent_sessions;
drop policy if exists "agent_sessions_delete_local" on public.agent_sessions;

-- Drop old ticket_id FK and column
alter table public.agent_sessions
  drop constraint if exists agent_sessions_ticket_id_fkey;

drop index if exists agent_sessions_ticket_id_idx;

alter table public.agent_sessions
  drop column ticket_id;

-- ============================================================
-- 2. Rewrite agent_sessions RLS policies through objectives
-- ============================================================

create policy "agent_sessions_select"
  on public.agent_sessions for select to authenticated
  using (
    exists (
      select 1
      from public.objectives o
      join public.tickets t on t.id = o.ticket_id
      where o.id = agent_sessions.objective_id
        and public.is_org_member(t.organization_id)
    )
  );

create policy "agent_sessions_insert"
  on public.agent_sessions for insert to authenticated
  with check (
    exists (
      select 1
      from public.objectives o
      join public.tickets t on t.id = o.ticket_id
      where o.id = agent_sessions.objective_id
        and public.has_org_role(
          t.organization_id,
          array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
        )
    )
  );

create policy "agent_sessions_update"
  on public.agent_sessions for update to authenticated
  using (
    exists (
      select 1
      from public.objectives o
      join public.tickets t on t.id = o.ticket_id
      where o.id = agent_sessions.objective_id
        and public.has_org_role(
          t.organization_id,
          array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
        )
    )
  )
  with check (
    exists (
      select 1
      from public.objectives o
      join public.tickets t on t.id = o.ticket_id
      where o.id = agent_sessions.objective_id
        and public.has_org_role(
          t.organization_id,
          array['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
        )
    )
  );

create policy "agent_sessions_delete"
  on public.agent_sessions for delete to authenticated
  using (
    exists (
      select 1
      from public.objectives o
      join public.tickets t on t.id = o.ticket_id
      where o.id = agent_sessions.objective_id
        and public.has_org_role(
          t.organization_id,
          array['MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
        )
    )
  );

-- ============================================================
-- 3. artifacts: add objective_id, backfill, drop session_id
-- ============================================================

alter table public.artifacts
  add column if not exists objective_id uuid references public.objectives(id) on delete set null;

-- Backfill from ticket_events.objective_id via event_id
update public.artifacts a
set objective_id = te.objective_id
from public.ticket_events te
where a.event_id = te.id
  and te.objective_id is not null
  and a.objective_id is null;

-- Backfill remaining from agent_sessions.objective_id via session_id
update public.artifacts a
set objective_id = s.objective_id
from public.agent_sessions s
where a.session_id = s.id
  and a.objective_id is null;

create index if not exists artifacts_objective_id_idx
  on public.artifacts(objective_id)
  where objective_id is not null;

alter table public.artifacts
  drop constraint if exists artifacts_session_id_fkey;

drop index if exists artifacts_session_id_idx;

alter table public.artifacts
  drop column if exists session_id;

-- ============================================================
-- 4. feed_posts: add source_objective_id, drop session_id and source_session_ids
-- ============================================================

alter table public.feed_posts
  add column if not exists source_objective_id uuid references public.objectives(id) on delete set null;

-- Backfill source_objective_id from objective_id (self-reference for ticket-level rollups)
update public.feed_posts
set source_objective_id = objective_id
where source_objective_id is null
  and objective_id is not null;

-- Backfill remaining from session_id -> agent_sessions.objective_id
update public.feed_posts fp
set source_objective_id = s.objective_id
from public.agent_sessions s
where fp.session_id = s.id
  and fp.source_objective_id is null;

-- Backfill from old multi-session provenance using the most recently attached
-- mapped session, then collapse to the singular source objective.
update public.feed_posts fp
set source_objective_id = (
  select s.objective_id
  from unnest(fp.source_session_ids) with ordinality as source(session_id, position)
  join public.agent_sessions s on s.id = source.session_id
  order by s.attached_at desc nulls last, source.position
  limit 1
)
where fp.source_objective_id is null
  and exists (
    select 1
    from unnest(fp.source_session_ids) as source(session_id)
    join public.agent_sessions s on s.id = source.session_id
  );

create index if not exists idx_feed_posts_source_objective
  on public.feed_posts(source_objective_id)
  where source_objective_id is not null;

-- Drop session_id
alter table public.feed_posts
  drop constraint if exists feed_posts_session_id_fkey;

drop index if exists idx_feed_posts_session;

alter table public.feed_posts
  drop column if exists session_id;

-- Drop source_session_ids
alter table public.feed_posts
  drop column if exists source_session_ids;

-- ============================================================
-- 5. objective_attachments: drop session_id
-- ============================================================

alter table public.objective_attachments
  drop constraint if exists objective_attachments_session_id_fkey;

alter table public.objective_attachments
  drop column if exists session_id;

-- ============================================================
-- 6. shared_state: add objective_id, backfill, drop session_id
-- ============================================================

alter table public.shared_state
  add column if not exists objective_id uuid references public.objectives(id) on delete set null;

-- Backfill from session_id -> agent_sessions.objective_id
update public.shared_state ss
set objective_id = s.objective_id
from public.agent_sessions s
where ss.session_id = s.id
  and ss.objective_id is null;

create index if not exists shared_state_objective_id_idx
  on public.shared_state(objective_id)
  where objective_id is not null;

alter table public.shared_state
  drop constraint if exists shared_state_session_id_fkey;

alter table public.shared_state
  drop column if exists session_id;

-- ============================================================
-- 7. ticket_events: backfill objective_id, drop session_id
-- ============================================================

-- Backfill objective_id from session_id -> agent_sessions.objective_id
update public.ticket_events te
set objective_id = s.objective_id
from public.agent_sessions s
where te.session_id = s.id
  and te.objective_id is null;

alter table public.ticket_events
  drop constraint if exists ticket_events_session_id_fkey;

alter table public.ticket_events
  drop column session_id;

-- Drop the trigger that auto-sets objective_id from ticket_id via session,
-- since we now set objective_id explicitly
drop trigger if exists set_ticket_event_objective_id on public.ticket_events;

-- ============================================================
-- 8. file_changes: keep session_id, ensure objective_id is always populated
-- ============================================================

-- Backfill any file_changes.objective_id that is still null
update public.file_changes fc
set objective_id = s.objective_id
from public.agent_sessions s
where fc.session_id = s.id
  and fc.objective_id is null;

-- Update the trigger to also resolve from session_id -> agent_sessions
create or replace function public.set_file_change_objective_id()
returns trigger
language plpgsql
as $$
begin
  if new.objective_id is null and new.session_id is not null then
    select objective_id into new.objective_id
    from public.agent_sessions
    where id = new.session_id;
  end if;

  if new.objective_id is null and new.ticket_id is not null then
    new.objective_id := public.resolve_ticket_objective_id(new.ticket_id);
  end if;

  return new;
end;
$$;

-- ============================================================
-- 9. project_checkpoints: keep session_id, ensure objective_id is always populated
-- ============================================================

-- Backfill any null objective_id from session
update public.project_checkpoints pc
set objective_id = s.objective_id
from public.agent_sessions s
where pc.session_id = s.id
  and pc.objective_id is null
  and s.objective_id is not null;
