-- Local runner instances and claim attribution (coo:522 phase 3, contract 40)
--
-- Adds the one-to-many record of live runner processes serving one `local`
-- execution target, plus the nullable execution_requests FK naming the runner
-- instance that won a local claim.
--
-- This is deliberately NOT a widening of execution_target_registrations: that
-- table is gateway-owned and its idx_etr_active_target unique index permits
-- exactly one active registration per virtual target. A host and the containers
-- adopting it must all register against the same local target row, which needs
-- a one-to-many relation of its own.

BEGIN;

CREATE TABLE IF NOT EXISTS execution_target_runner_registrations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  execution_target_id text NOT NULL REFERENCES execution_targets (id) ON DELETE CASCADE,
  runner_instance_id text NOT NULL CHECK (char_length(btrim(runner_instance_id)) > 0),
  relation text NOT NULL CHECK (relation IN ('native', 'adopted')),
  label text,
  runner_version text,
  capabilities_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  supported_agents_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  health text NOT NULL CHECK (char_length(btrim(health)) > 0),
  last_heartbeat_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_etrr_active_workspace_instance
  ON execution_target_runner_registrations (workspace_id, runner_instance_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_etrr_target_health_heartbeat
  ON execution_target_runner_registrations (workspace_id, execution_target_id, health, last_heartbeat_at);

-- Nullable so virtual claims and pre-upgrade runners (which publish no instance
-- identity) keep claiming exactly as before.
ALTER TABLE execution_requests
  ADD COLUMN IF NOT EXISTS claimed_by_runner_registration_id text
    REFERENCES execution_target_runner_registrations (id) ON DELETE SET NULL;

COMMIT;
