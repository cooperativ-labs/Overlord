-- Migrate agent identity from 'gemini' to 'antigravity' across all tables.
-- Gemini CLI is deprecated; Antigravity CLI is the replacement connector.
-- Note: tickets.assigned_agent was moved to objectives in 20260507121500_move_assigned_agent_to_objectives.sql.

-- 1. objectives.assigned_agent (JSONB: {agent, model, thinking})
update public.objectives
set assigned_agent = jsonb_set(assigned_agent, '{agent}', '"antigravity"')
where assigned_agent->>'agent' = 'gemini';

-- 2. agent_models: rename agent_type and compatible_agents references
update public.agent_models
set
  agent_type = 'antigravity',
  capabilities = jsonb_set(
    capabilities,
    '{compatible_agents}',
    (
      select jsonb_agg(
        case when elem::text = '"gemini"' then '"antigravity"'::jsonb else elem end
      )
      from jsonb_array_elements(capabilities->'compatible_agents') as elem
    )
  )
where agent_type = 'gemini';

-- 3. user_agent_configs: rename agent_type
update public.user_agent_configs
set agent_type = 'antigravity'
where agent_type = 'gemini';

-- 4. user_launch_preferences: rename agent_type
update public.user_launch_preferences
set agent_type = 'antigravity'
where agent_type = 'gemini';
