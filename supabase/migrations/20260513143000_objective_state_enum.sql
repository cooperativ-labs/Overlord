-- Replace text + check constraint with a Postgres enum for objectives.state.

drop trigger if exists set_objective_completed_at on public.objectives;

drop index if exists public.objectives_one_draft_per_ticket_idx;
drop index if exists public.objectives_ticket_state_idx;

create type public.objective_state as enum (
  'future',
  'draft',
  'submitted',
  'executing',
  'complete'
);

comment on type public.objective_state is
  'Ticket objective lifecycle: future (queued), draft (editable), submitted (ready), executing (in progress), complete (done).';

alter table public.objectives
  drop constraint if exists objectives_non_draft_requires_objective;

alter table public.objectives
  drop constraint if exists objectives_state_check;

alter table public.objectives
  alter column state drop default;

alter table public.objectives
  alter column state type public.objective_state using state::text::public.objective_state;

alter table public.objectives
  alter column state set default 'draft'::public.objective_state;

-- Same rule as 20260513123000_allow_blank_future_objectives.sql, with enum literals.
alter table public.objectives
  add constraint objectives_non_draft_requires_objective
  check (
    state in ('draft'::public.objective_state, 'future'::public.objective_state)
    or (objective is not null and length(trim(objective)) > 0)
  );

create or replace function public.set_objective_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.state = 'complete'::public.objective_state
    and old.state is distinct from 'complete'::public.objective_state
    and new.completed_at is null then
    new.completed_at = now();
  elsif new.state is distinct from 'complete'::public.objective_state then
    new.completed_at = null;
  end if;

  return new;
end;
$$;

create trigger set_objective_completed_at
  before update on public.objectives
  for each row
  execute function public.set_objective_completed_at();

create unique index if not exists objectives_one_draft_per_ticket_idx
  on public.objectives (ticket_id)
  where state = 'draft'::public.objective_state;

create index if not exists objectives_ticket_state_idx
  on public.objectives using btree (ticket_id, state);
