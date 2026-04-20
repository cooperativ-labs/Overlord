ALTER TABLE public.objectives
  DROP CONSTRAINT IF EXISTS objectives_state_check;

ALTER TABLE public.objectives
  ADD CONSTRAINT objectives_state_check
  CHECK (state IN ('draft', 'submitted', 'executing', 'complete'));
