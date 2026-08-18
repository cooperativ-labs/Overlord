-- Opt-in cross-resource objective parallelism (coo:756 Phase D).
--
-- Default false keeps today's serial sibling 409. When true, two objectives
-- on the same mission may execute at once only if their effective resource_keys
-- differ. Same-resource pairs stay serial until Phase E.

PRAGMA foreign_keys = ON;

ALTER TABLE missions ADD COLUMN allow_parallel_objectives INTEGER NOT NULL DEFAULT 0
  CHECK (allow_parallel_objectives IN (0, 1));
