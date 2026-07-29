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

CREATE TABLE IF NOT EXISTS execution_target_runner_registrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  execution_target_id TEXT NOT NULL REFERENCES execution_targets (id) ON DELETE CASCADE,
  runner_instance_id TEXT NOT NULL CHECK (length(trim(runner_instance_id)) > 0),
  relation TEXT NOT NULL CHECK (relation IN ('native', 'adopted')),
  label TEXT,
  runner_version TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(capabilities_json)),
  supported_agents_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(supported_agents_json)),
  health TEXT NOT NULL CHECK (length(trim(health)) > 0),
  last_heartbeat_at TEXT CHECK (last_heartbeat_at IS NULL OR last_heartbeat_at GLOB '????-??-??T??:??:??.???Z'),
  last_error_code TEXT,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_etrr_active_workspace_instance
  ON execution_target_runner_registrations (workspace_id, runner_instance_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_etrr_target_health_heartbeat
  ON execution_target_runner_registrations (workspace_id, execution_target_id, health, last_heartbeat_at);

-- Nullable so virtual claims and pre-upgrade runners (which publish no instance
-- identity) keep claiming exactly as before.
ALTER TABLE execution_requests ADD COLUMN claimed_by_runner_registration_id TEXT
  REFERENCES execution_target_runner_registrations (id) ON DELETE SET NULL;
