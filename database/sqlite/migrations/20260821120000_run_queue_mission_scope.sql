-- Mission-scoped Run Queues: a queue may belong to exactly one mission so the
-- queue picker can default to "this mission's queue" and create it lazily
-- instead of provisioning a queue for every mission up front.
PRAGMA foreign_keys = ON;
BEGIN;

ALTER TABLE run_queues ADD COLUMN mission_id TEXT REFERENCES missions (id) ON DELETE CASCADE;

CREATE UNIQUE INDEX idx_run_queues_mission ON run_queues (mission_id)
  WHERE mission_id IS NOT NULL AND deleted_at IS NULL;

-- Adopt the mission-named queues the Run Queue backfill created so they become
-- the authoritative mission queue rather than a second, unlinked one.
UPDATE run_queues
   SET mission_id = (
     SELECT m.id FROM missions m
      WHERE m.deleted_at IS NULL
        AND m.project_id = run_queues.project_id
        AND run_queues.name = 'Run Queue · ' || m.display_id
   )
 WHERE deleted_at IS NULL AND is_default = 0 AND mission_id IS NULL;

COMMIT;
