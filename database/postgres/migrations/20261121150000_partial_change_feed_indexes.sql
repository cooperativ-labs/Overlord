BEGIN;
SET LOCAL lock_timeout = '2s';

-- Cloud operators can build these concurrently before deploying the migration.
CREATE INDEX IF NOT EXISTS idx_entity_changes_project_nonnull_seq
  ON entity_changes (project_id, seq) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entity_changes_mission_nonnull
  ON entity_changes (mission_id) WHERE mission_id IS NOT NULL;

-- An interrupted concurrent build can leave an invalid index with the expected name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('idx_entity_changes_project_nonnull_seq', ' USING btree (project_id, seq) WHERE (project_id IS NOT NULL)'),
      ('idx_entity_changes_mission_nonnull', ' USING btree (mission_id) WHERE (mission_id IS NOT NULL)')
    ) AS expected(name, definition)
    LEFT JOIN pg_index AS actual
      ON actual.indexrelid = to_regclass(expected.name)
      AND actual.indrelid = 'entity_changes'::regclass
      AND actual.indisvalid
      AND right(pg_get_indexdef(actual.indexrelid), length(expected.definition)) = expected.definition
    WHERE actual.indexrelid IS NULL
  ) THEN
    RAISE EXCEPTION 'Repair the prebuilt entity_changes indexes before retrying the migration';
  END IF;
END $$;

DROP INDEX IF EXISTS idx_entity_changes_project_seq, idx_entity_changes_mission_seq;
COMMIT;
