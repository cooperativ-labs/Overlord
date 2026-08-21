-- Mission-scoped Run Queues: a queue may belong to exactly one mission so the
-- queue picker can default to "this mission's queue" and create it lazily
-- instead of provisioning a queue for every mission up front.
BEGIN;

ALTER TABLE run_queues ADD COLUMN mission_id text REFERENCES missions (id) ON DELETE CASCADE;

CREATE UNIQUE INDEX idx_run_queues_mission ON run_queues (mission_id)
  WHERE mission_id IS NOT NULL AND deleted_at IS NULL;

-- Adopt the mission-named queues the Run Queue backfill created so they become
-- the authoritative mission queue rather than a second, unlinked one.
UPDATE run_queues q
   SET mission_id = m.id
  FROM missions m
 WHERE q.deleted_at IS NULL
   AND q.is_default = false
   AND q.mission_id IS NULL
   AND m.deleted_at IS NULL
   AND m.project_id = q.project_id
   AND q.name = 'Run Queue · ' || m.display_id;

COMMIT;
