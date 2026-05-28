-- RPC: get_project_graph
-- Returns file_changes for a set of ticket IDs within a project, with
-- denormalized ticket metadata. Used by the graph visualization API route.
-- When p_ticket_ids is empty, returns all file_changes for the project.
--
-- SECURITY INVOKER ensures RLS policies remain active. The API route
-- additionally checks org membership before calling this function.

CREATE OR REPLACE FUNCTION public.get_project_graph(
  p_project_id       uuid,
  p_ticket_ids       uuid[] DEFAULT '{}',
  p_include_completed boolean DEFAULT false,
  p_since            timestamptz DEFAULT NULL,
  p_until            timestamptz DEFAULT NULL,
  p_limit            integer DEFAULT 5000
)
RETURNS TABLE (
  id                uuid,
  file_name         text,
  file_path         text,
  label             text,
  summary           text,
  why               text,
  impact            text,
  change_kind       text,
  attribution_source text,
  confidence        text,
  hunks             jsonb,
  created_at        timestamptz,
  updated_at        timestamptz,
  ticket_id         uuid,
  event_id          uuid,
  session_id        uuid,
  checkpoint_id     uuid,
  objective_id      uuid,
  ticket_data       jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    fc.id,
    fc.file_name,
    fc.file_path,
    fc.label,
    fc.summary,
    fc.why,
    fc.impact,
    fc.change_kind,
    fc.attribution_source,
    fc.confidence,
    fc.hunks,
    fc.created_at,
    fc.updated_at,
    fc.ticket_id,
    fc.event_id,
    fc.session_id,
    fc.checkpoint_id,
    fc.objective_id,
    jsonb_build_object(
      'id',          t.id,
      'ticket_id',   t.ticket_id,
      'title',       t.title,
      'status',      t.status,
      'project_id',  t.project_id,
      'status_type', ts.status_type
    ) AS ticket_data
  FROM file_changes fc
  INNER JOIN tickets t ON t.id = fc.ticket_id
  LEFT JOIN ticket_statuses ts
    ON  ts.name = t.status
    AND ts.organization_id = (
          SELECT p.organization_id FROM projects p WHERE p.id = p_project_id
        )
  WHERE t.project_id = p_project_id
    AND (
      array_length(p_ticket_ids, 1) IS NULL
      OR fc.ticket_id = ANY(p_ticket_ids)
    )
    AND (
      p_include_completed
      OR (
        (ts.status_type IS NULL OR ts.status_type <> 'complete')
        AND t.status NOT ILIKE 'cancelled'
      )
    )
    AND (p_since IS NULL OR fc.created_at >= p_since)
    AND (p_until IS NULL OR fc.created_at <= p_until)
  ORDER BY fc.created_at DESC
  LIMIT p_limit;
$$;
