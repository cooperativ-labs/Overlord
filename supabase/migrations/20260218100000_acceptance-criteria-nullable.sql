-- Allow acceptance_criteria to be null (optional field)
ALTER TABLE public.tickets
  ALTER COLUMN acceptance_criteria DROP NOT NULL,
  ALTER COLUMN acceptance_criteria DROP DEFAULT;
