-- Enable Supabase Realtime for tables used in the notification data flow.
-- Without this, postgres_changes subscriptions in KanbanBoard and
-- use-ticket-realtime silently receive no events.

ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.artifacts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.shared_state;
