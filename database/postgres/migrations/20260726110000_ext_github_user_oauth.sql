-- User-scoped GitHub OAuth persistence (coo:448). See SQLite migration.

CREATE TABLE IF NOT EXISTS ext_github_user_connections (
  id text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  github_user_id text NOT NULL CHECK (char_length(btrim(github_user_id)) > 0),
  github_login text NOT NULL CHECK (char_length(btrim(github_login)) > 0),
  avatar_url text,
  scopes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  access_token_ciphertext text NOT NULL CHECK (char_length(btrim(access_token_ciphertext)) > 0),
  refresh_token_ciphertext text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  last_validated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_github_user_connections_profile_active
  ON ext_github_user_connections (profile_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_github_user_connections_github_user_active
  ON ext_github_user_connections (github_user_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ext_github_user_oauth_states (
  id text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  state_hash text NOT NULL CHECK (char_length(state_hash) = 64),
  return_url text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_github_user_oauth_states_hash_active
  ON ext_github_user_oauth_states (state_hash) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ext_github_user_oauth_states_expiry
  ON ext_github_user_oauth_states (expires_at, consumed_at);
