-- Snapshot the model used when an objective begins execution.

ALTER TABLE public.objectives
  ADD COLUMN IF NOT EXISTS model_identifier text;

COMMENT ON COLUMN public.objectives.model_identifier
  IS 'Snapshot of the model identifier used when this objective entered execution.';

UPDATE public.objectives o
  SET model_identifier = COALESCE(
    o.model_identifier,
    CASE
      WHEN jsonb_typeof(t.assigned_agent) = 'object'
        THEN NULLIF(t.assigned_agent ->> 'model', '')
      ELSE NULL
    END
  )
  FROM public.tickets t
  WHERE t.id = o.ticket_id
    AND o.state = 'executing'
    AND o.model_identifier IS NULL;
