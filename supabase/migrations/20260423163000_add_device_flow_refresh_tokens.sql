ALTER TABLE device_auth_codes
  ADD COLUMN IF NOT EXISTS refresh_token text,
  ADD COLUMN IF NOT EXISTS access_token_expires_at timestamptz;
