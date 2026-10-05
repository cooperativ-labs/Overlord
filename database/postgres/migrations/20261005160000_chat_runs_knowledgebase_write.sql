-- Run-scoped Knowledgebase write authorization (per:202.62e3, contract 154).
-- Postgres counterpart of
-- database/sqlite/migrations/20261005160000_chat_runs_knowledgebase_write.sql: null
-- means research only; otherwise `{"connectionId", "workspace"}` authorized by the
-- user for this run and re-checked against the live connection on every write.

ALTER TABLE chat_runs ADD COLUMN knowledgebase_write_json jsonb
  CHECK (knowledgebase_write_json IS NULL OR jsonb_typeof(knowledgebase_write_json) = 'object');
