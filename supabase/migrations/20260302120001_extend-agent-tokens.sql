-- Add token lifecycle columns to agent_tokens for revocation and expiry support
ALTER TABLE agent_tokens
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS agent_tokens_revoked_at_idx
  ON agent_tokens(revoked_at) WHERE revoked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_tokens_expires_at_idx
  ON agent_tokens(expires_at) WHERE expires_at IS NOT NULL;
