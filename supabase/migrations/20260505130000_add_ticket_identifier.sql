create table if not exists public.ticket_identifier_counters (
  organization_id integer primary key references public.organizations(id) on delete cascade,
  next_sequence bigint not null check (next_sequence > 0)
);

alter table public.tickets
  add column if not exists ticket_id text;

create or replace function public.generate_ticket_identifier(p_organization_id integer)
returns text
language plpgsql
as $$
declare
  allocated_next_sequence bigint;
begin
  insert into public.ticket_identifier_counters (organization_id, next_sequence)
  values (p_organization_id, 2)
  on conflict (organization_id)
  do update
    set next_sequence = public.ticket_identifier_counters.next_sequence + 1
  returning next_sequence into allocated_next_sequence;

  return concat(p_organization_id::text, ':', (allocated_next_sequence - 1)::text);
end;
$$;

create or replace function public.assign_ticket_identifier()
returns trigger
language plpgsql
as $$
begin
  if new.ticket_id is null or btrim(new.ticket_id) = '' then
    new.ticket_id := public.generate_ticket_identifier(new.organization_id);
  end if;

  return new;
end;
$$;

drop trigger if exists assign_ticket_identifier on public.tickets;
create trigger assign_ticket_identifier
  before insert on public.tickets
  for each row
  execute function public.assign_ticket_identifier();

with ordered_tickets as (
  select
    t.id,
    t.organization_id,
    row_number() over (
      partition by t.organization_id
      order by t.created_at asc, t.id asc
    ) as organization_ticket_sequence
  from public.tickets t
)
update public.tickets t
set ticket_id = concat(
  ordered_tickets.organization_id::text,
  ':',
  ordered_tickets.organization_ticket_sequence::text
)
from ordered_tickets
where t.id = ordered_tickets.id
  and (t.ticket_id is null or btrim(t.ticket_id) = '');

insert into public.ticket_identifier_counters (organization_id, next_sequence)
select
  t.organization_id,
  max(split_part(t.ticket_id, ':', 2)::bigint) + 1 as next_sequence
from public.tickets t
where t.ticket_id is not null
group by t.organization_id
on conflict (organization_id)
do update
  set next_sequence = excluded.next_sequence;

alter table public.tickets
  alter column ticket_id set not null;

alter table public.tickets
  drop constraint if exists tickets_ticket_id_format;

alter table public.tickets
  add constraint tickets_ticket_id_format
  check (ticket_id ~ '^[0-9]+:[0-9]+$');

create unique index if not exists tickets_ticket_id_key
  on public.tickets using btree (ticket_id);

create or replace function public.update_tickets_search_vector()
returns trigger
language plpgsql
as $$
declare
  title_text text := coalesce(new.title, '');
  identifier_text text := coalesce(new.ticket_id, coalesce(new.ticket_sequence::text, ''));
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
      coalesce(t.ticket_id, coalesce(t.ticket_sequence::text, '')),
      public.first_ticket_objective_text(t.id)
    )
  )
  where t.id = affected_ticket_id;

  return null;
end;
$$;

update public.tickets t
set search_vector = to_tsvector(
  'english',
  concat_ws(
    ' ',
    coalesce(t.title, ''),
    coalesce(t.ticket_id, coalesce(t.ticket_sequence::text, '')),
    public.first_ticket_objective_text(t.id)
  )
);
