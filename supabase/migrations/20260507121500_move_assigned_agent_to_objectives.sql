-- Move draft agent/model assignment from tickets to objectives.

ALTER TABLE public.objectives
  ADD COLUMN IF NOT EXISTS assigned_agent jsonb;

COMMENT ON COLUMN public.objectives.assigned_agent
  IS 'Agent/model selection assigned to this objective before execution.';

UPDATE public.objectives o
  SET assigned_agent = t.assigned_agent
  FROM public.tickets t
  WHERE t.id = o.ticket_id
    AND o.assigned_agent IS NULL
    AND t.assigned_agent IS NOT NULL;

ALTER TABLE public.tickets
  DROP COLUMN IF EXISTS assigned_agent;
