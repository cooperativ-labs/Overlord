-- Profile-scoped account connections (coo:1110, contract 153). Postgres
-- counterpart of database/sqlite/migrations/20261005120000_account_connections_profile_scope.sql:
-- the same columns, CHECKs, indexes, verbatim Everhour adoption, and scrub, done in
-- place because Postgres can alter the column and its CHECK.
BEGIN;

ALTER TABLE account_connections ALTER COLUMN organization_id DROP NOT NULL;

-- The v152 provider CHECK is an unnamed column constraint; find it by definition.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'account_connections'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%provider%knowledgebase%'
  LOOP
    EXECUTE format('ALTER TABLE account_connections DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE account_connections
  ADD CONSTRAINT account_connections_provider_check
    CHECK (provider IN ('knowledgebase', 'everhour', 'github')),
  ADD CONSTRAINT account_connections_scope_check
    CHECK ((provider = 'knowledgebase') = (organization_id IS NOT NULL)),
  ADD COLUMN credential_kind text NOT NULL DEFAULT 'oauth'
    CHECK (credential_kind IN ('oauth', 'api_key')),
  ADD COLUMN credential_format text NOT NULL DEFAULT 'connection-v1'
    CHECK (credential_format IN ('connection-v1', 'everhour-user-key-v1', 'github-user-oauth-v1')),
  ADD COLUMN external_account_id text,
  ADD COLUMN external_account_label text,
  ADD COLUMN external_account_avatar_url text,
  ADD COLUMN granted_scopes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN last_validated_at timestamptz;

-- NULL organization ids are distinct in idx_account_connections_live, so profile scope needs its own.
CREATE UNIQUE INDEX idx_account_connections_profile_live
  ON account_connections (owner_profile_id, provider, server_url)
  WHERE state <> 'disconnected' AND organization_id IS NULL;
CREATE UNIQUE INDEX idx_account_connections_github_account_live
  ON account_connections (provider, external_account_id)
  WHERE provider = 'github' AND state <> 'disconnected' AND external_account_id IS NOT NULL;

ALTER TABLE account_connection_authorizations ADD COLUMN return_url text;

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
