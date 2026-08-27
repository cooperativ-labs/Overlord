-- The `answer` mission event (coo:833 Phase A, contract v129).
--
-- Resolving a blocking question writes a mission event of type `answer` beside
-- the `ask` it answers, so the feed can render the exchange as a pair and
-- `has_unseen_blocking_question` can tell an answered ask from an open one.
-- `mission_events.type` is a CHECK list, and SQLite cannot widen a CHECK in
-- place, so the table is rebuilt.
--
-- The column list is the live schema as of this migration (002_initial_core;
-- nothing has altered `mission_events` since). Indexes and the search-document
-- triggers are recreated because dropping the table takes them with it; the
-- trigger bodies are copied verbatim from
-- 20260820110000_search_documents_deliveries, which owns their current form.

PRAGMA foreign_keys = OFF;

CREATE TABLE mission_events_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
  mission_id TEXT NOT NULL REFERENCES missions (id) ON DELETE RESTRICT,
  objective_id TEXT REFERENCES objectives (id) ON DELETE SET NULL,
  session_id TEXT REFERENCES agent_sessions (id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('update', 'user_follow_up', 'alert', 'discussion_summary', 'decision', 'ask', 'answer', 'permission_request', 'delivery', 'execution_requested', 'awaiting_approval', 'status_change')),
  phase TEXT,
  summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  external_url TEXT,
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  actor_workspace_user_id TEXT REFERENCES workspace_users (id) ON DELETE SET NULL,
  actor_token_id TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, mission_id) REFERENCES missions (workspace_id, id) ON DELETE RESTRICT
);

INSERT INTO mission_events_new (
  id, workspace_id, project_id, mission_id, objective_id, session_id, type, phase,
  summary, payload_json, external_url, source, actor_workspace_user_id, actor_token_id,
  idempotency_key, created_at
)
SELECT
  id, workspace_id, project_id, mission_id, objective_id, session_id, type, phase,
  summary, payload_json, external_url, source, actor_workspace_user_id, actor_token_id,
  idempotency_key, created_at
FROM mission_events;

DROP TABLE mission_events;
ALTER TABLE mission_events_new RENAME TO mission_events;

CREATE INDEX idx_mission_events_mission_created ON mission_events (mission_id, created_at);
CREATE INDEX idx_mission_events_objective_created ON mission_events (objective_id, created_at);
CREATE UNIQUE INDEX idx_mission_events_idempotency ON mission_events (workspace_id, source, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER trg_search_events_ai AFTER INSERT ON mission_events BEGIN
  INSERT INTO search_documents (
    id, workspace_id, project_id, mission_id, entity_type, entity_id,
    title, body_text, indexed_at
  ) VALUES (
    lower(hex(randomblob(16))), new.workspace_id, new.project_id, new.mission_id, 'event', new.id,
    NULL, new.summary, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
    project_id = excluded.project_id,
    mission_id = excluded.mission_id,
    body_text = excluded.body_text,
    indexed_at = excluded.indexed_at;
END;

CREATE TRIGGER trg_search_events_ad AFTER DELETE ON mission_events BEGIN
  DELETE FROM search_documents
  WHERE workspace_id = old.workspace_id AND entity_type = 'event' AND entity_id = old.id;
END;

PRAGMA foreign_keys = ON;
