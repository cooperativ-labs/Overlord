create or replace function public.first_ticket_objective_text(p_ticket_id uuid)
returns text
language sql
stable
as $$
  select coalesce(
    (
      select o.objective
      from public.objectives o
      where o.ticket_id = p_ticket_id
      order by o.created_at asc, o.id asc
      limit 1
    ),
    ''
  );
$$;

create or replace function public.update_tickets_search_vector()
returns trigger
language plpgsql
as $$
declare
  title_text text := coalesce(new.title, '');
  identifier_text text := coalesce(new.ticket_sequence::text, '');
  first_objective_text text := public.first_ticket_objective_text(new.id);
begin
  new.search_vector := to_tsvector(
    'english',
    concat_ws(' ', title_text, identifier_text, first_objective_text)
  );
  return new;
end;
$$;

create or replace function public.refresh_ticket_search_vector_from_objectives()
returns trigger
language plpgsql
as $$
declare
  affected_ticket_id uuid := coalesce(new.ticket_id, old.ticket_id);
begin
  if affected_ticket_id is null then
    return null;
  end if;

  update public.tickets t
  set search_vector = to_tsvector(
    'english',
    concat_ws(
      ' ',
      coalesce(t.title, ''),
      coalesce(t.ticket_sequence::text, ''),
      public.first_ticket_objective_text(t.id)
    )
  )
  where t.id = affected_ticket_id;

  return null;
end;
$$;

drop trigger if exists refresh_ticket_search_vector_from_objectives on public.objectives;
create trigger refresh_ticket_search_vector_from_objectives
  after insert or update or delete on public.objectives
  for each row
  execute function public.refresh_ticket_search_vector_from_objectives();

update public.tickets t
set search_vector = to_tsvector(
  'english',
  concat_ws(
    ' ',
    coalesce(t.title, ''),
    coalesce(t.ticket_sequence::text, ''),
    public.first_ticket_objective_text(t.id)
  )
);
