-- Migrate execution ownership from tickets to objectives.
-- Adds agent_identifier to objectives, objective_id FK to feed_posts,
-- and expands the objective state check to include 'draft' and 'blocked'.

-- 1. Expand the state check constraint to include 'draft' and 'blocked'
ALTER TABLE public.objectives
  DROP CONSTRAINT IF EXISTS objectives_state_check;

ALTER TABLE public.objectives
  ADD CONSTRAINT objectives_state_check
  CHECK (state IN ('draft', 'executing', 'blocked', 'complete'));

-- 2. Add agent_identifier to objectives (snapshot of agent at execution start)
ALTER TABLE public.objectives
  ADD COLUMN IF NOT EXISTS agent_identifier text;

COMMENT ON COLUMN public.objectives.agent_identifier
  IS 'Snapshot of the agent identifier when this objective entered execution.';

-- 3. Add objective_id FK to feed_posts
ALTER TABLE public.feed_posts
  ADD COLUMN IF NOT EXISTS objective_id uuid REFERENCES public.objectives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_feed_posts_objective ON public.feed_posts (objective_id);

COMMENT ON COLUMN public.feed_posts.objective_id
  IS 'Links the feed post to the specific objective it was generated for.';

-- 4. Backfill: set state = 'draft' for all draft objectives that have null state
UPDATE public.objectives
  SET state = 'draft'
  WHERE is_executed = false AND state IS NULL;

-- 5. Backfill: set state = 'complete' for executed objectives with null state
UPDATE public.objectives
  SET state = 'complete'
  WHERE is_executed = true AND state IS NULL;

-- 6. Backfill agent_identifier for executing objectives from the latest agent session
UPDATE public.objectives o
  SET agent_identifier = sub.agent_identifier
  FROM (
    SELECT DISTINCT ON (o2.id) o2.id AS objective_id, s.agent_identifier
    FROM public.objectives o2
    JOIN public.agent_sessions s ON s.ticket_id = o2.ticket_id
    WHERE o2.state = 'executing' AND o2.agent_identifier IS NULL
    ORDER BY o2.id, s.attached_at DESC
  ) sub
  WHERE o.id = sub.objective_id;

-- 7. Make state NOT NULL now that all rows have been backfilled
ALTER TABLE public.objectives
  ALTER COLUMN state SET DEFAULT 'draft';

ALTER TABLE public.objectives
  ALTER COLUMN state SET NOT NULL;
