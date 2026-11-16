-- Per-member dismissal of an agent request's notification (coo:1283, contract ADR 0063).
-- See the SQLite migration of the same name for the semantics.
BEGIN;

CREATE TABLE IF NOT EXISTS agent_request_dismissals (
  agent_request_id text NOT NULL REFERENCES agent_requests (id) ON DELETE CASCADE,
  workspace_user_id text NOT NULL REFERENCES workspace_users (id) ON DELETE CASCADE,
  dismissed_revision integer NOT NULL CHECK (dismissed_revision >= 1),
  dismissed_at timestamptz NOT NULL,
  PRIMARY KEY (agent_request_id, workspace_user_id)
);

CREATE INDEX IF NOT EXISTS agent_request_dismissals_workspace_user_idx
  ON agent_request_dismissals (workspace_user_id);

COMMIT;
