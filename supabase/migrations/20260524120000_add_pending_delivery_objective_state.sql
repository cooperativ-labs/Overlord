-- NOTE: The 'pending_delivery' enum value was added in 20260524115000_add_pending_delivery_enum.sql
-- It must be in a prior committed transaction before it can be used in an index predicate.

drop index if exists public.objectives_one_executing_per_ticket_idx;

create unique index if not exists objectives_one_executing_per_ticket_idx
  on public.objectives (ticket_id)
  where state in ('executing'::public.objective_state, 'pending_delivery'::public.objective_state);

comment on index public.objectives_one_executing_per_ticket_idx is
  'A ticket may have at most one objective in executing or pending_delivery. '
  'This prevents follow-up work awaiting redelivery from racing with another active objective.';
