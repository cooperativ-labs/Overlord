-- Retryable composite project initialization (coo:448). See SQLite migration.
CREATE TABLE IF NOT EXISTS ext_github_project_initializations (
  id text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mission_id text NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  github_owner_login text,
  provisioning_status text NOT NULL CHECK (provisioning_status IN ('not_requested', 'pending', 'failed', 'succeeded')),
  github_repo_id text,
  full_name text,
  default_branch text,
  clone_url text,
  failure_message text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_github_project_initializations_profile_key_active
  ON ext_github_project_initializations (profile_id, idempotency_key) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_github_project_initializations_project_active
  ON ext_github_project_initializations (workspace_id, project_id) WHERE deleted_at IS NULL;
