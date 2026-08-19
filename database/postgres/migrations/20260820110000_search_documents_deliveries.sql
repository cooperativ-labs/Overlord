-- Unified mission-search index (contract v98).
-- Delivery documents are indexed for v3 only; v1/v2 continue to restrict their
-- corpus to mission/objective/event documents in the service layer.

BEGIN;

ALTER TABLE search_documents DROP CONSTRAINT search_documents_entity_type_check;
ALTER TABLE search_documents
  ADD CONSTRAINT search_documents_entity_type_check
  CHECK (entity_type IN ('mission', 'objective', 'event', 'delivery'));

CREATE OR REPLACE FUNCTION search_documents_sync_mission() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM search_documents WHERE workspace_id = OLD.workspace_id AND mission_id = OLD.id;
    RETURN OLD;
  END IF;

  IF (TG_OP = 'UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id) THEN
    DELETE FROM search_documents WHERE workspace_id = OLD.workspace_id AND mission_id = OLD.id;
  END IF;

  IF (NEW.deleted_at IS NOT NULL) THEN
    DELETE FROM search_documents WHERE workspace_id = NEW.workspace_id AND mission_id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO search_documents (
    id, workspace_id, project_id, mission_id, entity_type, entity_id,
    title, body_text, source_revision, indexed_at
  ) VALUES (
    gen_random_uuid()::text, NEW.workspace_id, NEW.project_id, NEW.id, 'mission', NEW.id,
    NEW.title,
    btrim(concat_ws(' ', NEW.title, NEW.display_id, NEW.constraints_text, NEW.output_format_text, NEW.notes_text)),
    NEW.revision, now()
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
    (SELECT string_agg(value, ' ')
       FROM jsonb_array_elements_text(
         jsonb_path_query_array(NEW.payload_json, '$.deliveryReport.agentReport.deferredWork[*]')
       ) AS deferred_work(value)),
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

CREATE TRIGGER trg_search_deliveries
AFTER INSERT OR UPDATE OR DELETE ON deliveries
FOR EACH ROW EXECUTE FUNCTION search_documents_sync_delivery();

-- Rewrite mission documents and add all pre-existing live deliveries. Both
-- upserts are safe to rerun when a migration is retried.
INSERT INTO search_documents (
  id, workspace_id, project_id, mission_id, entity_type, entity_id,
  title, body_text, source_revision, indexed_at
)
SELECT
  gen_random_uuid()::text, m.workspace_id, m.project_id, m.id, 'mission', m.id,
  m.title,
  btrim(concat_ws(' ', m.title, m.display_id, m.constraints_text, m.output_format_text, m.notes_text)),
  m.revision, now()
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
  gen_random_uuid()::text, d.workspace_id, d.project_id, d.mission_id, 'delivery', d.id,
  d.summary,
  left(btrim(concat_ws(
    ' ',
    d.summary,
    d.verification_summary,
    d.follow_up_notes,
    (SELECT string_agg(value, ' ')
       FROM jsonb_array_elements_text(
         jsonb_path_query_array(d.payload_json, '$.deliveryReport.agentReport.humanActions[*]')
       ) AS human_actions(value)),
    (SELECT string_agg(value, ' ')
       FROM jsonb_array_elements_text(
         jsonb_path_query_array(d.payload_json, '$.deliveryReport.agentReport.knownRisks[*]')
       ) AS known_risks(value)),
    (SELECT string_agg(value, ' ')
       FROM jsonb_array_elements_text(
         jsonb_path_query_array(d.payload_json, '$.deliveryReport.agentReport.deferredWork[*]')
       ) AS deferred_work(value)),
    (SELECT string_agg(value, ' ')
       FROM jsonb_array_elements_text(
         jsonb_path_query_array(d.payload_json, '$.deliveryReport.agentReport.assumptions[*]')
       ) AS assumptions(value)),
    (SELECT string_agg(value, ' ')
       FROM jsonb_array_elements_text(
         jsonb_path_query_array(d.payload_json, '$.deliveryReport.agentReport.tradeoffsMade[*].decision')
       ) AS tradeoff_decisions(value))
  )), 20000),
  d.revision, now()
FROM deliveries d
WHERE d.deleted_at IS NULL
ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
  project_id = excluded.project_id,
  mission_id = excluded.mission_id,
  title = excluded.title,
  body_text = excluded.body_text,
  source_revision = excluded.source_revision,
  indexed_at = excluded.indexed_at;

COMMIT;
