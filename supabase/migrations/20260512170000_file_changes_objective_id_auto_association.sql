alter table public.file_changes
  add column if not exists objective_id uuid references public.objectives (id) on delete set null;

create index if not exists file_changes_objective_id_idx
  on public.file_changes using btree (objective_id)
  where objective_id is not null;

create or replace function public.resolve_ticket_objective_id(p_ticket_id uuid)
returns uuid
language plpgsql
as $$
declare
  resolved_objective_id uuid;
begin
  select o.id
  into resolved_objective_id
  from public.objectives o
  where o.ticket_id = p_ticket_id
    and o.state = 'executing'
  order by o.created_at desc, o.id desc
  limit 1;

  if resolved_objective_id is not null then
    return resolved_objective_id;
  end if;

  select o.id
  into resolved_objective_id
  from public.objectives o
  where o.ticket_id = p_ticket_id
    and o.state = 'complete'
  order by o.completed_at desc nulls last, o.created_at desc, o.id desc
  limit 1;

  return resolved_objective_id;
end;
$$;

create or replace function public.resolve_ticket_event_objective_id(p_ticket_id uuid)
returns uuid
language sql
as $$
  select public.resolve_ticket_objective_id(p_ticket_id)
$$;

create or replace function public.set_ticket_event_objective_id()
returns trigger
language plpgsql
as $$
begin
  if new.objective_id is null and new.ticket_id is not null then
    new.objective_id := public.resolve_ticket_objective_id(new.ticket_id);
  end if;

  return new;
end;
$$;

create or replace function public.set_file_change_objective_id()
returns trigger
language plpgsql
as $$
begin
  if new.objective_id is null and new.ticket_id is not null then
    new.objective_id := public.resolve_ticket_objective_id(new.ticket_id);
  end if;

  return new;
end;
$$;

drop trigger if exists set_file_change_objective_id on public.file_changes;

create trigger set_file_change_objective_id
  before insert on public.file_changes
  for each row
  execute function public.set_file_change_objective_id();

comment on column public.file_changes.objective_id is
  'When null on insert, auto-associates to the newest executing objective for the ticket, else the newest completed objective.';

comment on column public.ticket_events.objective_id is
  'When null on insert, auto-associates to the newest executing objective for the ticket, else the newest completed objective.';
