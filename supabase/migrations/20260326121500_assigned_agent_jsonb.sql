alter table public.tickets
alter column assigned_agent type jsonb
using (
  case
    when assigned_agent is null or btrim(assigned_agent) = '' then null
    when lower(btrim(assigned_agent)) in ('claude', 'claude code', 'claude-code') then
      jsonb_build_object('agent', 'claude', 'model', null, 'thinking', null)
    when lower(btrim(assigned_agent)) = 'codex' then
      jsonb_build_object('agent', 'codex', 'model', null, 'thinking', null)
    when lower(btrim(assigned_agent)) = 'cursor' then
      jsonb_build_object('agent', 'cursor', 'model', null, 'thinking', null)
    when lower(btrim(assigned_agent)) in ('gemini', 'google-gemini') then
      jsonb_build_object('agent', 'gemini', 'model', null, 'thinking', null)
    when lower(btrim(assigned_agent)) in ('opencode', 'open-code') then
      jsonb_build_object('agent', 'opencode', 'model', null, 'thinking', null)
    else null
  end
);

comment on column public.tickets.assigned_agent is
  'Ticket-level assigned launch agent, model, and thinking preference. Falls back to the user''s last-used agent when null.';
