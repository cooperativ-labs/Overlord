-- Unified mission-search index (contract v98).
-- SQLite cannot widen an inline CHECK constraint, so preserve the portable
-- rows while rebuilding only search_documents and its external-content index.

PRAGMA foreign_keys = ON;

BEGIN;

DROP TRIGGER trg_search_documents_fts_ai;
DROP TRIGGER trg_search_documents_fts_ad;
DROP TRIGGER trg_search_documents_fts_au;
DROP TRIGGER trg_search_missions_ai;
DROP TRIGGER trg_search_missions_au;
DROP TRIGGER trg_search_missions_soft_delete;
DROP TRIGGER trg_search_missions_ad;
DROP TRIGGER trg_search_objectives_ai;
DROP TRIGGER trg_search_objectives_au;
DROP TRIGGER trg_search_objectives_soft_delete;
DROP TRIGGER trg_search_objectives_ad;
DROP TRIGGER trg_search_events_ai;
DROP TRIGGER trg_search_events_ad;
DROP TRIGGER IF EXISTS trg_search_deliveries_ai;
DROP TRIGGER IF EXISTS trg_search_deliveries_au;
DROP TRIGGER IF EXISTS trg_search_deliveries_soft_delete;
DROP TRIGGER IF EXISTS trg_search_deliveries_ad;
DROP TABLE search_documents_fts;

CREATE TABLE search_documents_v98 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  mission_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('mission', 'objective', 'event', 'delivery')),
  entity_id TEXT NOT NULL,
  title TEXT,
  body_text TEXT NOT NULL,
  content_hash TEXT,
  source_revision INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  indexed_at TEXT NOT NULL CHECK (indexed_at GLOB '????-??-??T??:??:??.???Z')
);

INSERT INTO search_documents_v98 (
  id, workspace_id, project_id, mission_id, entity_type, entity_id,
  title, body_text, content_hash, source_revision, metadata_json, indexed_at
)
SELECT
  id, workspace_id, project_id, mission_id, entity_type, entity_id,
  title, body_text, content_hash, source_revision, metadata_json, indexed_at
FROM search_documents;

DROP TABLE search_documents;
ALTER TABLE search_documents_v98 RENAME TO search_documents;

CREATE UNIQUE INDEX idx_search_documents_entity ON search_documents (workspace_id, entity_type, entity_id);
CREATE INDEX idx_search_documents_workspace_project_type ON search_documents (workspace_id, project_id, entity_type);
CREATE INDEX idx_search_documents_mission ON search_documents (mission_id);

