-- coo:1199 breaking cutover: compact resource-aware changed-file evidence and
-- bounded per-session capture diagnostics. Same semantics as the SQLite
-- migration of the same name; see it for the provenance mapping rules.
BEGIN;

ALTER TABLE changed_files
  ADD COLUMN source text CHECK (source IS NULL OR source IN ('declared_edit', 'agent_declared')),
  ADD COLUMN hook_health text,
  ADD COLUMN sync_keys_json jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE changed_files
   SET source = CASE
         WHEN observed_metadata_json ->> 'source' = 'declared_edit'
          AND observed_metadata_json ->> 'hookHealth' = 'direct_path_observed'
           THEN 'declared_edit'
         WHEN observed_metadata_json ->> 'source' = 'declared_edit'
          AND observed_metadata_json ->> 'hookHealth' = 'agent_declared_generator_output'
          AND CASE WHEN jsonb_typeof(observed_metadata_json -> 'syncKeys') = 'array'
                   THEN jsonb_array_length(observed_metadata_json -> 'syncKeys') ELSE 0 END = 1
           THEN 'agent_declared'
         WHEN session_id IS NULL AND observed_metadata_json = '{}'::jsonb
           THEN 'agent_declared'
         ELSE NULL
       END,
       hook_health = CASE
         WHEN observed_metadata_json ->> 'source' = 'declared_edit'
          AND jsonb_typeof(observed_metadata_json -> 'hookHealth') = 'string'
          AND char_length(observed_metadata_json ->> 'hookHealth') <= 160
           THEN observed_metadata_json ->> 'hookHealth'
         ELSE NULL
       END,
       sync_keys_json = CASE
         WHEN jsonb_typeof(observed_metadata_json -> 'syncKeys') = 'array'
           THEN observed_metadata_json -> 'syncKeys'
         ELSE '[]'::jsonb
       END;

DROP INDEX IF EXISTS idx_changed_files_active_objective_path;
ALTER TABLE changed_files
  DROP COLUMN vcs_status,
  DROP COLUMN current_diff_state,
  DROP COLUMN observed_metadata_json;

CREATE UNIQUE INDEX idx_changed_files_active_objective_resource_path
  ON changed_files (objective_id, (COALESCE(resource_id, '')), file_path)
  WHERE deleted_at IS NULL;

DROP TABLE change_rationales;
DELETE FROM entity_changes WHERE entity_type = 'change_rationale';

ALTER TABLE agent_sessions
  ADD COLUMN capture_binding_state text NOT NULL DEFAULT 'unknown'
    CHECK (capture_binding_state IN ('bound', 'unbound', 'unknown')),
  ADD COLUMN capture_callback_observed_at timestamptz,
  ADD COLUMN capture_health_json jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
