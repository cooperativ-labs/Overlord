create type public.ticket_execution_target as enum ('agent', 'human');

alter table public.tickets
add column execution_target public.ticket_execution_target not null default 'agent';
