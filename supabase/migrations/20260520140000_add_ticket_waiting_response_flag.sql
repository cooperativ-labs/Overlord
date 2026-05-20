-- Tracks whether a ticket has an unread waiting-response/approval state.
-- This is used by board badges and auto-advance approval gates.

alter table public.tickets
  add column if not exists has_unopened_waiting_response boolean not null default false;
