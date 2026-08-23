PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

DROP TABLE IF EXISTS temp.changed_files_objective_path_dedup;
CREATE TEMP TABLE changed_files_objective_path_dedup AS
WITH evidence AS (
  SELECT id, objective_id, file_path, last_observed_at, updated_at,
         CASE
           WHEN json_extract(observed_metadata_json, '$.source') = 'declared_edit'
            AND json_extract(observed_metadata_json, '$.quality') = 'direct' THEN 2
           WHEN json_extract(observed_metadata_json, '$.source') = 'window_observed'
            AND json_extract(observed_metadata_json, '$.quality') = 'window' THEN 1
           ELSE 0
         END AS evidence_strength
    FROM changed_files
   WHERE objective_id IS NOT NULL AND deleted_at IS NULL
), ranked AS (
  SELECT id,
         FIRST_VALUE(id) OVER (
           PARTITION BY objective_id, file_path
           ORDER BY evidence_strength DESC, last_observed_at DESC, updated_at DESC, id DESC
         ) AS canonical_id,
         FIRST_VALUE(id) OVER (
           PARTITION BY objective_id, file_path
           ORDER BY last_observed_at DESC, updated_at DESC, id DESC
         ) AS latest_id,
         ROW_NUMBER() OVER (
           PARTITION BY objective_id, file_path
           ORDER BY evidence_strength DESC, last_observed_at DESC, updated_at DESC, id DESC
         ) AS duplicate_rank
    FROM evidence
)
SELECT id AS duplicate_id, canonical_id, latest_id
  FROM ranked
 WHERE duplicate_rank > 1;

DROP INDEX IF EXISTS idx_changed_files_active_session_objective_path;

-- Preserve the strongest evidence row while carrying forward the full
-- observation window and the latest observer's mutable provenance.
UPDATE changed_files
   SET first_observed_at = (
         SELECT MIN(source.first_observed_at)
           FROM changed_files source
          WHERE source.objective_id = changed_files.objective_id
            AND source.file_path = changed_files.file_path
            AND source.deleted_at IS NULL
       ),
       created_at = (
         SELECT MIN(source.created_at)
           FROM changed_files source
          WHERE source.objective_id = changed_files.objective_id
            AND source.file_path = changed_files.file_path
            AND source.deleted_at IS NULL
       ),
       last_observed_at = (
         SELECT MAX(source.last_observed_at)
           FROM changed_files source
          WHERE source.objective_id = changed_files.objective_id
            AND source.file_path = changed_files.file_path
            AND source.deleted_at IS NULL
       ),
       updated_at = (
         SELECT MAX(source.updated_at)
           FROM changed_files source
          WHERE source.objective_id = changed_files.objective_id
            AND source.file_path = changed_files.file_path
            AND source.deleted_at IS NULL
       ),
       session_id = (
         SELECT source.session_id
           FROM changed_files source
          WHERE source.id = (
            SELECT latest_id FROM changed_files_objective_path_dedup dedup
             WHERE dedup.canonical_id = changed_files.id LIMIT 1
          )
       ),
       resource_id = COALESCE((
         SELECT source.resource_id
           FROM changed_files source
          WHERE source.id = (
            SELECT latest_id FROM changed_files_objective_path_dedup dedup
             WHERE dedup.canonical_id = changed_files.id LIMIT 1
          )
       ), resource_id),
       vcs_status = (
         SELECT source.vcs_status
           FROM changed_files source
          WHERE source.id = (
            SELECT latest_id FROM changed_files_objective_path_dedup dedup
             WHERE dedup.canonical_id = changed_files.id LIMIT 1
          )
       ),
       current_diff_state = (
         SELECT source.current_diff_state
           FROM changed_files source
          WHERE source.id = (
            SELECT latest_id FROM changed_files_objective_path_dedup dedup
             WHERE dedup.canonical_id = changed_files.id LIMIT 1
          )
       ),
       last_observed_event_id = (
         SELECT source.last_observed_event_id
           FROM changed_files source
          WHERE source.id = (
            SELECT latest_id FROM changed_files_objective_path_dedup dedup
             WHERE dedup.canonical_id = changed_files.id LIMIT 1
          )
       ),
       revision = (
         SELECT MAX(source.revision) + 1
           FROM changed_files source
          WHERE source.objective_id = changed_files.objective_id
            AND source.file_path = changed_files.file_path
            AND source.deleted_at IS NULL
       )
 WHERE id IN (SELECT canonical_id FROM changed_files_objective_path_dedup);

UPDATE change_rationales
   SET changed_file_id = (
         SELECT dedup.canonical_id
           FROM changed_files_objective_path_dedup dedup
          WHERE dedup.duplicate_id = change_rationales.changed_file_id
       )
 WHERE changed_file_id IN (
   SELECT duplicate_id FROM changed_files_objective_path_dedup
 );

DELETE FROM changed_files
 WHERE id IN (SELECT duplicate_id FROM changed_files_objective_path_dedup);

DROP TABLE changed_files_objective_path_dedup;
CREATE UNIQUE INDEX IF NOT EXISTS idx_changed_files_active_objective_path
  ON changed_files (objective_id, file_path)
  WHERE objective_id IS NOT NULL AND deleted_at IS NULL;

COMMIT;
