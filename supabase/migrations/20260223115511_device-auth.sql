create extension if not exists pgcrypto with schema extensions;


-- Device authorization codes for CLI login flow
CREATE TABLE device_auth_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code text NOT NULL UNIQUE,
  user_code text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  user_id uuid REFERENCES auth.users(id),
  access_token text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_auth_codes_device_code_idx ON device_auth_codes(device_code);
CREATE INDEX device_auth_codes_user_code_idx ON device_auth_codes(user_code);
CREATE INDEX device_auth_codes_expires_idx ON device_auth_codes(expires_at);

ALTER TABLE device_auth_codes ENABLE ROW LEVEL SECURITY;

-- Only the approving user can update their own device code row
CREATE POLICY "Users can approve own device codes"
  ON device_auth_codes FOR UPDATE TO authenticated
  USING (user_id IS NULL) WITH CHECK (user_id = auth.uid());

-- Service role reads all rows (used by API routes, bypasses RLS)


-- Agent tokens for CLI authentication (issued via device-code flow or directly)
CREATE TABLE agent_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  organization_id integer NOT NULL REFERENCES organizations(id),
  token text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  name text NOT NULL DEFAULT 'CLI Token',
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_tokens_token_idx ON agent_tokens(token);
CREATE INDEX agent_tokens_user_id_idx ON agent_tokens(user_id);

ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own agent tokens"
  ON agent_tokens FOR ALL TO authenticated
  USING (user_id = auth.uid());