CREATE VIRTUAL TABLE search_documents_fts USING fts5(
  title,
  body_text,
  mission_id UNINDEXED,
  entity_type UNINDEXED,
  content = 'search_documents',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER trg_search_documents_fts_ai AFTER INSERT ON search_documents BEGIN
  INSERT INTO search_documents_fts (rowid, title, body_text, mission_id, entity_type)
  VALUES (new.rowid, new.title, new.body_text, new.mission_id, new.entity_type);
END;

CREATE TRIGGER trg_search_documents_fts_ad AFTER DELETE ON search_documents BEGIN
  INSERT INTO search_documents_fts (search_documents_fts, rowid, title, body_text, mission_id, entity_type)
  VALUES ('delete', old.rowid, old.title, old.body_text, old.mission_id, old.entity_type);
END;

CREATE TRIGGER trg_search_documents_fts_au AFTER UPDATE ON search_documents BEGIN
  INSERT INTO search_documents_fts (search_documents_fts, rowid, title, body_text, mission_id, entity_type)
  VALUES ('delete', old.rowid, old.title, old.body_text, old.mission_id, old.entity_type);
  INSERT INTO search_documents_fts (rowid, title, body_text, mission_id, entity_type)
  VALUES (new.rowid, new.title, new.body_text, new.mission_id, new.entity_type);
END;

CREATE TRIGGER trg_search_missions_ai AFTER INSERT ON missions
WHEN new.deleted_at IS NULL
BEGIN
  INSERT INTO search_documents (
    id, workspace_id, project_id, mission_id, entity_type, entity_id,
    title, body_text, source_revision, indexed_at
  ) VALUES (
    lower(hex(randomblob(16))), new.workspace_id, new.project_id, new.id, 'mission', new.id,
    new.title,
    trim(coalesce(new.title, '') || ' ' || coalesce(new.display_id, '') || ' ' ||
         coalesce(new.constraints_text, '') || ' ' || coalesce(new.output_format_text, '') || ' ' ||
         coalesce(new.notes_text, '')),
    new.revision, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
    project_id = excluded.project_id,
    mission_id = excluded.mission_id,
    title = excluded.title,
    body_text = excluded.body_text,
    source_revision = excluded.source_revision,
    indexed_at = excluded.indexed_at;
END;

CREATE TRIGGER trg_search_missions_au AFTER UPDATE ON missions
WHEN new.deleted_at IS NULL
BEGIN
  INSERT INTO search_documents (
    id, workspace_id, project_id, mission_id, entity_type, entity_id,
    title, body_text, source_revision, indexed_at
  ) VALUES (
    lower(hex(randomblob(16))), new.workspace_id, new.project_id, new.id, 'mission', new.id,
    new.title,
    trim(coalesce(new.title, '') || ' ' || coalesce(new.display_id, '') || ' ' ||
         coalesce(new.constraints_text, '') || ' ' || coalesce(new.output_format_text, '') || ' ' ||
         coalesce(new.notes_text, '')),
    new.revision, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
    project_id = excluded.project_id,
    mission_id = excluded.mission_id,
    title = excluded.title,
    body_text = excluded.body_text,
    source_revision = excluded.source_revision,
    indexed_at = excluded.indexed_at;
END;

CREATE TRIGGER trg_search_missions_soft_delete AFTER UPDATE ON missions
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL
BEGIN
  DELETE FROM search_documents WHERE workspace_id = new.workspace_id AND mission_id = new.id;
END;

CREATE TRIGGER trg_search_missions_ad AFTER DELETE ON missions BEGIN
  DELETE FROM search_documents WHERE workspace_id = old.workspace_id AND mission_id = old.id;
END;

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

CREATE TRIGGER trg_search_deliveries_ai AFTER INSERT ON deliveries
WHEN new.deleted_at IS NULL
BEGIN
  INSERT INTO search_documents (
    id, workspace_id, project_id, mission_id, entity_type, entity_id,
    title, body_text, source_revision, indexed_at
  ) VALUES (
    lower(hex(randomblob(16))), new.workspace_id, new.project_id, new.mission_id, 'delivery', new.id,
    new.summary,
    substr(trim(
      coalesce(new.summary, '') || ' ' || coalesce(new.verification_summary, '') || ' ' ||
      coalesce(new.follow_up_notes, '') || ' ' ||
      coalesce((SELECT group_concat(value, ' ') FROM json_each(new.payload_json, '$.deliveryReport.agentReport.humanActions')), '') || ' ' ||
      coalesce((SELECT group_concat(value, ' ') FROM json_each(new.payload_json, '$.deliveryReport.agentReport.knownRisks')), '') || ' ' ||
      coalesce((SELECT group_concat(value, ' ') FROM json_each(new.payload_json, '$.deliveryReport.agentReport.deferredWork')), '') || ' ' ||
      coalesce((SELECT group_concat(value, ' ') FROM json_each(new.payload_json, '$.deliveryReport.agentReport.assumptions')), '') || ' ' ||
      coalesce((SELECT group_concat(json_extract(value, '$.decision'), ' ') FROM json_each(new.payload_json, '$.deliveryReport.agentReport.tradeoffsMade')), '')
    ), 1, 20000),
    new.revision, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
    project_id = excluded.project_id,
    mission_id = excluded.mission_id,
    title = excluded.title,
    body_text = excluded.body_text,
    source_revision = excluded.source_revision,
    indexed_at = excluded.indexed_at;
END;

CREATE TRIGGER trg_search_deliveries_au AFTER UPDATE ON deliveries
WHEN new.deleted_at IS NULL
BEGIN
  DELETE FROM search_documents
  WHERE workspace_id = old.workspace_id AND entity_type = 'delivery' AND entity_id = old.id
    AND old.workspace_id <> new.workspace_id;

  INSERT INTO search_documents (
    id, workspace_id, project_id, mission_id, entity_type, entity_id,
    title, body_text, source_revision, indexed_at
  ) VALUES (
    lower(hex(randomblob(16))), new.workspace_id, new.project_id, new.mission_id, 'delivery', new.id,
    new.summary,
    substr(trim(
      coalesce(new.summary, '') || ' ' || coalesce(new.verification_summary, '') || ' ' ||
      coalesce(new.follow_up_notes, '') || ' ' ||
      coalesce((SELECT group_concat(value, ' ') FROM json_each(new.payload_json, '$.deliveryReport.agentReport.humanActions')), '') || ' ' ||
      coalesce((SELECT group_concat(value, ' ') FROM json_each(new.payload_json, '$.deliveryReport.agentReport.knownRisks')), '') || ' ' ||
      coalesce((SELECT group_concat(value, ' ') FROM json_each(new.payload_json, '$.deliveryReport.agentReport.deferredWork')), '') || ' ' ||
      coalesce((SELECT group_concat(value, ' ') FROM json_each(new.payload_json, '$.deliveryReport.agentReport.assumptions')), '') || ' ' ||
      coalesce((SELECT group_concat(json_extract(value, '$.decision'), ' ') FROM json_each(new.payload_json, '$.deliveryReport.agentReport.tradeoffsMade')), '')
    ), 1, 20000),
    new.revision, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
    project_id = excluded.project_id,
    mission_id = excluded.mission_id,
    title = excluded.title,
    body_text = excluded.body_text,
    source_revision = excluded.source_revision,
    indexed_at = excluded.indexed_at;
END;

CREATE TRIGGER trg_search_deliveries_soft_delete AFTER UPDATE ON deliveries
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL
BEGIN
  DELETE FROM search_documents
  WHERE workspace_id = new.workspace_id AND entity_type = 'delivery' AND entity_id = new.id;
END;

CREATE TRIGGER trg_search_deliveries_ad AFTER DELETE ON deliveries BEGIN
  DELETE FROM search_documents
  WHERE workspace_id = old.workspace_id AND entity_type = 'delivery' AND entity_id = old.id;
END;

-- Idempotent backfill: refresh every live mission body and add one document per
-- live delivery. Existing keys update in place, so a rerun never duplicates.
INSERT INTO search_documents (
  id, workspace_id, project_id, mission_id, entity_type, entity_id,
  title, body_text, source_revision, indexed_at
)
SELECT
  lower(hex(randomblob(16))), m.workspace_id, m.project_id, m.id, 'mission', m.id,
  m.title,
  trim(coalesce(m.title, '') || ' ' || coalesce(m.display_id, '') || ' ' ||
       coalesce(m.constraints_text, '') || ' ' || coalesce(m.output_format_text, '') || ' ' ||
       coalesce(m.notes_text, '')),
  m.revision, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM missions m
WHERE m.deleted_at IS NULL
ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
  project_id = excluded.project_id,
  mission_id = excluded.mission_id,
  title = excluded.title,
  body_text = excluded.body_text,
  source_revision = excluded.source_revision,
  indexed_at = excluded.indexed_at;

INSERT INTO search_documents (
  id, workspace_id, project_id, mission_id, entity_type, entity_id,
  title, body_text, source_revision, indexed_at
)
SELECT
  lower(hex(randomblob(16))), d.workspace_id, d.project_id, d.mission_id, 'delivery', d.id,
  d.summary,
  substr(trim(
    coalesce(d.summary, '') || ' ' || coalesce(d.verification_summary, '') || ' ' ||
    coalesce(d.follow_up_notes, '') || ' ' ||
    coalesce((SELECT group_concat(value, ' ') FROM json_each(d.payload_json, '$.deliveryReport.agentReport.humanActions')), '') || ' ' ||
    coalesce((SELECT group_concat(value, ' ') FROM json_each(d.payload_json, '$.deliveryReport.agentReport.knownRisks')), '') || ' ' ||
    coalesce((SELECT group_concat(value, ' ') FROM json_each(d.payload_json, '$.deliveryReport.agentReport.deferredWork')), '') || ' ' ||
    coalesce((SELECT group_concat(value, ' ') FROM json_each(d.payload_json, '$.deliveryReport.agentReport.assumptions')), '') || ' ' ||
    coalesce((SELECT group_concat(json_extract(value, '$.decision'), ' ') FROM json_each(d.payload_json, '$.deliveryReport.agentReport.tradeoffsMade')), '')
  ), 1, 20000),
  d.revision, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM deliveries d
WHERE d.deleted_at IS NULL
ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
  project_id = excluded.project_id,
  mission_id = excluded.mission_id,
  title = excluded.title,
  body_text = excluded.body_text,
  source_revision = excluded.source_revision,
  indexed_at = excluded.indexed_at;

INSERT INTO search_documents_fts(search_documents_fts) VALUES ('rebuild');

COMMIT;
