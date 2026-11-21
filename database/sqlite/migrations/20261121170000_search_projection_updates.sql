PRAGMA foreign_keys = ON;

BEGIN;

-- FTS5 indexes title and body only. Scope and revision changes still update
-- the content table, which supplies the current values of unindexed columns.
DROP TRIGGER IF EXISTS trg_search_documents_fts_au;

CREATE TRIGGER trg_search_documents_fts_au AFTER UPDATE ON search_documents
WHEN old.title IS NOT new.title OR old.body_text IS NOT new.body_text OR old.rowid IS NOT new.rowid
BEGIN
  INSERT INTO search_documents_fts (search_documents_fts, rowid, title, body_text, mission_id, entity_type)
  VALUES ('delete', old.rowid, old.title, old.body_text, old.mission_id, old.entity_type);
  INSERT INTO search_documents_fts (rowid, title, body_text, mission_id, entity_type)
  VALUES (new.rowid, new.title, new.body_text, new.mission_id, new.entity_type);
END;

DROP TRIGGER IF EXISTS trg_search_missions_au;

CREATE TRIGGER trg_search_missions_au AFTER UPDATE ON missions
WHEN new.deleted_at IS NULL
BEGIN
  DELETE FROM search_documents
  WHERE workspace_id = old.workspace_id AND mission_id = old.id
    AND old.workspace_id IS NOT new.workspace_id;

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
    indexed_at = excluded.indexed_at
  WHERE search_documents.project_id IS NOT excluded.project_id
     OR search_documents.mission_id IS NOT excluded.mission_id
     OR search_documents.title IS NOT excluded.title
     OR search_documents.body_text IS NOT excluded.body_text
     OR search_documents.source_revision IS NOT excluded.source_revision;
END;

DROP TRIGGER IF EXISTS trg_search_missions_soft_delete;

CREATE TRIGGER trg_search_missions_soft_delete AFTER UPDATE ON missions
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL
BEGIN
  DELETE FROM search_documents WHERE workspace_id IN (old.workspace_id, new.workspace_id) AND mission_id = new.id;
END;

DROP TRIGGER IF EXISTS trg_search_objectives_au;

CREATE TRIGGER trg_search_objectives_au AFTER UPDATE ON objectives
WHEN new.deleted_at IS NULL
BEGIN
  DELETE FROM search_documents
  WHERE workspace_id = old.workspace_id AND entity_type = 'objective' AND entity_id = old.id
    AND old.workspace_id IS NOT new.workspace_id;

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
    indexed_at = excluded.indexed_at
  WHERE search_documents.project_id IS NOT excluded.project_id
     OR search_documents.mission_id IS NOT excluded.mission_id
     OR search_documents.title IS NOT excluded.title
     OR search_documents.body_text IS NOT excluded.body_text
     OR search_documents.source_revision IS NOT excluded.source_revision;
END;

DROP TRIGGER IF EXISTS trg_search_objectives_soft_delete;

CREATE TRIGGER trg_search_objectives_soft_delete AFTER UPDATE ON objectives
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL
BEGIN
  DELETE FROM search_documents
  WHERE workspace_id IN (old.workspace_id, new.workspace_id) AND entity_type = 'objective' AND entity_id = new.id;
END;

DROP TRIGGER IF EXISTS trg_search_deliveries_au;

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
      coalesce((SELECT group_concat(
                  trim(coalesce(json_extract(value, '$.title'), '') || ' ' ||
                       coalesce(json_extract(value, '$.change'), '') || ' ' ||
                       coalesce(json_extract(value, '$.location'), '') || ' ' ||
                       coalesce(json_extract(value, '$.doneWhen'), '')), ' ')
                  FROM json_each(new.payload_json, '$.deliveryReport.agentReport.deferredWork')
                 WHERE type = 'object'), '') || ' ' ||
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
    indexed_at = excluded.indexed_at
  WHERE search_documents.project_id IS NOT excluded.project_id
     OR search_documents.mission_id IS NOT excluded.mission_id
     OR search_documents.title IS NOT excluded.title
     OR search_documents.body_text IS NOT excluded.body_text
     OR search_documents.source_revision IS NOT excluded.source_revision;
END;

DROP TRIGGER IF EXISTS trg_search_deliveries_soft_delete;

CREATE TRIGGER trg_search_deliveries_soft_delete AFTER UPDATE ON deliveries
WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL
BEGIN
  DELETE FROM search_documents
  WHERE workspace_id IN (old.workspace_id, new.workspace_id) AND entity_type = 'delivery' AND entity_id = new.id;
END;

DROP TRIGGER IF EXISTS trg_search_events_au;

CREATE TRIGGER trg_search_events_au AFTER UPDATE ON mission_events
WHEN old.workspace_id IS NOT new.workspace_id OR old.project_id IS NOT new.project_id
  OR old.mission_id IS NOT new.mission_id OR old.summary IS NOT new.summary
BEGIN
  DELETE FROM search_documents
  WHERE workspace_id = old.workspace_id AND entity_type = 'event' AND entity_id = old.id
    AND old.workspace_id IS NOT new.workspace_id;

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
    indexed_at = excluded.indexed_at
  WHERE search_documents.project_id IS NOT excluded.project_id
     OR search_documents.mission_id IS NOT excluded.mission_id
     OR search_documents.body_text IS NOT excluded.body_text;
END;

-- Reconcile event project IDs left behind by earlier SQLite project moves.
UPDATE search_documents AS doc
   SET project_id = event.project_id,
       indexed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM mission_events AS event
 WHERE doc.entity_type = 'event' AND doc.entity_id = event.id
   AND doc.workspace_id = event.workspace_id AND doc.mission_id = event.mission_id
   AND doc.project_id IS NOT event.project_id;

COMMIT;
