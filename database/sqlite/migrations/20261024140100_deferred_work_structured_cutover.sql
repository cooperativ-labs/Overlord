-- Structured deferred work (coo:1202, contract v166).
--
-- Deferred work changes from agent strings to agent-written objects
-- (`{ id, title, change, location, doneWhen }`) and the strict read schema no
-- longer accepts strings. Historical items are dropped rather than converted:
-- clear `agentReport.deferredWork` and `presentation.deferredWork` on every
-- delivery and delete the resolutions recorded against them. Summaries,
-- markdown, and every other report field keep their stored values.
--
-- The delivery search triggers are recreated first so that the deferred-work
-- part of the body is built from the object fields, and so that the clearing
-- UPDATEs below refresh every affected search document through them.

PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

DROP TRIGGER IF EXISTS trg_search_deliveries_ai;
DROP TRIGGER IF EXISTS trg_search_deliveries_au;

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
    indexed_at = excluded.indexed_at;
END;

-- Only deferred-work ids are written to this table since contract v150.
DELETE FROM human_action_resolutions WHERE action_id LIKE 'deferred-work-%';

UPDATE deliveries
   SET payload_json = json_set(payload_json, '$.deliveryReport.agentReport.deferredWork', json('[]'))
 WHERE json_valid(payload_json)
   AND json_type(payload_json, '$.deliveryReport.agentReport.deferredWork') IS NOT NULL
   AND NOT (json_type(payload_json, '$.deliveryReport.agentReport.deferredWork') = 'array'
            AND json_array_length(payload_json, '$.deliveryReport.agentReport.deferredWork') = 0);

UPDATE deliveries
   SET payload_json = json_set(payload_json, '$.deliveryReport.presentation.deferredWork', json('[]'))
 WHERE json_valid(payload_json)
   AND json_type(payload_json, '$.deliveryReport.presentation.deferredWork') IS NOT NULL
   AND NOT (json_type(payload_json, '$.deliveryReport.presentation.deferredWork') = 'array'
            AND json_array_length(payload_json, '$.deliveryReport.presentation.deferredWork') = 0);

COMMIT;
