-- Connection-level Knowledgebase write scope for the assistant (coo:1117.3p8q, contract 158).
-- Postgres counterpart of
-- database/sqlite/migrations/20261006120000_account_connections_assistant_write_scope.sql:
-- `per_request` (default, v154 behavior) allows writes only to the workspace a user
-- allows on a single message; `all_workspaces` allows reads and writes in every
-- workspace the connection is authorized for. Re-read on every write.

ALTER TABLE account_connections ADD COLUMN assistant_write_scope text NOT NULL DEFAULT 'per_request'
  CHECK (assistant_write_scope IN ('per_request', 'all_workspaces'));
