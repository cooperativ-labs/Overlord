-- Optional link from activity events to the objective they belong to.
alter table public.ticket_events
  add column objective_id uuid references public.objectives (id) on delete set null;

comment on column public.ticket_events.objective_id is
  'When set, associates this event with a specific ticket objective (same ticket as ticket_id).';

create index if not exists ticket_events_objective_id_idx
  on public.ticket_events using btree (objective_id)
  where objective_id is not null;
