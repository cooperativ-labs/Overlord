-- Structured deferred work (coo:1202, contract v166). Same semantics as the
-- SQLite migration of the same name: the delivery search body reads the
-- deferred-work object fields, historical deferred-work arrays are cleared on
-- every delivery, and their resolutions are deleted. Every other report field
-- keeps its stored value. The clearing UPDATEs run after the search function is
-- replaced, so the delivery trigger refreshes every affected search document.

BEGIN;

CREATE OR REPLACE FUNCTION search_documents_sync_delivery() RETURNS trigger AS $$
DECLARE
  delivery_body text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM search_documents
     WHERE workspace_id = OLD.workspace_id AND entity_type = 'delivery' AND entity_id = OLD.id;
    RETURN OLD;
  END IF;

  IF (TG_OP = 'UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id) THEN
    DELETE FROM search_documents
     WHERE workspace_id = OLD.workspace_id AND entity_type = 'delivery' AND entity_id = OLD.id;
  END IF;

  IF (NEW.deleted_at IS NOT NULL) THEN
    DELETE FROM search_documents
     WHERE workspace_id = NEW.workspace_id AND entity_type = 'delivery' AND entity_id = NEW.id;
    RETURN NEW;
  END IF;

  delivery_body := left(btrim(concat_ws(
    ' ',
    NEW.summary,
    NEW.verification_summary,
    NEW.follow_up_notes,
    (SELECT string_agg(value, ' ')
       FROM jsonb_array_elements_text(
         jsonb_path_query_array(NEW.payload_json, '$.deliveryReport.agentReport.humanActions[*]')
       ) AS human_actions(value)),
    (SELECT string_agg(value, ' ')
       FROM jsonb_array_elements_text(
         jsonb_path_query_array(NEW.payload_json, '$.deliveryReport.agentReport.knownRisks[*]')
       ) AS known_risks(value)),
    (SELECT string_agg(
              concat_ws(' ', item ->> 'title', item ->> 'change', item ->> 'location', item ->> 'doneWhen'),
              ' ' ORDER BY ordinality)
       FROM jsonb_array_elements(
         jsonb_path_query_array(NEW.payload_json, '$.deliveryReport.agentReport.deferredWork[*]')
       ) WITH ORDINALITY AS deferred_work(item, ordinality)
      WHERE jsonb_typeof(item) = 'object'),
    (SELECT string_agg(value, ' ')
       FROM jsonb_array_elements_text(
         jsonb_path_query_array(NEW.payload_json, '$.deliveryReport.agentReport.assumptions[*]')
       ) AS assumptions(value)),
    (SELECT string_agg(value, ' ')
       FROM jsonb_array_elements_text(
         jsonb_path_query_array(NEW.payload_json, '$.deliveryReport.agentReport.tradeoffsMade[*].decision')
       ) AS tradeoff_decisions(value))
  )), 20000);

  INSERT INTO search_documents (
    id, workspace_id, project_id, mission_id, entity_type, entity_id,
    title, body_text, source_revision, indexed_at
  ) VALUES (
    gen_random_uuid()::text, NEW.workspace_id, NEW.project_id, NEW.mission_id, 'delivery', NEW.id,
    NEW.summary, delivery_body, NEW.revision, now()
  )
  ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
    project_id = excluded.project_id,
    mission_id = excluded.mission_id,
    title = excluded.title,
    body_text = excluded.body_text,
    source_revision = excluded.source_revision,
    indexed_at = excluded.indexed_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only deferred-work ids are written to this table since contract v150.
DELETE FROM human_action_resolutions WHERE action_id LIKE 'deferred-work-%';

UPDATE deliveries
   SET payload_json = jsonb_set(payload_json, '{deliveryReport,agentReport,deferredWork}', '[]'::jsonb)
 WHERE payload_json #> '{deliveryReport,agentReport,deferredWork}' IS NOT NULL
   AND payload_json #> '{deliveryReport,agentReport,deferredWork}' <> '[]'::jsonb;

UPDATE deliveries
   SET payload_json = jsonb_set(payload_json, '{deliveryReport,presentation,deferredWork}', '[]'::jsonb)
 WHERE payload_json #> '{deliveryReport,presentation,deferredWork}' IS NOT NULL
   AND payload_json #> '{deliveryReport,presentation,deferredWork}' <> '[]'::jsonb;

COMMIT;
