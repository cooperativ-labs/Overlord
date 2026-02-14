insert into public.tickets (
  title,
  objective,
  context,
  constraints,
  available_tools,
  acceptance_criteria,
  output_format,
  assigned_agent,
  priority,
  status
)
values
  (
    'Implement protocol attach flow',
    'Create the MVP endpoint flow so Claude Code and ChatGPT can attach to tickets.',
    'Existing app is local-first. Use Supabase-backed storage and protocol events.',
    'No in-app chat for MVP. Keep operations deterministic and auditable.',
    'REST API, local Supabase, Next.js app router.',
    'attach returns ticket spec + history + context. Session heartbeat updates on calls.',
    'API routes in app/api/protocol/* plus dashboard event visibility.',
    'Claude Code',
    'high',
    'review'
  ),
  (
    'Build ticket dashboard views',
    'Deliver list/detail/create pages for PM workflow without chat UI.',
    'Ticket detail should include status controls, context, artifacts, and attach helpers.',
    'Use server components and server actions for database mutations.',
    'Next.js, Supabase SSR, SQL schema.',
    'PM can create ticket, see timeline, and transition ticket status.',
    'Working pages at /tickets, /tickets/new, /tickets/:id.',
    'ChatGPT Agent',
    'medium',
    'draft'
  );

insert into public.ticket_events (ticket_id, event_type, summary, phase)
select id, 'system', 'Seeded ticket for local MVP testing.', status
from public.tickets;

insert into public.shared_state (ticket_id, state_key, state_value, tags, source)
select
  id,
  'initial_scope',
  jsonb_build_object('modules', array['api/protocol', 'tickets/dashboard']),
  array['mvp', 'bootstrap'],
  'seed'
from public.tickets;

insert into public.board_columns (title, slug, statuses, position) values
  ('Backlog',     'backlog',      '{draft}',              0),
  ('To Do',       'todo',         '{review,refine}',      1),
  ('In Progress', 'in-progress',  '{execute}',            2),
  ('Review',      'review',       '{deliver}',            3),
  ('Done',        'done',         '{complete}',           4),
  ('Blocked',     'blocked',      '{blocked,cancelled}',  5)
on conflict (slug) do nothing;
