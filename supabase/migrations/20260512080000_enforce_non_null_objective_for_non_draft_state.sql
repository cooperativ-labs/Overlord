-- Enforce that objectives.objective cannot be null or empty unless state is 'draft'.
-- Any attempt to move an objective to a non-draft state with a null/empty objective
-- will be rejected by the database.
ALTER TABLE public.objectives
  ADD CONSTRAINT objectives_non_draft_requires_objective
  CHECK (state = 'draft' OR (objective IS NOT NULL AND LENGTH(TRIM(objective)) > 0));
