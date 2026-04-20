-- Use objectives.state as the single execution-state source of truth.
-- Legacy is_executed=false maps to draft; previously executed rows keep their
-- executing/complete state when available and otherwise become complete.

UPDATE public.objectives
SET state = CASE
  WHEN is_executed = false THEN 'draft'
  WHEN state IN ('executing', 'complete') THEN state
  ELSE 'complete'
END;

ALTER TABLE public.objectives
  ALTER COLUMN state SET DEFAULT 'draft',
  ALTER COLUMN state SET NOT NULL;

ALTER TABLE public.objectives
  DROP CONSTRAINT IF EXISTS objectives_state_check;

ALTER TABLE public.objectives
  ADD CONSTRAINT objectives_state_check
  CHECK (state IN ('draft', 'executing', 'complete'));

DROP INDEX IF EXISTS public.objectives_ticket_is_executed_idx;

CREATE INDEX IF NOT EXISTS objectives_ticket_state_idx
  ON public.objectives USING btree (ticket_id, state);

ALTER TABLE public.objectives
  DROP COLUMN IF EXISTS is_executed;
