ALTER TABLE public.objectives
  ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone;

COMMENT ON COLUMN public.objectives.completed_at
  IS 'Timestamp recorded when this objective enters the complete state.';

UPDATE public.objectives
SET completed_at = COALESCE(completed_at, updated_at, now())
WHERE state = 'complete'
  AND completed_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_objective_completed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state = 'complete' AND OLD.state IS DISTINCT FROM 'complete' AND NEW.completed_at IS NULL THEN
    NEW.completed_at = now();
  ELSIF NEW.state IS DISTINCT FROM 'complete' THEN
    NEW.completed_at = NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_objective_completed_at ON public.objectives;
CREATE TRIGGER set_objective_completed_at
  BEFORE UPDATE ON public.objectives
  FOR EACH ROW
  EXECUTE FUNCTION public.set_objective_completed_at();
