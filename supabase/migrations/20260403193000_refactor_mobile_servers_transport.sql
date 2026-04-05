-- Refactor mobile server records so remote endpoint metadata is shared,
-- while device-local key material stays on the device.

ALTER TABLE servers
  ADD COLUMN transport text NOT NULL DEFAULT 'ssh'
    CHECK (transport IN ('ssh', 'tailscale_ssh')),
  ADD COLUMN host_key_fingerprint text,
  ADD COLUMN last_verified_at timestamptz,
  ADD COLUMN last_error text;

UPDATE servers
SET
  transport = 'ssh',
  host_key_fingerprint = NULL,
  last_verified_at = CASE
    WHEN status = 'connected' OR key_installed = true THEN COALESCE(last_connected_at, created_at)
    ELSE NULL
  END,
  last_error = CASE
    WHEN status = 'error' THEN 'Connection requires verification from the updated mobile SSH flow.'
    ELSE NULL
  END;

ALTER TABLE servers
  DROP COLUMN secure_enclave_tag,
  DROP COLUMN ssh_public_key,
  DROP COLUMN ssh_key_fingerprint,
  DROP COLUMN key_installed;

ALTER TABLE servers
  DROP CONSTRAINT IF EXISTS servers_status_check;

ALTER TABLE servers
  ADD CONSTRAINT servers_status_check
    CHECK (status IN ('pending', 'connected', 'error'));
