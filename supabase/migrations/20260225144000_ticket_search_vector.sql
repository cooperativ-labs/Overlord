-- Add a tsvector column so ticket search can use PostgreSQL full-text search.
alter table public.tickets
  add column if not exists search_vector tsvector;

create or replace function public.update_tickets_search_vector() returns trigger language plpgsql as $$
declare
  title_text text := coalesce(new.title, '');
  identifier_text text := coalesce(new.ticket_sequence::text, '');
begin
  new.search_vector := to_tsvector('english', concat_ws(' ', title_text, identifier_text));
  return new;
end;
$$;

drop trigger if exists set_tickets_search_vector on public.tickets;
create trigger set_tickets_search_vector
  before insert or update on public.tickets
  for each row
  execute function public.update_tickets_search_vector();

update public.tickets
set search_vector = to_tsvector(
  'english',
  concat_ws(' ', coalesce(title, ''), coalesce(ticket_sequence::text, ''))
);

create index if not exists tickets_search_vector_idx
  on public.tickets using gin (search_vector);
