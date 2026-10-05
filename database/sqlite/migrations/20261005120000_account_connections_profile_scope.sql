-- Profile-scoped account connections (coo:1110, contract 153).
--
-- `account_connections` gains a profile scope (nullable organization_id) for the
-- personal integrations (Everhour API key now, GitHub repository authorization in
-- coo:1110.ykk0), a credential kind and format, and upstream account metadata.
-- SQLite cannot widen a CHECK or drop NOT NULL in place, so the table is rebuilt.
-- `account_connection_authorizations` (CASCADE) and `chat_source_refs` (SET NULL)
-- reference it; foreign keys are off for the rebuild so neither action fires, and
-- the textual references resolve to the renamed table. No trigger or view
-- references the table.
--
-- Live Everhour personal keys are then copied verbatim (same id and envelope, the
-- legacy format and the `everhour-env` key id), so no key is needed here and no
-- plaintext is in flight; the module opens them through its key ring and re-seals
-- them under the current key on first use. Ciphertext and plaintext left behind in
-- soft-deleted legacy rows are scrubbed. GitHub rows are copied by coo:1110.ykk0,
-- when its legacy routes stop writing.

PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE account_connections_v153 (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('knowledgebase', 'everhour', 'github')),
  server_url TEXT NOT NULL CHECK (server_url LIKE 'https://%'),
  state TEXT NOT NULL CHECK (state IN ('pending', 'connected', 'reauthorization_required', 'disconnected')),
  authorized_workspaces_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(authorized_workspaces_json)),
  tool_policy_version INTEGER NOT NULL DEFAULT 1 CHECK (tool_policy_version >= 1),
  credential_kind TEXT NOT NULL DEFAULT 'oauth' CHECK (credential_kind IN ('oauth', 'api_key')),
  credential_format TEXT NOT NULL DEFAULT 'connection-v1' CHECK (credential_format IN ('connection-v1', 'everhour-user-key-v1', 'github-user-oauth-v1')),
  credential_ciphertext TEXT,
  credential_key_id TEXT,
  credential_revision INTEGER NOT NULL DEFAULT 0 CHECK (credential_revision >= 0),
  external_account_id TEXT,
  external_account_label TEXT,
  external_account_avatar_url TEXT,
  granted_scopes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(granted_scopes_json)),
  last_validated_at TEXT CHECK (last_validated_at IS NULL OR last_validated_at GLOB '????-??-??T??:??:??.???Z'),
  access_expires_at TEXT CHECK (access_expires_at IS NULL OR access_expires_at GLOB '????-??-??T??:??:??.???Z'),
  refresh_expires_at TEXT CHECK (refresh_expires_at IS NULL OR refresh_expires_at GLOB '????-??-??T??:??:??.???Z'),
  refresh_lock_owner TEXT,
  refresh_lock_until TEXT CHECK (refresh_lock_until IS NULL OR refresh_lock_until GLOB '????-??-??T??:??:??.???Z'),
  last_refreshed_at TEXT CHECK (last_refreshed_at IS NULL OR last_refreshed_at GLOB '????-??-??T??:??:??.???Z'),
  last_error_code TEXT,
  connected_at TEXT CHECK (connected_at IS NULL OR connected_at GLOB '????-??-??T??:??:??.???Z'),
  disconnected_at TEXT CHECK (disconnected_at IS NULL OR disconnected_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK ((provider = 'knowledgebase') = (organization_id IS NOT NULL)),
  CHECK (state <> 'connected' OR credential_ciphertext IS NOT NULL),
  CHECK (state <> 'disconnected' OR (credential_ciphertext IS NULL AND disconnected_at IS NOT NULL)),
  CHECK ((credential_ciphertext IS NULL) = (credential_key_id IS NULL))
);

INSERT INTO account_connections_v153 (
  id, owner_profile_id, organization_id, provider, server_url, state,
  authorized_workspaces_json, tool_policy_version, credential_ciphertext, credential_key_id,
  credential_revision, access_expires_at, refresh_expires_at, refresh_lock_owner,
  refresh_lock_until, last_refreshed_at, last_error_code, connected_at, disconnected_at,
  created_at, updated_at, revision
)
SELECT
  id, owner_profile_id, organization_id, provider, server_url, state,
  authorized_workspaces_json, tool_policy_version, credential_ciphertext, credential_key_id,
  credential_revision, access_expires_at, refresh_expires_at, refresh_lock_owner,
  refresh_lock_until, last_refreshed_at, last_error_code, connected_at, disconnected_at,
  created_at, updated_at, revision
FROM account_connections;

DROP TABLE account_connections;
ALTER TABLE account_connections_v153 RENAME TO account_connections;

CREATE UNIQUE INDEX idx_account_connections_live
  ON account_connections (owner_profile_id, organization_id, provider, server_url)
  WHERE state <> 'disconnected';
-- NULL organization ids are distinct in the index above, so profile scope needs its own.
CREATE UNIQUE INDEX idx_account_connections_profile_live
  ON account_connections (owner_profile_id, provider, server_url)
  WHERE state <> 'disconnected' AND organization_id IS NULL;
CREATE UNIQUE INDEX idx_account_connections_github_account_live
  ON account_connections (provider, external_account_id)
  WHERE provider = 'github' AND state <> 'disconnected' AND external_account_id IS NOT NULL;
CREATE INDEX idx_account_connections_refresh_lock
  ON account_connections (refresh_lock_until) WHERE refresh_lock_owner IS NOT NULL;

ALTER TABLE account_connection_authorizations ADD COLUMN return_url TEXT;

-- Adopt live Everhour personal keys. The guard is "no Everhour row in any state",
-- so a profile that already disconnected in the module is never resurrected.
INSERT INTO account_connections (
  id, owner_profile_id, organization_id, provider, server_url, state,
  credential_kind, credential_format, credential_ciphertext, credential_key_id,
  credential_revision, external_account_id, external_account_label, last_validated_at,
  connected_at, created_at, updated_at, revision
)
SELECT
  legacy.id, legacy.profile_id, NULL, 'everhour', 'https://api.everhour.com', 'connected',
  'api_key', 'everhour-user-key-v1', legacy.api_key_ciphertext, 'everhour-env',
  1, legacy.account_id, legacy.account_name, legacy.last_validated_at,
  legacy.created_at, legacy.created_at, legacy.updated_at, 1
FROM ext_everhour_user_connections legacy
WHERE legacy.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM account_connections existing
    WHERE existing.owner_profile_id = legacy.profile_id AND existing.provider = 'everhour'
  );

-- Scrub secrets left in soft-deleted legacy rows.
UPDATE ext_everhour_user_connections
   SET api_key_ciphertext = 'revoked:v1'
 WHERE deleted_at IS NOT NULL AND api_key_ciphertext <> 'revoked:v1';
UPDATE ext_everhour_workspace_connections
   SET api_key_secret = 'revoked:v1'
 WHERE deleted_at IS NOT NULL AND api_key_secret <> 'revoked:v1';

COMMIT;
PRAGMA foreign_keys = ON;
