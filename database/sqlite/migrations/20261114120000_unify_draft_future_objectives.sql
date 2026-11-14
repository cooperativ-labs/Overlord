-- Unify `draft` and `future` objectives into one ordered draft queue
-- (coo:1274, contract ADR 0056). Same semantics as the Postgres migration of the
-- same name.
--
-- Every `future` row, live or soft-deleted, becomes `draft` with its id,
-- position, ownership, provenance, configuration, attachments and Run Queue
-- membership unchanged; only `state`, `revision` and `updated_at` move. Blank
-- rows are preserved. Historical events keep the state strings they recorded.
--
-- SQLite cannot narrow a CHECK in place, so `objectives` is rebuilt. The column
-- list, indexes and triggers were generated from `sqlite_schema` on a database
-- migrated through 20261026100000, so every later `ALTER TABLE objectives ADD
-- COLUMN` is carried. Foreign keys are off for the rebuild (this runs outside
-- any transaction the runner opens) so no child action fires, and the textual
-- child references (`objective_id … REFERENCES objectives`, the composite
-- `(workspace_id, objective_id)` keys) resolve to the renamed table. The
-- composite unique indexes those child keys depend on are recreated. No view
-- references the table. `PRAGMA foreign_key_check` must be empty afterwards.

PRAGMA foreign_keys = OFF;
BEGIN;

-- The state flip runs on the old table first so the search triggers reindex at
-- the bumped revision.
UPDATE objectives
   SET state = 'draft',
       revision = revision + 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE state = 'future';

CREATE TABLE objectives_v172 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
  mission_id TEXT NOT NULL REFERENCES missions (id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  title TEXT,
  instruction_text TEXT,
  state TEXT NOT NULL CHECK (state IN ('draft', 'submitted', 'launching', 'executing', 'pending_delivery', 'complete')),
  assigned_agent TEXT,
  model TEXT,
  reasoning_effort TEXT,
  agent_flags_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(agent_flags_json)),
  launch_config_json TEXT CHECK (launch_config_json IS NULL OR json_valid(launch_config_json)),
  -- The branch an objective actually ran on, written by the runner at
  -- branch-prepared time (coo:30).
  branch TEXT,
  auto_advance INTEGER NOT NULL DEFAULT 0 CHECK (auto_advance IN (0, 1)),
  approval_reason TEXT,
  auto_advanced_at TEXT CHECK (auto_advanced_at IS NULL OR auto_advanced_at GLOB '????-??-??T??:??:??.???Z'),
  completed_at TEXT CHECK (completed_at IS NULL OR completed_at GLOB '????-??-??T??:??:??.???Z'),
  execution_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(execution_metadata_json)),
  created_by_workspace_user_id TEXT REFERENCES workspace_users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1), resource_key TEXT, created_by_kind TEXT NOT NULL DEFAULT 'human'
  CHECK (created_by_kind IN ('human', 'agent', 'automation')), created_by_agent TEXT, created_by_session_id TEXT, display_key TEXT NOT NULL DEFAULT '', launched_at TEXT
  CHECK (launched_at IS NULL OR launched_at GLOB '????-??-??T??:??:??.???Z'), started_at TEXT
  CHECK (started_at IS NULL OR started_at GLOB '????-??-??T??:??:??.???Z'), reopened_at TEXT
  CHECK (reopened_at IS NULL OR reopened_at GLOB '????-??-??T??:??:??.???Z'),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, mission_id) REFERENCES missions (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, mission_id) REFERENCES missions (project_id, id) ON DELETE RESTRICT
);

