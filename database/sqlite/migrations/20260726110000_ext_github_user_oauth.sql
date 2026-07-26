-- User-scoped GitHub OAuth persistence (coo:448).
--
-- This is deliberately separate from both Better Auth's social-login account
-- rows and the workspace-scoped GitHub App installation. Provider credentials
-- are stored only as AES-256-GCM ciphertext.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ext_github_user_connections (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  github_user_id TEXT NOT NULL CHECK (length(trim(github_user_id)) > 0),
  github_login TEXT NOT NULL CHECK (length(trim(github_login)) > 0),
  avatar_url TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  access_token_ciphertext TEXT NOT NULL CHECK (length(trim(access_token_ciphertext)) > 0),
  refresh_token_ciphertext TEXT,
  access_token_expires_at TEXT CHECK (
    access_token_expires_at IS NULL OR access_token_expires_at GLOB '????-??-??T??:??:??.???Z'
  ),
  refresh_token_expires_at TEXT CHECK (
    refresh_token_expires_at IS NULL OR refresh_token_expires_at GLOB '????-??-??T??:??:??.???Z'
  ),
  last_validated_at TEXT NOT NULL CHECK (last_validated_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_github_user_connections_profile_active
  ON ext_github_user_connections (profile_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_github_user_connections_github_user_active
  ON ext_github_user_connections (github_user_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ext_github_user_oauth_states (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  state_hash TEXT NOT NULL CHECK (length(state_hash) = 64),
  return_url TEXT,
  expires_at TEXT NOT NULL CHECK (expires_at GLOB '????-??-??T??:??:??.???Z'),
  consumed_at TEXT CHECK (consumed_at IS NULL OR consumed_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_github_user_oauth_states_hash_active
  ON ext_github_user_oauth_states (state_hash) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ext_github_user_oauth_states_expiry
  ON ext_github_user_oauth_states (expires_at, consumed_at);
