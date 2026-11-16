-- Per-member dismissal of an agent request's notification (coo:1283, contract ADR 0063).
-- Same semantics as the Postgres migration of the same name.
--
-- A row means: this workspace member dismissed the top-of-mission card for this
-- request at `dismissed_revision`. It never changes the request: status, delivery,
-- waiter lease and answerability are untouched. A dismissal applies only while the
-- request's `revision` still equals `dismissed_revision`, so a request that changes
-- is shown again. Removing the row restores the card.

PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE agent_request_dismissals (
  agent_request_id TEXT NOT NULL REFERENCES agent_requests (id) ON DELETE CASCADE,
  workspace_user_id TEXT NOT NULL REFERENCES workspace_users (id) ON DELETE CASCADE,
  dismissed_revision INTEGER NOT NULL CHECK (dismissed_revision >= 1),
  dismissed_at TEXT NOT NULL CHECK (dismissed_at GLOB '????-??-??T??:??:??.???Z'),
  PRIMARY KEY (agent_request_id, workspace_user_id)
);

CREATE INDEX agent_request_dismissals_workspace_user_idx
  ON agent_request_dismissals (workspace_user_id);

COMMIT;
