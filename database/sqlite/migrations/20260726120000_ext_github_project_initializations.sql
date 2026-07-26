-- Retryable composite project initialization (coo:448). Credentials remain in
-- ext_github_user_connections; this record contains only non-secret metadata.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ext_github_project_initializations (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 200),
  github_owner_login TEXT,
  provisioning_status TEXT NOT NULL CHECK (provisioning_status IN ('not_requested', 'pending', 'failed', 'succeeded')),
  github_repo_id TEXT,
  full_name TEXT,
  default_branch TEXT,
  clone_url TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_github_project_initializations_profile_key_active
  ON ext_github_project_initializations (profile_id, idempotency_key) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_github_project_initializations_project_active
  ON ext_github_project_initializations (workspace_id, project_id) WHERE deleted_at IS NULL;
