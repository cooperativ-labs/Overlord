-- Drop legacy SSH columns from project_user.
--
-- All callers have been migrated to the new execution_targets family of tables:
--   - ssh_host / ssh_port / transport  → execution_targets
--   - ssh_user / ssh_auth_method / ssh_private_key_path → execution_target_ssh_credentials
--   - remote_working_directory → project_resource_directories.directory_path
--   - ssh_command → synthesised at read-time from the above
--
-- remote_helper_installed_at and remote_helper_version describe the state of the
-- ovld helper on a specific machine (execution target), not a per-user per-project
-- preference. They are never consumed by any UI or API route, so they are dropped
-- as well.  If per-target helper tracking is needed in future it should live on
-- user_execution_targets or execution_targets.

ALTER TABLE project_user DROP COLUMN IF EXISTS ssh_command;
ALTER TABLE project_user DROP COLUMN IF EXISTS remote_working_directory;
ALTER TABLE project_user DROP COLUMN IF EXISTS ssh_host;
ALTER TABLE project_user DROP COLUMN IF EXISTS ssh_port;
ALTER TABLE project_user DROP COLUMN IF EXISTS ssh_user;
ALTER TABLE project_user DROP COLUMN IF EXISTS ssh_auth_method;
ALTER TABLE project_user DROP COLUMN IF EXISTS ssh_private_key_path;
ALTER TABLE project_user DROP COLUMN IF EXISTS remote_helper_installed_at;
ALTER TABLE project_user DROP COLUMN IF EXISTS remote_helper_version;
