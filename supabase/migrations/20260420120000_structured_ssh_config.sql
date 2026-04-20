-- Structured SSH connection config for projects.
--
-- Adds fields consumed by the Electron tunnel manager (ssh2 npm lib) and the
-- mobile client. Leaves the legacy `ssh_command` free-form string in place for
-- one release so existing code paths keep working; Phase 4 removes it and
-- per product decision (2026-04-20) users will re-enter their SSH details.

ALTER TABLE projects ADD COLUMN ssh_host text;
ALTER TABLE projects ADD COLUMN ssh_port integer;
ALTER TABLE projects ADD COLUMN ssh_user text;
ALTER TABLE projects ADD COLUMN ssh_auth_method text
  CHECK (ssh_auth_method IS NULL OR ssh_auth_method IN ('agent', 'key', 'tailscale'));
ALTER TABLE projects ADD COLUMN ssh_private_key_path text;

-- Install state: populated after the remote helper is installed on the host.
-- The bearer token lives only on the client (electron-store / mobile secure
-- storage) so it never rides on the wire to our backend.
ALTER TABLE projects ADD COLUMN remote_helper_installed_at timestamptz;
ALTER TABLE projects ADD COLUMN remote_helper_version text;
