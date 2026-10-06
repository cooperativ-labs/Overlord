-- Connection-level Knowledgebase write scope for the assistant (coo:1117.3p8q, contract 158).
--
-- `per_request` (the default, v154 behavior) lets the assistant write only to the one
-- workspace a user allows on a single message. `all_workspaces` lets it read and write
-- every workspace the connection is authorized for, without a per-message grant. The
-- backend re-reads this column on every write, so turning it off takes effect at once.

ALTER TABLE account_connections ADD COLUMN assistant_write_scope TEXT NOT NULL DEFAULT 'per_request'
  CHECK (assistant_write_scope IN ('per_request', 'all_workspaces'));
