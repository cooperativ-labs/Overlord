BEGIN;

-- Leave the generated tsvector out of metadata-only updates. Source writes
-- serialize changes to a document key through the corresponding source row.
CREATE OR REPLACE FUNCTION search_documents_upsert(
  p_workspace_id text,
  p_project_id text,
  p_mission_id text,
  p_entity_type text,
  p_entity_id text,
  p_title text,
  p_body_text text,
  p_source_revision integer,
  p_is_update boolean
) RETURNS void AS $$
DECLARE
  metadata_changed boolean;
BEGIN
  IF p_is_update THEN
    SELECT (project_id, mission_id, source_revision)
             IS DISTINCT FROM (p_project_id, p_mission_id, p_source_revision)
      INTO metadata_changed
      FROM search_documents
     WHERE workspace_id = p_workspace_id AND entity_type = p_entity_type AND entity_id = p_entity_id
       AND title IS NOT DISTINCT FROM p_title AND body_text = p_body_text;
    IF FOUND THEN
      IF metadata_changed THEN
        UPDATE search_documents
           SET project_id = p_project_id,
               mission_id = p_mission_id,
               source_revision = p_source_revision,
               indexed_at = now()
         WHERE workspace_id = p_workspace_id AND entity_type = p_entity_type AND entity_id = p_entity_id;
      END IF;
      RETURN;
    END IF;
  END IF;

  INSERT INTO search_documents (
    id, workspace_id, project_id, mission_id, entity_type, entity_id,
    title, body_text, source_revision, indexed_at
  ) VALUES (
    gen_random_uuid()::text, p_workspace_id, p_project_id, p_mission_id, p_entity_type, p_entity_id,
    p_title, p_body_text, p_source_revision, now()
  )
  ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
    project_id = excluded.project_id,
    mission_id = excluded.mission_id,
    title = excluded.title,
    body_text = excluded.body_text,
    source_revision = excluded.source_revision,
    indexed_at = excluded.indexed_at
  WHERE (search_documents.project_id, search_documents.mission_id, search_documents.title,
         search_documents.body_text, search_documents.source_revision)
     IS DISTINCT FROM (excluded.project_id, excluded.mission_id, excluded.title,
                       excluded.body_text, excluded.source_revision);
END;
$$ LANGUAGE plpgsql;

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

  PERFORM search_documents_upsert(
    NEW.workspace_id, NEW.project_id, NEW.id, 'mission', NEW.id, NEW.title,
    btrim(concat_ws(' ', NEW.title, NEW.display_id, NEW.constraints_text, NEW.output_format_text, NEW.notes_text)),
    NEW.revision, TG_OP = 'UPDATE'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION search_documents_sync_objective() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM search_documents
    WHERE workspace_id = OLD.workspace_id AND entity_type = 'objective' AND entity_id = OLD.id;
    RETURN OLD;
  END IF;

  IF (TG_OP = 'UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id) THEN
    DELETE FROM search_documents
    WHERE workspace_id = OLD.workspace_id AND entity_type = 'objective' AND entity_id = OLD.id;
  END IF;

  IF (NEW.deleted_at IS NOT NULL) THEN
    DELETE FROM search_documents
    WHERE workspace_id = NEW.workspace_id AND entity_type = 'objective' AND entity_id = NEW.id;
    RETURN NEW;
  END IF;

  PERFORM search_documents_upsert(
    NEW.workspace_id, NEW.project_id, NEW.mission_id, 'objective', NEW.id, NEW.title,
    btrim(coalesce(NEW.title, '') || ' ' || coalesce(NEW.instruction_text, '')), NEW.revision, TG_OP = 'UPDATE'
  );
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

  PERFORM search_documents_upsert(
    NEW.workspace_id, NEW.project_id, NEW.mission_id, 'delivery', NEW.id,
    NEW.summary, delivery_body, NEW.revision, TG_OP = 'UPDATE'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION search_documents_sync_event() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    -- Keep the append path in this trigger to avoid another function call
    -- on every new mission event.
    INSERT INTO search_documents (
      id, workspace_id, project_id, mission_id, entity_type, entity_id,
      title, body_text, indexed_at
    ) VALUES (
      gen_random_uuid()::text, NEW.workspace_id, NEW.project_id, NEW.mission_id, 'event', NEW.id,
      NULL, NEW.summary, now()
    )
    ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
      project_id = excluded.project_id,
      mission_id = excluded.mission_id,
      body_text = excluded.body_text,
      indexed_at = excluded.indexed_at;
    RETURN NEW;
  END IF;

  IF (TG_OP = 'DELETE') THEN
    DELETE FROM search_documents
    WHERE workspace_id = OLD.workspace_id AND entity_type = 'event' AND entity_id = OLD.id;
    RETURN OLD;
  END IF;

  IF (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id) THEN
    DELETE FROM search_documents
    WHERE workspace_id = OLD.workspace_id AND entity_type = 'event' AND entity_id = OLD.id;
  END IF;

  PERFORM search_documents_upsert(
    NEW.workspace_id, NEW.project_id, NEW.mission_id, 'event', NEW.id, NULL, NEW.summary, NULL, true
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
