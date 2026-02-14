alter table public.tickets
  add column board_position integer not null default 0;

create index if not exists tickets_board_position_idx on public.tickets(board_position);
