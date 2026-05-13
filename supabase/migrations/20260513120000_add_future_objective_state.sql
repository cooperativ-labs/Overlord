alter table public.objectives
  drop constraint if exists objectives_state_check;

alter table public.objectives
  add constraint objectives_state_check
  check (state in ('draft', 'future', 'submitted', 'executing', 'complete'));

with ranked_drafts as (
  select
    id,
    row_number() over (partition by ticket_id order by created_at desc, id desc) as draft_rank
  from public.objectives
  where state = 'draft'
)
update public.objectives objectives
set state = 'future'
from ranked_drafts
where objectives.id = ranked_drafts.id
  and ranked_drafts.draft_rank > 1;

create unique index if not exists objectives_one_draft_per_ticket_idx
  on public.objectives (ticket_id)
  where state = 'draft';
