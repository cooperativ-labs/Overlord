-- RPC: get_project_hotspots
-- Returns per-file aggregates over the project's file_changes within a time
-- window. Used by the graph visualization hotspot mode.
--
-- SECURITY INVOKER ensures RLS policies remain active. The API route
-- additionally checks org membership before calling this function.

CREATE OR REPLACE FUNCTION public.get_project_hotspots(
  p_project_id        uuid,
  p_window_days       integer DEFAULT 90,
  p_include_completed boolean DEFAULT true,
  p_directory         text DEFAULT NULL,
  p_limit             integer DEFAULT 500
)
RETURNS TABLE (
  file_path           text,
  file_name           text,
  ticket_count        integer,
  rationale_count     integer,
  high_impact_count   integer,
  medium_impact_count integer,
  low_impact_count    integer,
  impact_score        numeric,
  last_activity       timestamptz,
  ticket_ids          uuid[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH project_org AS (
    SELECT organization_id FROM projects WHERE id = p_project_id
  ),
  scoped AS (
    SELECT fc.*
    FROM file_changes fc
    INNER JOIN tickets t ON t.id = fc.ticket_id
    LEFT JOIN ticket_statuses ts
      ON  ts.name = t.status
      AND ts.organization_id = (SELECT organization_id FROM project_org)
    WHERE t.project_id = p_project_id
      AND fc.created_at >= (now() - make_interval(days => GREATEST(p_window_days, 1)))
      AND (
        p_include_completed
        OR (
          (ts.status_type IS NULL OR ts.status_type <> 'complete')
          AND t.status NOT ILIKE 'cancelled'
        )
      )
      AND (
        p_directory IS NULL
        OR split_part(fc.file_path, '/', 1) = p_directory
      )
  )
  SELECT
    s.file_path,
    MAX(s.file_name)                                          AS file_name,
    COUNT(DISTINCT s.ticket_id)::integer                       AS ticket_count,
    COUNT(*)::integer                                          AS rationale_count,
    SUM(CASE WHEN s.impact = 'high'   THEN 1 ELSE 0 END)::integer AS high_impact_count,
    SUM(CASE WHEN s.impact = 'medium' THEN 1 ELSE 0 END)::integer AS medium_impact_count,
    SUM(CASE WHEN s.impact = 'low'    THEN 1 ELSE 0 END)::integer AS low_impact_count,
    (
      SUM(CASE WHEN s.impact = 'high'   THEN 3
               WHEN s.impact = 'medium' THEN 2
               WHEN s.impact = 'low'    THEN 1
               ELSE 1 END)
      * (1 + LN(GREATEST(COUNT(DISTINCT s.ticket_id), 1)))
    )::numeric AS impact_score,
    MAX(s.created_at) AS last_activity,
    ARRAY_AGG(DISTINCT s.ticket_id) AS ticket_ids
  FROM scoped s
  GROUP BY s.file_path
  ORDER BY impact_score DESC, last_activity DESC
  LIMIT p_limit;
$$;
