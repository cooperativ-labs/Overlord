-- RPC: get_project_file_changes
-- Replaces chunked PostgREST .in('file_path', ...) queries in the API route.
-- Accepts an array of file-path variants and performs the lookup entirely
-- server-side via = ANY(), which is not subject to URL-length limits.
--
-- The caller (API route) still enforces org membership before invoking this
-- function. SECURITY INVOKER ensures the function runs under the authenticated
-- user's context so RLS policies remain active.

CREATE OR REPLACE FUNCTION public.get_project_file_changes(
  p_project_id       uuid,
  p_file_paths       text[],
  p_include_completed boolean DEFAULT false
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
      -- empty array means "all paths" (no file-path filter requested)
      array_length(p_file_paths, 1) IS NULL
      OR fc.file_path = ANY(p_file_paths)
    )
    AND (
      p_include_completed
      OR (
        (ts.status_type IS NULL OR ts.status_type <> 'complete')
        AND t.status NOT ILIKE 'cancelled'
      )
    )
  ORDER BY fc.created_at DESC;
$$;
