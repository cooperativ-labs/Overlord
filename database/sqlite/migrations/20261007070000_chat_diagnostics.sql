PRAGMA foreign_keys = ON;
BEGIN;
CREATE TABLE IF NOT EXISTS chat_diagnostics (
  thread_id text NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq >= 1),
  run_id text,
  attempt_id text,
  kind text NOT NULL,
  payload_json text NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY (thread_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_chat_diagnostics_run ON chat_diagnostics(run_id, seq);
COMMIT;
