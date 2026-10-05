-- Run-scoped Knowledgebase write authorization (per:202.62e3, contract 154).
--
-- A run may write to one Knowledgebase workspace through one connection only when
-- the user explicitly authorized it on the message that started (or answered) the
-- run. Null means research only. The value is `{"connectionId", "workspace"}`; the
-- backend re-checks it against the live connection on every write.

ALTER TABLE chat_runs ADD COLUMN knowledgebase_write_json TEXT
  CHECK (knowledgebase_write_json IS NULL OR json_valid(knowledgebase_write_json));
