-- Device flow now performs a full OAuth authorize round-trip so the CLI gets an
-- independent Supabase session rather than inheriting the browser's refresh_token.
ALTER TABLE device_auth_codes
  ADD COLUMN IF NOT EXISTS pkce_verifier text,
  ADD COLUMN IF NOT EXISTS oauth_state text;
