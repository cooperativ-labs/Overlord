-- Servers table: stores SSH server connection details per user.
-- No plaintext passwords — authentication is via SSH keys generated in the iOS Secure Enclave.

CREATE TABLE servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL,
  -- The SSH public key in OpenSSH authorized_keys format (ecdsa-sha2-nistp256 ...)
  ssh_public_key TEXT,
  -- Fingerprint of the public key for display (SHA256:...)
  ssh_key_fingerprint TEXT,
  -- Secure Enclave key tag used to reference the private key on the device
  secure_enclave_tag TEXT,
  -- Whether the SSH key has been successfully installed on the server
  key_installed BOOLEAN NOT NULL DEFAULT FALSE,
  -- Last successful connection timestamp
  last_connected_at TIMESTAMPTZ,
  -- Connection status for quick display
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'error', 'key_installed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups by user
CREATE INDEX idx_servers_user_id ON servers(user_id);
CREATE INDEX idx_servers_org_id ON servers(organization_id);

-- RLS policies
ALTER TABLE servers ENABLE ROW LEVEL SECURITY;

-- Users can only see their own servers
CREATE POLICY "Users can view own servers"
  ON servers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own servers"
  ON servers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own servers"
  ON servers FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own servers"
  ON servers FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update updated_at
CREATE TRIGGER set_servers_updated_at
  BEFORE UPDATE ON servers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
