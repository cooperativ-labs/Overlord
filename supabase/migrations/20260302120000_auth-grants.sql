-- Phase 1: auth_grants table (replaces device_auth_codes for new flows)
-- and hardened agent_tokens columns

-- Extend agent_tokens with lifecycle columns
ALTER TABLE agent_tokens
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by_grant_id uuid; -- FK added after auth_grants table created

-- Generic authorization grants table (browser-mediated flow for CLI and Electron)
CREATE TABLE auth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The one-time code embedded in the browser URL (short-lived, pollable)
  grant_code text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  -- Human-readable code shown in the UI for the user to verify
  user_code text NOT NULL UNIQUE,
  client_type text NOT NULL DEFAULT 'cli' CHECK (client_type IN ('cli', 'electron')),
  client_name text,
  -- Lifecycle timestamps
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  approved_at timestamptz,
  consumed_at timestamptz,
  -- Set on approval
  user_id uuid REFERENCES auth.users(id),
  agent_token_id uuid REFERENCES agent_tokens(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_grants_grant_code_idx ON auth_grants(grant_code);
CREATE INDEX auth_grants_user_code_idx ON auth_grants(user_code);
CREATE INDEX auth_grants_expires_idx ON auth_grants(expires_at);

ALTER TABLE auth_grants ENABLE ROW LEVEL SECURITY;

-- Users can only update rows where they are the approver (user_id IS NULL initially)
CREATE POLICY "Users can approve own grants"
  ON auth_grants FOR UPDATE TO authenticated
  USING (user_id IS NULL) WITH CHECK (user_id = auth.uid());

-- Now add the FK from agent_tokens back to auth_grants
ALTER TABLE agent_tokens
  ADD CONSTRAINT agent_tokens_created_by_grant_id_fkey
  FOREIGN KEY (created_by_grant_id) REFERENCES auth_grants(id);

-- Index for revoked/expired token lookups
CREATE INDEX agent_tokens_revoked_at_idx ON agent_tokens(revoked_at) WHERE revoked_at IS NOT NULL;
CREATE INDEX agent_tokens_expires_at_idx ON agent_tokens(expires_at) WHERE expires_at IS NOT NULL;
