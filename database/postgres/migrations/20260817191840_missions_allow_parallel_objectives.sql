-- Opt-in cross-resource objective parallelism (coo:756 Phase D).
--
-- Default false keeps today's serial sibling 409. When true, two objectives
-- on the same mission may execute at once only if their effective resource_keys
-- differ. Same-resource pairs stay serial until Phase E.

BEGIN;

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS allow_parallel_objectives boolean NOT NULL DEFAULT false;

COMMIT;
