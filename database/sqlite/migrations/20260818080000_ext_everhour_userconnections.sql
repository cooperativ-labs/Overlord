-- Profile-scoped Everhour API-key persistence (coo:769).
--
-- The Everhour key authenticates a person, so it lives on the profile like
-- ext_github_user_connections. The credential is stored only as AES-256-GCM
-- ciphertext. ext_everhour_workspace_connections remains as a migration source.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ext_everhour_user_connections (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL CHECK (length(trim(api_key_ciphertext)) > 0),
  account_id TEXT,
  account_name TEXT,
  last_validated_at TEXT NOT NULL CHECK (last_validated_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_everhour_user_connections_profile_active
  ON ext_everhour_user_connections (profile_id) WHERE deleted_at IS NULL;