INSERT INTO objectives_v172 (
  id,
  workspace_id,
  project_id,
  mission_id,
  position,
  title,
  instruction_text,
  state,
  assigned_agent,
  model,
  reasoning_effort,
  agent_flags_json,
  launch_config_json,
  branch,
  auto_advance,
  approval_reason,
  auto_advanced_at,
  completed_at,
  execution_metadata_json,
  created_by_workspace_user_id,
  created_at,
  updated_at,
  deleted_at,
  revision,
  resource_key,
  created_by_kind,
  created_by_agent,
  created_by_session_id,
  display_key,
  launched_at,
  started_at,
  reopened_at
)
SELECT
  id,
  workspace_id,
  project_id,
  mission_id,
  position,
  title,
  instruction_text,
  state,
  assigned_agent,
  model,
  reasoning_effort,
  agent_flags_json,
  launch_config_json,
  branch,
  auto_advance,
  approval_reason,
  auto_advanced_at,
  completed_at,
  execution_metadata_json,
  created_by_workspace_user_id,
  created_at,
  updated_at,
  deleted_at,
  revision,
  resource_key,
  created_by_kind,
  created_by_agent,
  created_by_session_id,
  display_key,
  launched_at,
  started_at,
  reopened_at
FROM objectives;

DROP TABLE objectives;
ALTER TABLE objectives_v172 RENAME TO objectives;

CREATE UNIQUE INDEX idx_objectives_active_mission_position ON objectives (mission_id, position)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_objectives_mission_display_key
      ON objectives (mission_id, display_key)
      WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_objectives_mission_id ON objectives (mission_id, id);
CREATE INDEX idx_objectives_mission_state_position ON objectives (mission_id, state, position);
CREATE UNIQUE INDEX idx_objectives_project_id ON objectives (project_id, id);
CREATE INDEX idx_objectives_project_state_updated ON objectives (project_id, state, updated_at);
CREATE INDEX idx_objectives_transcript_created ON objectives (workspace_id, created_at, id)
WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_objectives_workspace_id ON objectives (workspace_id, id);

CREATE TRIGGER trg_search_objectives_ai AFTER INSERT ON objectives
WHEN new.deleted_at IS NULL
BEGIN
  INSERT INTO search_documents (
    id, workspace_id, project_id, mission_id, entity_type, entity_id,
    title, body_text, source_revision, indexed_at
  ) VALUES (
    lower(hex(randomblob(16))), new.workspace_id, new.project_id, new.mission_id, 'objective', new.id,
    new.title, trim(coalesce(new.title, '') || ' ' || coalesce(new.instruction_text, '')), new.revision,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
    project_id = excluded.project_id,
    mission_id = excluded.mission_id,
    title = excluded.title,
    body_text = excluded.body_text,
    source_revision = excluded.source_revision,
    indexed_at = excluded.indexed_at;
END;

CREATE TRIGGER trg_search_objectives_au AFTER UPDATE ON objectives
WHEN new.deleted_at IS NULL
BEGIN
  INSERT INTO search_documents (
    id, workspace_id, project_id, mission_id, entity_type, entity_id,
    title, body_text, source_revision, indexed_at
  ) VALUES (
    lower(hex(randomblob(16))), new.workspace_id, new.project_id, new.mission_id, 'objective', new.id,
    new.title, trim(coalesce(new.title, '') || ' ' || coalesce(new.instruction_text, '')), new.revision,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
    project_id = excluded.project_id,
    mission_id = excluded.mission_id,
    title = excluded.title,
    body_text = excluded.body_text,
    source_revision = excluded.source_revision,
    indexed_at = excluded.indexed_at;
END;

CREATE TRIGGER trg_search_objectives_soft_delete AFTER UPDATE ON objectives
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL
BEGIN
  DELETE FROM search_documents
  WHERE workspace_id = new.workspace_id AND entity_type = 'objective' AND entity_id = new.id;
END;

CREATE TRIGGER trg_search_objectives_ad AFTER DELETE ON objectives BEGIN
  DELETE FROM search_documents
  WHERE workspace_id = old.workspace_id AND entity_type = 'objective' AND entity_id = old.id;
END;

COMMIT;
PRAGMA foreign_keys = ON;
