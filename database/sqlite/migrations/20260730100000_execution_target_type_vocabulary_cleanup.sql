-- Execution-target type vocabulary cleanup (coo:528, contract 44)
--
-- Drops the unused core `ssh` execution_targets.type value and removes the dead
-- execution_requests.target_kind column. Keeps local/virtual as the claimant
-- security boundary; transport variety belongs in the provider registry.

PRAGMA foreign_keys = OFF;

UPDATE execution_targets
SET type = 'virtual'
WHERE type = 'ssh';

CREATE TABLE execution_targets_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  device_id TEXT REFERENCES devices (id) ON DELETE SET NULL,
  owner_workspace_user_id TEXT REFERENCES workspace_users (id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('local', 'virtual')),
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'unavailable')),
  connection_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(connection_json)),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (type <> 'local' OR device_id IS NOT NULL)
);

INSERT INTO execution_targets_new (
  id, workspace_id, device_id, owner_workspace_user_id, type, label, status,
  connection_json, created_at, updated_at, deleted_at, revision
)
SELECT
  id, workspace_id, device_id, owner_workspace_user_id, type, label, status,
  connection_json, created_at, updated_at, deleted_at, revision
FROM execution_targets;

DROP TABLE execution_targets;
ALTER TABLE execution_targets_new RENAME TO execution_targets;

CREATE INDEX idx_execution_targets_workspace_type_status ON execution_targets (workspace_id, type, status);
CREATE INDEX idx_execution_targets_workspace_device ON execution_targets (workspace_id, device_id);

ALTER TABLE execution_requests DROP COLUMN target_kind;

PRAGMA foreign_keys = ON;
