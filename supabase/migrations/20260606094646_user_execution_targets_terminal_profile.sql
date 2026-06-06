alter table public.user_execution_targets
add column terminal_profile jsonb not null default '{}'::jsonb;
