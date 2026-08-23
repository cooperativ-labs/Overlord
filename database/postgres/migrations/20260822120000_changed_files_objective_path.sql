BEGIN;

CREATE TEMP TABLE changed_files_objective_path_dedup ON COMMIT DROP AS
WITH evidence AS (
  SELECT id, objective_id, file_path, last_observed_at, updated_at,
         CASE
           WHEN observed_metadata_json ->> 'source' = 'declared_edit'
            AND observed_metadata_json ->> 'quality' = 'direct' THEN 2
           WHEN observed_metadata_json ->> 'source' = 'window_observed'
            AND observed_metadata_json ->> 'quality' = 'window' THEN 1
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
UPDATE changed_files canonical
   SET first_observed_at = source.first_observed_at,
       created_at = source.created_at,
       last_observed_at = source.last_observed_at,
       updated_at = source.updated_at,
       session_id = latest.session_id,
       resource_id = COALESCE(latest.resource_id, canonical.resource_id),
       vcs_status = latest.vcs_status,
       current_diff_state = latest.current_diff_state,
       last_observed_event_id = latest.last_observed_event_id,
       revision = source.revision + 1
  FROM (
    SELECT objective_id, file_path,
           MIN(first_observed_at) AS first_observed_at,
           MIN(created_at) AS created_at,
           MAX(last_observed_at) AS last_observed_at,
           MAX(updated_at) AS updated_at,
           MAX(revision) AS revision
      FROM changed_files
     WHERE objective_id IS NOT NULL AND deleted_at IS NULL
     GROUP BY objective_id, file_path
  ) source,
  (SELECT DISTINCT canonical_id, latest_id FROM changed_files_objective_path_dedup) mapping,
  changed_files latest
 WHERE canonical.id = mapping.canonical_id
   AND latest.id = mapping.latest_id
   AND canonical.objective_id = source.objective_id
   AND canonical.file_path = source.file_path
   AND canonical.deleted_at IS NULL;

UPDATE change_rationales rationale
   SET changed_file_id = dedup.canonical_id
  FROM changed_files_objective_path_dedup dedup
 WHERE rationale.changed_file_id = dedup.duplicate_id;

DELETE FROM changed_files duplicate
 USING changed_files_objective_path_dedup dedup
 WHERE duplicate.id = dedup.duplicate_id;

DROP TABLE changed_files_objective_path_dedup;
CREATE UNIQUE INDEX IF NOT EXISTS idx_changed_files_active_objective_path
  ON changed_files (objective_id, file_path)
  WHERE objective_id IS NOT NULL AND deleted_at IS NULL;

COMMIT;
