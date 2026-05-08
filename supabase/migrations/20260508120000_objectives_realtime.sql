-- Enable Supabase Realtime for the objectives table.
--
-- Without this, postgres_changes subscriptions on `public.objectives` are
-- silently never delivered, so the board (useTicketBoardRealtime) and the
-- ticket detail page (use-ticket-objectives-realtime) only see objective
-- state transitions via the 4s polling fallback (or, on the board, never).
--
-- REPLICA IDENTITY FULL ensures DELETE and UPDATE payloads include
-- ticket_id in `payload.old`, which the board hook needs to route the
-- change to the correct ticket cache entry.

alter table public.objectives replica identity full;
alter publication supabase_realtime add table public.objectives;
