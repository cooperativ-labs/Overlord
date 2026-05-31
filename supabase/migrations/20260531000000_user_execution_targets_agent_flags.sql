-- Per-target local agent launch configuration.
--
-- The "Local agent configuration" controls (command flags + pre-command) used to
-- live only in user_agent_configs, keyed by agent type and shared across every
-- execution target. Users need different flags per target (e.g. a containerized
-- target may want a pre-command and --dangerously-skip-permissions while a local
-- machine does not), so we store the configuration on user_execution_targets.
--
-- Shape of agent_flags:
--   { "<agent_type>": { "flags": string[], "preCommand"?: string }, ... }

alter table public.user_execution_targets
  add column if not exists agent_flags jsonb not null default '{}'::jsonb;

comment on column public.user_execution_targets.agent_flags is
  'Per-agent local launch config for this target: { "<agent_type>": { "flags": string[], "preCommand"?: string } }. Read by launch composition when starting an agent on this target.';

-- Backfill: carry each user's existing global per-agent flags / pre-command onto
-- their current execution targets so launch behavior is preserved after the move.
update public.user_execution_targets t
set agent_flags = sub.agg
from (
  select
    user_id,
    jsonb_object_agg(
      agent_type,
      jsonb_strip_nulls(
        jsonb_build_object(
          'flags', coalesce(config -> 'flags', '[]'::jsonb),
          'preCommand', config -> 'preCommand'
        )
      )
    ) as agg
  from public.user_agent_configs
  where agent_type <> '__custom__'
    and ((config ? 'flags') or (config ? 'preCommand'))
  group by user_id
) sub
where sub.user_id = t.user_id
  and t.agent_flags = '{}'::jsonb;
