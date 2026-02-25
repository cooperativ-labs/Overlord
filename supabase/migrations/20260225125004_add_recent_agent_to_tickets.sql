-- Add recent_agent to tickets: stores the agent_identifier of the agent who most recently delivered on this ticket.
-- Current working agent (from agent_sessions) takes display priority over recent_agent.
alter table public.tickets
  add column if not exists recent_agent text;

comment on column public.tickets.recent_agent is 'Agent identifier of the agent who most recently delivered on this ticket. Display priority: running_agent > recent_agent > assigned_agent.';
