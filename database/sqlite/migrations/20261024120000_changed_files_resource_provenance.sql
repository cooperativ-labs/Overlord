-- coo:1199 breaking cutover: compact resource-aware changed-file evidence and
-- bounded per-session capture diagnostics. Per-file rationale storage, VCS
-- status, current-diff state, and window metadata are retired. Existing paths,
-- summaries, artifacts, and delivery reports are preserved; provenance is mapped
-- only where it is reliable and is otherwise left NULL (unknown).
PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

ALTER TABLE changed_files ADD COLUMN source TEXT
  CHECK (source IS NULL OR source IN ('declared_edit', 'agent_declared'));
ALTER TABLE changed_files ADD COLUMN hook_health TEXT;
ALTER TABLE changed_files ADD COLUMN sync_keys_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(sync_keys_json));

-- Reliable provenance only:
--   * the latest observation was a native hook edit (`direct_path_observed`):
--     at least one successful native observation exists, so the row is native;
--   * a generator declaration with exactly one observation is a pure declaration;
--   * a sessionless row with no ledger metadata came from record-work, whose
--     explicit path list is an agent declaration.
-- A declaration that merged over earlier observations cannot be attributed, and
-- window evidence is never promoted to native.
UPDATE changed_files
   SET source = CASE
         WHEN json_extract(observed_metadata_json, '$.source') = 'declared_edit'
          AND json_extract(observed_metadata_json, '$.hookHealth') = 'direct_path_observed'
           THEN 'declared_edit'
         WHEN json_extract(observed_metadata_json, '$.source') = 'declared_edit'
          AND json_extract(observed_metadata_json, '$.hookHealth') = 'agent_declared_generator_output'
          AND COALESCE(json_array_length(json_extract(observed_metadata_json, '$.syncKeys')), 0) = 1
           THEN 'agent_declared'
         WHEN session_id IS NULL AND observed_metadata_json = '{}'
           THEN 'agent_declared'
         ELSE NULL
       END,
       hook_health = CASE
         WHEN json_extract(observed_metadata_json, '$.source') = 'declared_edit'
          AND json_type(observed_metadata_json, '$.hookHealth') = 'text'
          AND length(json_extract(observed_metadata_json, '$.hookHealth')) <= 160
           THEN json_extract(observed_metadata_json, '$.hookHealth')
         ELSE NULL
       END,
       sync_keys_json = CASE
         WHEN json_type(observed_metadata_json, '$.syncKeys') = 'array'
           THEN json_extract(observed_metadata_json, '$.syncKeys')
         ELSE '[]'
       END;

DROP INDEX IF EXISTS idx_changed_files_active_objective_path;
ALTER TABLE changed_files DROP COLUMN vcs_status;
ALTER TABLE changed_files DROP COLUMN current_diff_state;
ALTER TABLE changed_files DROP COLUMN observed_metadata_json;

-- One displayed row per objective + resolved resource + normalized path.
CREATE UNIQUE INDEX idx_changed_files_active_objective_resource_path
  ON changed_files (objective_id, (COALESCE(resource_id, '')), file_path)
  WHERE deleted_at IS NULL;

DROP TABLE change_rationales;
DELETE FROM entity_changes WHERE entity_type = 'change_rationale';

-- Bounded capture diagnostics live on the session so an empty path list still
-- explains why. `capture_health_json` holds per-code first/last/count aggregates
-- (at most 16 codes) and never raw callbacks, commands, or environment values.
ALTER TABLE agent_sessions ADD COLUMN capture_binding_state TEXT NOT NULL DEFAULT 'unknown'
  CHECK (capture_binding_state IN ('bound', 'unbound', 'unknown'));
ALTER TABLE agent_sessions ADD COLUMN capture_callback_observed_at TEXT
  CHECK (capture_callback_observed_at IS NULL
    OR capture_callback_observed_at GLOB '????-??-??T??:??:??.???Z');
ALTER TABLE agent_sessions ADD COLUMN capture_health_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(capture_health_json));

COMMIT;
