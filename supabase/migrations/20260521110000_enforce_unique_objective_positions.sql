-- Normalize per-ticket objective positions and enforce uniqueness so draft,
-- future, submitted, executing, and complete objectives never share a slot.

with ranked as (
  select
    id,
    row_number() over (
      partition by ticket_id
      order by position asc nulls last, created_at asc, id asc
    ) - 1 as new_position
  from public.objectives
)
update public.objectives as objectives
set position = ranked.new_position
from ranked
where ranked.id = objectives.id
  and objectives.position is distinct from ranked.new_position;

create unique index if not exists objectives_ticket_position_unique_idx
  on public.objectives using btree (ticket_id, position);
