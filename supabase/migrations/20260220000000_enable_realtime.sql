-- Enable Supabase Realtime for agent_sessions, ticket_events, and artifacts
alter publication supabase_realtime add table agent_sessions;
alter publication supabase_realtime add table ticket_events;
alter publication supabase_realtime add table artifacts;
