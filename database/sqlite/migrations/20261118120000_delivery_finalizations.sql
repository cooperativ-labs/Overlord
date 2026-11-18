-- Durable delivery finalization receipts (coo:1297, contract ADR 0075).
-- Same semantics as the Postgres migration of the same name.
--
-- One row per accepted protocol finalization: a session `deliver` or a
-- sessionless `record-work`. The row commits in the same transaction as its
-- delivery and is the replay receipt for that logical operation. A retried
-- request with the same actor, kind and client operation id returns the stored
-- accepted result; a different canonical request digest under the same id is
-- a conflict. `operation_id` is null for older clients that send none.
--
-- At most one finalization per session (`session_id` unique when non-null).
-- Historical deliveries keep no receipt: they are not backfilled, and their
-- sessions still count as accepted through `agent_sessions.delivery_state`.
-- Receipts are immutable after insertion and live as long as their delivery.

PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE delivery_finalizations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  objective_id TEXT NOT NULL REFERENCES objectives (id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL REFERENCES deliveries (id) ON DELETE CASCADE,
  actor_workspace_user_id TEXT NOT NULL REFERENCES workspace_users (id) ON DELETE CASCADE,
  session_id TEXT REFERENCES agent_sessions (id) ON DELETE CASCADE,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('deliver', 'record_work')),
  operation_id TEXT
    CHECK (operation_id IS NULL OR (length(operation_id) BETWEEN 8 AND 128)),
  request_digest TEXT NOT NULL CHECK (length(request_digest) BETWEEN 8 AND 128),
  result_json TEXT NOT NULL CHECK (json_valid(result_json) AND json_type(result_json) = 'object'),
  accepted_at TEXT NOT NULL CHECK (accepted_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  CHECK (operation_kind <> 'deliver' OR session_id IS NOT NULL),
  CHECK (operation_kind <> 'record_work' OR session_id IS NULL)
);

CREATE UNIQUE INDEX idx_delivery_finalizations_operation
  ON delivery_finalizations (workspace_id, actor_workspace_user_id, operation_kind, operation_id)
  WHERE operation_id IS NOT NULL;
CREATE UNIQUE INDEX idx_delivery_finalizations_session
  ON delivery_finalizations (session_id)
  WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX idx_delivery_finalizations_delivery
  ON delivery_finalizations (delivery_id);
CREATE INDEX idx_delivery_finalizations_mission
  ON delivery_finalizations (mission_id, accepted_at);

CREATE TRIGGER trg_delivery_finalizations_immutable
BEFORE UPDATE ON delivery_finalizations
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'delivery_finalizations rows are immutable');
END;

COMMIT;
