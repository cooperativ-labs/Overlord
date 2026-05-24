alter table public.tickets
  rename column execution_target to for_human;

alter table public.tickets
  alter column for_human drop default;

alter table public.tickets
  alter column for_human type boolean
  using (for_human = 'human');

alter table public.tickets
  alter column for_human set default false;
