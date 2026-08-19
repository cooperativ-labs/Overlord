-- Contract v94: `next` distinguishes work intended to execute soon from draft.
BEGIN;

ALTER TABLE project_statuses DROP CONSTRAINT IF EXISTS project_statuses_type_check;
ALTER TABLE project_statuses
  ADD CONSTRAINT project_statuses_type_check
  CHECK (type IN ('draft', 'next', 'execute', 'review', 'complete', 'blocked', 'cancelled'));
ALTER TABLE missions DROP CONSTRAINT IF EXISTS missions_status_type_check;
ALTER TABLE missions
  ADD CONSTRAINT missions_status_type_check
  CHECK (status_type IN ('draft', 'next', 'execute', 'review', 'complete', 'blocked', 'cancelled'));

UPDATE project_statuses
   SET type = 'next', updated_at = now(), revision = revision + 1
 WHERE key = 'next_up' AND type = 'draft' AND deleted_at IS NULL;

INSERT INTO project_statuses (
  id, workspace_id, project_id, key, name, type, position, is_default,
  is_terminal, metadata_json, created_at, updated_at, revision
)
SELECT
  md5(random()::text || clock_timestamp()::text || p.id), p.workspace_id, p.id,
  'next_up', 'Next Up', 'next', COALESCE(max(ps.position), -1) + 1, false,
  false, '{}'::jsonb, now(), now(), 1
FROM projects p
LEFT JOIN project_statuses ps ON ps.project_id = p.id AND ps.deleted_at IS NULL
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM project_statuses existing
    WHERE existing.project_id = p.id AND existing.type = 'next' AND existing.deleted_at IS NULL
  )
GROUP BY p.id, p.workspace_id;

UPDATE missions m
   SET status_type = ps.type
  FROM project_statuses ps
 WHERE ps.project_id = m.project_id AND ps.id = m.status_id AND ps.type = 'next';

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_statuses_active_next
  ON project_statuses (project_id) WHERE type = 'next' AND deleted_at IS NULL;

COMMIT;
