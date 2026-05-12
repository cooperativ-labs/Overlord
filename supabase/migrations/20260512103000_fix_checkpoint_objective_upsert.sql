-- Make objective checkpoints a real one-row-per-objective table shape.
-- Supabase/PostgREST upsert with onConflict='project_id,objective_id' cannot
-- target the previous partial unique index, so objective_id must be non-null
-- and backed by a normal unique constraint.

with fallback_objectives as (
  select
    checkpoint.id as checkpoint_id,
    coalesce(checkpoint.objective_id, latest_objective.id) as objective_id
  from public.project_checkpoints checkpoint
  left join lateral (
    select objective.id
    from public.objectives objective
    where objective.ticket_id = checkpoint.ticket_id
      and nullif(trim(objective.objective), '') is not null
    order by
      case objective.state
        when 'executing' then 0
        when 'complete' then 1
        else 2
      end,
      objective.created_at desc
    limit 1
  ) latest_objective on true
  where checkpoint.objective_id is null
)
update public.project_checkpoints checkpoint
set objective_id = fallback_objectives.objective_id
from fallback_objectives
where checkpoint.id = fallback_objectives.checkpoint_id
  and fallback_objectives.objective_id is not null;

-- Any remaining null-objective checkpoints cannot support per-objective revert.
update public.file_changes
set checkpoint_id = null
where checkpoint_id in (
  select id
  from public.project_checkpoints
  where objective_id is null
);

delete from public.project_checkpoints
where objective_id is null;

-- Collapse duplicates before adding the non-partial unique constraint. Keep the
-- newest checkpoint and repoint file_changes that referenced older duplicates.
with ranked_checkpoints as (
  select
    id,
    first_value(id) over (
      partition by project_id, objective_id
      order by created_at desc, id desc
    ) as keep_id,
    row_number() over (
      partition by project_id, objective_id
      order by created_at desc, id desc
    ) as row_number
  from public.project_checkpoints
)
update public.file_changes file_change
set checkpoint_id = ranked_checkpoints.keep_id
from ranked_checkpoints
where file_change.checkpoint_id = ranked_checkpoints.id
  and ranked_checkpoints.row_number > 1;

with ranked_checkpoints as (
  select
    id,
    row_number() over (
      partition by project_id, objective_id
      order by created_at desc, id desc
    ) as row_number
  from public.project_checkpoints
)
delete from public.project_checkpoints checkpoint
using ranked_checkpoints
where checkpoint.id = ranked_checkpoints.id
  and ranked_checkpoints.row_number > 1;

drop index if exists public.project_checkpoints_project_objective_uniq;

alter table public.project_checkpoints
  alter column objective_id set not null;

alter table public.project_checkpoints
  drop constraint if exists project_checkpoints_project_objective_key;

alter table public.project_checkpoints
  add constraint project_checkpoints_project_objective_key
  unique (project_id, objective_id);
