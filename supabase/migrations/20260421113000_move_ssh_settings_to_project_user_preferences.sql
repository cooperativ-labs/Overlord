-- Rename project_user_preferences to project_user and make it the canonical
-- per-user/per-project join row for both UI preferences and SSH execution
-- settings.

ALTER TABLE project_user_preferences RENAME TO project_user;

ALTER INDEX project_user_preferences_user_project_idx RENAME TO project_user_user_project_idx;
ALTER TABLE project_user
  RENAME CONSTRAINT project_user_preferences_project_id_fkey TO project_user_project_id_fkey;

ALTER TABLE project_user ADD COLUMN ssh_command text;
ALTER TABLE project_user ADD COLUMN remote_working_directory text;
ALTER TABLE project_user ADD COLUMN ssh_host text;
ALTER TABLE project_user ADD COLUMN ssh_port integer;
ALTER TABLE project_user ADD COLUMN ssh_user text;
ALTER TABLE project_user ADD COLUMN ssh_auth_method text
  CHECK (ssh_auth_method IS NULL OR ssh_auth_method IN ('agent', 'key', 'tailscale'));
ALTER TABLE project_user ADD COLUMN ssh_private_key_path text;

-- Best-effort backfill for users who already have a project_user row for a
-- project. We intentionally do not synthesize rows for every project member
-- because membership/access is governed elsewhere.
UPDATE project_user AS pu
SET
  ssh_command = p.ssh_command,
  remote_working_directory = p.remote_working_directory,
  ssh_host = p.ssh_host,
  ssh_port = p.ssh_port,
  ssh_user = p.ssh_user,
  ssh_auth_method = p.ssh_auth_method,
  ssh_private_key_path = p.ssh_private_key_path,
  updated_at = now()
FROM projects AS p
WHERE pu.project_id = p.id
  AND (
    p.ssh_command IS NOT NULL
    OR p.remote_working_directory IS NOT NULL
    OR p.ssh_host IS NOT NULL
    OR p.ssh_port IS NOT NULL
    OR p.ssh_user IS NOT NULL
    OR p.ssh_auth_method IS NOT NULL
    OR p.ssh_private_key_path IS NOT NULL
  )
  AND pu.ssh_command IS NULL
  AND pu.remote_working_directory IS NULL
  AND pu.ssh_host IS NULL
  AND pu.ssh_port IS NULL
  AND pu.ssh_user IS NULL
  AND pu.ssh_auth_method IS NULL
  AND pu.ssh_private_key_path IS NULL;

ALTER TABLE projects DROP COLUMN ssh_command;
ALTER TABLE projects DROP COLUMN remote_working_directory;
ALTER TABLE projects DROP COLUMN ssh_host;
ALTER TABLE projects DROP COLUMN ssh_port;
ALTER TABLE projects DROP COLUMN ssh_user;
ALTER TABLE projects DROP COLUMN ssh_auth_method;
ALTER TABLE projects DROP COLUMN ssh_private_key_path;
