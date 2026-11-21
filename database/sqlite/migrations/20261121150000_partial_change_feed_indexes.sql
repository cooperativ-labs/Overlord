BEGIN IMMEDIATE;

CREATE INDEX IF NOT EXISTS idx_entity_changes_project_nonnull_seq
  ON entity_changes (project_id, seq) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entity_changes_mission_nonnull
  ON entity_changes (mission_id) WHERE mission_id IS NOT NULL;

DROP INDEX IF EXISTS idx_entity_changes_project_seq;
DROP INDEX IF EXISTS idx_entity_changes_mission_seq;
COMMIT;
