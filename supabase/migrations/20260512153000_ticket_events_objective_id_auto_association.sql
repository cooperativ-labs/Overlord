create or replace function public.resolve_ticket_event_objective_id(p_ticket_id uuid)
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

create or replace function public.set_ticket_event_objective_id()
returns trigger
language plpgsql
as $$
begin
  if new.objective_id is null and new.ticket_id is not null then
    new.objective_id := public.resolve_ticket_event_objective_id(new.ticket_id);
  end if;

  return new;
end;
$$;

drop trigger if exists set_ticket_event_objective_id on public.ticket_events;

create trigger set_ticket_event_objective_id
  before insert on public.ticket_events
  for each row
  execute function public.set_ticket_event_objective_id();

comment on column public.ticket_events.objective_id is
  'When null on insert, auto-associates to the newest executing objective for the ticket, else the newest completed objective.';
