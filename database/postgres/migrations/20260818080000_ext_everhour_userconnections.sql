-- Profile-scoped Everhour API-key persistence (coo:769). See SQLite migration.

CREATE TABLE IF NOT EXISTS ext_everhour_user_connections (
  id text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  api_key_ciphertext text NOT NULL CHECK (char_length(btrim(api_key_ciphertext)) > 0),
  account_id text,
  account_name text,
  last_validated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_everhour_user_connections_profile_active
  ON ext_everhour_user_connections (profile_id) WHERE deleted_at IS NULL;
