-- Public OAuth clients should not use NULL client_secret_hash.
-- Some GoTrue versions scan this field into a non-nullable string.
UPDATE auth.oauth_clients
SET client_secret_hash = ''
WHERE client_type = 'public'
  AND token_endpoint_auth_method = 'none'
  AND client_secret_hash IS NULL;
