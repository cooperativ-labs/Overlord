-- Adopt GitHub personal repository authorizations (coo:1110.ykk0, contract 153).
--
-- From this version the GitHub `/ext/github/user-connection` routes are aliases of
-- the shared account-connections module and no longer write
-- `ext_github_user_connections`, so its live rows are copied here verbatim: same
-- id, the access and refresh envelopes as `{"access": ..., "refresh": ...}` in
-- format `github-user-oauth-v1`, key id `github-user-env`. No key is needed and no
-- plaintext is in flight; the module opens them through its key ring and re-seals
-- them under the current key on first use. A profile that already has a GitHub row
-- in any state is never resurrected, and a GitHub account already live on another
-- profile is skipped (one live GitHub account per profile). Ciphertext left in
-- soft-deleted legacy rows is scrubbed. Pending legacy OAuth states are not
-- migrated; they expire within ten minutes.

BEGIN;

INSERT INTO account_connections (
  id, owner_profile_id, organization_id, provider, server_url, state,
  credential_kind, credential_format, credential_ciphertext, credential_key_id,
  credential_revision, access_expires_at, refresh_expires_at,
  external_account_id, external_account_label, external_account_avatar_url,
  granted_scopes_json, last_validated_at, connected_at, created_at, updated_at, revision
)
SELECT
  legacy.id, legacy.profile_id, NULL, 'github', 'https://github.com', 'connected',
  'oauth', 'github-user-oauth-v1',
  json_object('access', legacy.access_token_ciphertext, 'refresh', legacy.refresh_token_ciphertext),
  'github-user-env',
  1, legacy.access_token_expires_at, legacy.refresh_token_expires_at,
  legacy.github_user_id, legacy.github_login, legacy.avatar_url,
  CASE WHEN json_valid(legacy.scopes_json) AND json_type(legacy.scopes_json) = 'array'
       THEN legacy.scopes_json ELSE '[]' END,
  legacy.last_validated_at, legacy.created_at, legacy.created_at, legacy.updated_at, 1
FROM ext_github_user_connections legacy
WHERE legacy.deleted_at IS NULL
  AND legacy.access_token_ciphertext <> 'revoked:v1'
  AND NOT EXISTS (SELECT 1 FROM account_connections existing WHERE existing.id = legacy.id)
  AND NOT EXISTS (
    SELECT 1 FROM account_connections existing
    WHERE existing.owner_profile_id = legacy.profile_id AND existing.provider = 'github'
  )
  AND NOT EXISTS (
    SELECT 1 FROM account_connections existing
    WHERE existing.provider = 'github'
      AND existing.external_account_id = legacy.github_user_id
      AND existing.state <> 'disconnected'
  );

-- Scrub secrets left in soft-deleted legacy rows.
UPDATE ext_github_user_connections
   SET access_token_ciphertext = 'revoked:v1', refresh_token_ciphertext = NULL
 WHERE deleted_at IS NOT NULL
   AND (access_token_ciphertext <> 'revoked:v1' OR refresh_token_ciphertext IS NOT NULL);

COMMIT;
