-- Mission-less local-target capability calls (coo:833 Phase B, contract v129).
--
-- `execution_requests` was written for one thing: launching an agent on an
-- objective, so `mission_id` / `objective_id` were NOT NULL. The same table is
-- now also the transport for local-target *capability calls* — a Latch probe, a
-- repository read, `doctor`, delivering an answer into a session — queued with
-- `requested_source = 'local_target_mutation'`. Most of those have no mission,
-- and the queue was forcing callers to invent one by picking whichever mission
-- happened to be newest in the project.
--
-- Both columns become nullable, but only for that one source: every other
-- request still requires both, enforced by a CHECK rather than by convention.
-- Such a row is authorized by `project_id` + `execution_target_id` instead.
--
-- SQLite cannot drop a NOT NULL constraint in place, so the table is rebuilt.
-- The column list is the live schema as of this migration (002_initial_core
-- plus the virtual-launch and runner-registration columns, minus the dropped
-- `target_kind`). Indexes and the run-queue idempotency triggers are recreated
-- because dropping the table takes them with it.

PRAGMA foreign_keys = OFF;

CREATE TABLE execution_requests_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
  mission_id TEXT REFERENCES missions (id) ON DELETE RESTRICT,
  objective_id TEXT REFERENCES objectives (id) ON DELETE RESTRICT,
  execution_target_id TEXT REFERENCES execution_targets (id) ON DELETE SET NULL,
  requested_agent TEXT,
  requested_model TEXT,
  requested_reasoning_effort TEXT,
  launch_mode TEXT NOT NULL CHECK (launch_mode IN ('run', 'ask')),
  launch_flags_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(launch_flags_json)),
  requested_source TEXT NOT NULL CHECK (length(trim(requested_source)) > 0),
  idempotency_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'launching', 'launched', 'failed', 'cleared', 'cancelled', 'expired')),
  requested_by_workspace_user_id TEXT REFERENCES workspace_users (id) ON DELETE SET NULL,
  claimed_by_device_id TEXT REFERENCES devices (id) ON DELETE SET NULL,
  claimed_by_execution_target_id TEXT REFERENCES execution_targets (id) ON DELETE SET NULL,
  claimed_at TEXT CHECK (claimed_at IS NULL OR claimed_at GLOB '????-??-??T??:??:??.???Z'),
  claim_expires_at TEXT CHECK (claim_expires_at IS NULL OR claim_expires_at GLOB '????-??-??T??:??:??.???Z'),
  launch_started_at TEXT CHECK (launch_started_at IS NULL OR launch_started_at GLOB '????-??-??T??:??:??.???Z'),
  launch_completed_at TEXT CHECK (launch_completed_at IS NULL OR launch_completed_at GLOB '????-??-??T??:??:??.???Z'),
  launched_session_id TEXT REFERENCES agent_sessions (id) ON DELETE SET NULL,
  resolved_resource_id TEXT REFERENCES project_resources (id) ON DELETE SET NULL,
  resolved_working_directory TEXT,
  last_error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  launch_snapshot_id TEXT REFERENCES execution_request_snapshots (id) ON DELETE SET NULL,
  failure_code TEXT,
  failure_phase TEXT,
  claimed_by_gateway_instance_id TEXT,
  claimed_by_runner_registration_id TEXT REFERENCES execution_target_runner_registrations (id) ON DELETE SET NULL,
  CHECK (requested_source <> 'auto_advance' OR idempotency_key IS NOT NULL),
  CHECK (
    requested_source = 'local_target_mutation'
    OR (mission_id IS NOT NULL AND objective_id IS NOT NULL)
  )
);

INSERT INTO execution_requests_new (
  id, workspace_id, project_id, mission_id, objective_id, execution_target_id,
  requested_agent, requested_model, requested_reasoning_effort, launch_mode,
  launch_flags_json, requested_source, idempotency_key, status,
  requested_by_workspace_user_id, claimed_by_device_id, claimed_by_execution_target_id,
  claimed_at, claim_expires_at, launch_started_at, launch_completed_at,
  launched_session_id, resolved_resource_id, resolved_working_directory, last_error,
  attempt_count, metadata_json, created_at, updated_at, deleted_at, revision,
  launch_snapshot_id, failure_code, failure_phase, claimed_by_gateway_instance_id,
  claimed_by_runner_registration_id
)
SELECT
  id, workspace_id, project_id, mission_id, objective_id, execution_target_id,
  requested_agent, requested_model, requested_reasoning_effort, launch_mode,
  launch_flags_json, requested_source, idempotency_key, status,
  requested_by_workspace_user_id, claimed_by_device_id, claimed_by_execution_target_id,
  claimed_at, claim_expires_at, launch_started_at, launch_completed_at,
  launched_session_id, resolved_resource_id, resolved_working_directory, last_error,
  attempt_count, metadata_json, created_at, updated_at, deleted_at, revision,
  launch_snapshot_id, failure_code, failure_phase, claimed_by_gateway_instance_id,
  claimed_by_runner_registration_id
FROM execution_requests;

DROP TABLE execution_requests;
ALTER TABLE execution_requests_new RENAME TO execution_requests;

CREATE INDEX idx_execution_requests_workspace_status_created ON execution_requests (workspace_id, status, created_at);
CREATE INDEX idx_execution_requests_project_status_created ON execution_requests (project_id, status, created_at);
CREATE INDEX idx_execution_requests_objective_status ON execution_requests (objective_id, status);
CREATE UNIQUE INDEX idx_execution_requests_workspace_idempotency ON execution_requests (workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER trg_execution_requests_run_queue_idempotency_insert
BEFORE INSERT ON execution_requests
WHEN new.requested_source = 'run_queue' AND new.idempotency_key IS NULL
BEGIN SELECT RAISE(ABORT, 'run_queue execution requests require idempotency_key'); END;
CREATE TRIGGER trg_execution_requests_run_queue_idempotency_update
BEFORE UPDATE OF requested_source, idempotency_key ON execution_requests
WHEN new.requested_source = 'run_queue' AND new.idempotency_key IS NULL
BEGIN SELECT RAISE(ABORT, 'run_queue execution requests require idempotency_key'); END;

PRAGMA foreign_keys = ON;
