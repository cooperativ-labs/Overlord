-- Rename the per-target local launch config column to match its broader
-- ownership: keyed per agent/harness on the user's execution target.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_execution_targets'
      and column_name = 'agent_flags'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_execution_targets'
      and column_name = 'agent_configs'
  ) then
    alter table public.user_execution_targets
      rename column agent_flags to agent_configs;
  end if;
end $$;

alter table public.user_execution_targets
  add column if not exists agent_configs jsonb not null default '{}'::jsonb;

comment on column public.user_execution_targets.agent_configs is
  'Per-agent or per-harness local launch config for this target: { "<agent_key>": { "flags": string[], "preCommand"?: string } }. Read by launch composition when starting an agent on this target.';

comment on column public.objectives.launch_config is
  'Per-objective launch config overrides keyed by execution target id and agent/harness key: { "<execution_target_id>": { "<agent_key>": { "flags": string[], "preCommand"?: string } } }. NULL inherits the execution target config; present empty values mean none.';
