-- Durable delivery finalization receipts (coo:1297, contract ADR 0075).
-- See the SQLite migration of the same name for the semantics.
BEGIN;

CREATE TABLE IF NOT EXISTS delivery_finalizations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY IMMEDIATE,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  mission_id text NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  objective_id text NOT NULL REFERENCES objectives (id) ON DELETE CASCADE,
  delivery_id text NOT NULL REFERENCES deliveries (id) ON DELETE CASCADE,
  actor_workspace_user_id text NOT NULL REFERENCES workspace_users (id) ON DELETE CASCADE,
  session_id text REFERENCES agent_sessions (id) ON DELETE CASCADE,
  operation_kind text NOT NULL CHECK (operation_kind IN ('deliver', 'record_work')),
  operation_id text
    CHECK (operation_id IS NULL OR char_length(operation_id) BETWEEN 8 AND 128),
  request_digest text NOT NULL CHECK (char_length(request_digest) BETWEEN 8 AND 128),
  result_json jsonb NOT NULL CHECK (jsonb_typeof(result_json) = 'object'),
  accepted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (operation_kind <> 'deliver' OR session_id IS NOT NULL),
  CHECK (operation_kind <> 'record_work' OR session_id IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_finalizations_operation
  ON delivery_finalizations (workspace_id, actor_workspace_user_id, operation_kind, operation_id)
  WHERE operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_finalizations_session
  ON delivery_finalizations (session_id)
  WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_finalizations_delivery
  ON delivery_finalizations (delivery_id);
CREATE INDEX IF NOT EXISTS idx_delivery_finalizations_mission
  ON delivery_finalizations (mission_id, accepted_at);

CREATE OR REPLACE FUNCTION delivery_finalizations_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'delivery_finalizations rows are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_finalizations_immutable ON delivery_finalizations;
CREATE TRIGGER trg_delivery_finalizations_immutable
BEFORE UPDATE ON delivery_finalizations
FOR EACH ROW EXECUTE FUNCTION delivery_finalizations_immutable();

COMMIT;
