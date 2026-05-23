-- Enforce two invariants that prevent objective double-completion bugs:
--   1. At most one objective per ticket may be in the 'executing' state.
--   2. At most one active (attached/idle/blocked) agent_session may exist per objective.
--
-- A race between the deliver background job and the auto-advance scheduler
-- previously allowed a draft objective to enter 'executing' before deliver's
-- `update().eq('state','executing')` ran, causing both the just-delivered and
-- the freshly-launched objective to be marked complete with overlapping
-- session metadata.

-- ============================================================
-- 1. Clean up any pre-existing duplicates so the new constraints can apply.
-- ============================================================

-- Resolve tickets that already have multiple executing objectives. Keep the
-- most recently updated as the canonical executing row; revert the rest to
-- 'draft' so the queue can re-promote them deliberately. Reverted rows have
-- their completed_at cleared by the existing set_objective_completed_at
-- trigger.
with executing_ranked as (
  select
    id,
    row_number() over (
      partition by ticket_id
      order by updated_at desc nulls last, created_at desc, id desc
    ) as rn
  from public.objectives
  where state = 'executing'::public.objective_state
)
update public.objectives o
set state = 'draft'::public.objective_state
from executing_ranked r
where o.id = r.id
  and r.rn > 1;

-- Resolve objectives that already have multiple active agent sessions. Keep
-- the most recently attached one; detach the rest so they no longer count as
-- active and won't conflict with the new unique constraint.
with active_session_ranked as (
  select
    id,
    row_number() over (
      partition by objective_id
      order by attached_at desc nulls last, created_at desc, id desc
    ) as rn
  from public.agent_sessions
  where session_state in (
    'attached'::public.session_state,
    'idle'::public.session_state,
    'blocked'::public.session_state
  )
)
update public.agent_sessions s
set
  session_state = 'disconnected'::public.session_state,
  detached_at = coalesce(detached_at, now())
from active_session_ranked r
where s.id = r.id
  and r.rn > 1;

-- ============================================================
-- 2. Enforce the invariants going forward.
-- ============================================================

create unique index if not exists objectives_one_executing_per_ticket_idx
  on public.objectives (ticket_id)
  where state = 'executing'::public.objective_state;

comment on index public.objectives_one_executing_per_ticket_idx is
  'A ticket may have at most one objective in the executing state. Prevents '
  'auto-advance races from leaving two objectives executing simultaneously, '
  'which previously caused both to be marked complete by the deliver handler.';

create unique index if not exists agent_sessions_one_active_per_objective_idx
  on public.agent_sessions (objective_id)
  where session_state in (
    'attached'::public.session_state,
    'idle'::public.session_state,
    'blocked'::public.session_state
  );

comment on index public.agent_sessions_one_active_per_objective_idx is
  'At most one active agent_session may reference a given objective. '
  'A new attach must detach any prior active session for the same objective.';
