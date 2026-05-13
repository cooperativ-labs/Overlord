-- Allow draft and future objectives to exist as empty placeholders while
-- continuing to require text for submitted/executing/complete objectives.
alter table public.objectives
  drop constraint if exists objectives_non_draft_requires_objective;

alter table public.objectives
  add constraint objectives_non_draft_requires_objective
  check (
    state in ('draft', 'future')
    or (objective is not null and length(trim(objective)) > 0)
  );
