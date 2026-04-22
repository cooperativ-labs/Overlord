-- Phase 1: per-user/per-project tracking of who creates coordination artifacts.
--
-- Two independent changes bundled together so the Deno MCP mirror only has to
-- bump once:
--
-- 1. Move `local_working_directory`, `remote_helper_installed_at`, and
--    `remote_helper_version` off projects and onto project_user. These are
--    inherently per-user facts once multiple people collaborate on a project.
--
-- 2. Add a nullable `created_by` FK to objectives, ticket_events, feed_posts,
--    and artifacts so we can attribute each row to the auth user who produced
--    it. See the recommendation artifact on ticket
--    4c9a9818-3f3c-4599-8242-895df9e1e832 for the rationale for using
--    auth.users.id directly rather than project_user.id.

-- ---------------------------------------------------------------------------
-- 1. Move project-level working-directory + helper fields onto project_user
-- ---------------------------------------------------------------------------

ALTER TABLE project_user ADD COLUMN local_working_directory text;
ALTER TABLE project_user ADD COLUMN remote_helper_installed_at timestamptz;
ALTER TABLE project_user ADD COLUMN remote_helper_version text;

-- Best-effort backfill onto project_user rows that already exist. Mirrors the
-- approach in 20260421113000_move_ssh_settings_to_project_user_preferences.sql:
-- we do not synthesize project_user rows here because membership/access is
-- governed elsewhere. Users who have never opened settings for this project
-- will re-enter their working directory on first use.
UPDATE project_user AS pu
SET
  local_working_directory = p.local_working_directory,
  remote_helper_installed_at = p.remote_helper_installed_at,
  remote_helper_version = p.remote_helper_version,
  updated_at = now()
FROM projects AS p
WHERE pu.project_id = p.id
  AND (
    p.local_working_directory IS NOT NULL
    OR p.remote_helper_installed_at IS NOT NULL
    OR p.remote_helper_version IS NOT NULL
  )
  AND pu.local_working_directory IS NULL
  AND pu.remote_helper_installed_at IS NULL
  AND pu.remote_helper_version IS NULL;

-- Create project_user rows for ticket creators in projects that currently have
-- a local_working_directory but no project_user row for that user. Without
-- this, launching Overlord in that repo would no longer resolve the project
-- after the column drop below.
INSERT INTO project_user (user_id, project_id, local_working_directory)
SELECT DISTINCT t.created_by, p.id, p.local_working_directory
FROM projects p
JOIN tickets t ON t.project_id = p.id
WHERE p.local_working_directory IS NOT NULL
  AND t.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM project_user pu
    WHERE pu.project_id = p.id AND pu.user_id = t.created_by
  )
ON CONFLICT (user_id, project_id) DO NOTHING;

ALTER TABLE projects DROP COLUMN local_working_directory;
ALTER TABLE projects DROP COLUMN remote_helper_installed_at;
ALTER TABLE projects DROP COLUMN remote_helper_version;

CREATE INDEX IF NOT EXISTS project_user_local_working_directory_idx
  ON project_user (local_working_directory)
  WHERE local_working_directory IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Attribution: created_by on objectives, ticket_events, feed_posts, artifacts
-- ---------------------------------------------------------------------------

ALTER TABLE objectives
  ADD COLUMN created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ticket_events
  ADD COLUMN created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE feed_posts
  ADD COLUMN created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE artifacts
  ADD COLUMN created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill from tickets.created_by for existing rows.
UPDATE objectives SET created_by = t.created_by
  FROM tickets t WHERE t.id = objectives.ticket_id AND objectives.created_by IS NULL;

UPDATE ticket_events SET created_by = t.created_by
  FROM tickets t WHERE t.id = ticket_events.ticket_id AND ticket_events.created_by IS NULL;

UPDATE feed_posts SET created_by = t.created_by
  FROM tickets t WHERE t.id = feed_posts.ticket_id AND feed_posts.created_by IS NULL;

UPDATE artifacts SET created_by = t.created_by
  FROM tickets t WHERE t.id = artifacts.ticket_id AND artifacts.created_by IS NULL;

CREATE INDEX IF NOT EXISTS objectives_created_by_idx ON objectives (created_by);
CREATE INDEX IF NOT EXISTS ticket_events_created_by_idx ON ticket_events (created_by);
CREATE INDEX IF NOT EXISTS feed_posts_created_by_idx ON feed_posts (created_by);
CREATE INDEX IF NOT EXISTS artifacts_created_by_idx ON artifacts (created_by);
