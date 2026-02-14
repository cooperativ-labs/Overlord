create table if not exists public.board_columns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  statuses text[] not null default '{}',
  position smallint not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists board_columns_position_idx on public.board_columns(position);

drop trigger if exists set_board_columns_updated_at on public.board_columns;
create trigger set_board_columns_updated_at
before update on public.board_columns
for each row
execute function public.set_updated_at();

alter table public.board_columns enable row level security;

create policy "board_columns_select_local" on public.board_columns
for select to anon, authenticated
using (true);

create policy "board_columns_insert_local" on public.board_columns
for insert to anon, authenticated
with check (true);

create policy "board_columns_update_local" on public.board_columns
for update to anon, authenticated
using (true)
with check (true);

create policy "board_columns_delete_local" on public.board_columns
for delete to anon, authenticated
using (true);

insert into public.board_columns (title, slug, statuses, position) values
  ('Backlog',     'backlog',      '{draft}',              0),
  ('To Do',       'todo',         '{review,refine}',      1),
  ('In Progress', 'in-progress',  '{execute}',            2),
  ('Review',      'review',       '{deliver}',            3),
  ('Done',        'done',         '{complete}',           4),
  ('Blocked',     'blocked',      '{blocked,cancelled}',  5);
