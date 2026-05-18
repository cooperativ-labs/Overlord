-- Auto-assign the next available position when an objective is inserted
-- without an explicit position. Positions are per-ticket and start at 0.
-- Callers that want a specific slot (e.g. manual reorder) can still set
-- position explicitly and the trigger will leave that value alone.

-- Drop default and NOT NULL so callers can omit position on insert. A
-- BEFORE INSERT trigger fills in the next available slot before any read
-- consumer sees the row; the column remains effectively non-null in practice.
alter table public.objectives
  alter column position drop default,
  alter column position drop not null;

create or replace function public.assign_objective_default_position()
returns trigger
language plpgsql
as $$
begin
  if new.position is null then
    select coalesce(max(position) + 1, 0)
      into new.position
      from public.objectives
     where ticket_id = new.ticket_id;
  end if;
  return new;
end;
$$;

drop trigger if exists objectives_assign_default_position on public.objectives;
create trigger objectives_assign_default_position
  before insert on public.objectives
  for each row execute function public.assign_objective_default_position();
