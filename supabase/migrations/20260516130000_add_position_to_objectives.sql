-- Add a per-ticket sequence order to objectives so future objectives can be
-- reordered via drag and drop and so the lowest-positioned future objective
-- gets promoted to draft when execution begins.

alter table public.objectives
  add column if not exists position integer not null default 0;

-- Backfill an initial order using created_at within each ticket. Existing
-- rows keep their relative chronology, with the earliest objective at
-- position 0.
with ranked as (
  select
    id,
    row_number() over (
      partition by ticket_id
      order by created_at asc, id asc
    ) - 1 as new_position
  from public.objectives
)
update public.objectives o
set position = ranked.new_position
from ranked
where ranked.id = o.id
  and o.position is distinct from ranked.new_position;

create index if not exists objectives_ticket_position_idx
  on public.objectives using btree (ticket_id, position);
