-- Feed posts table: AI-synthesized summaries of agent work, linked to projects and tickets.

CREATE TABLE IF NOT EXISTS public.feed_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.agent_sessions(id) ON DELETE SET NULL,
  agent_type text,
  title text NOT NULL,
  body text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  impact_level text NOT NULL DEFAULT 'notable',
  files_touched text[] NOT NULL DEFAULT '{}',
  tradeoffs jsonb NOT NULL DEFAULT '[]',
  source_event_ids uuid[] NOT NULL DEFAULT '{}',
  source_window_start timestamptz,
  source_window_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.feed_posts IS 'AI-synthesized feed posts summarizing agent work on tickets.';

-- Indexes for common query patterns
CREATE INDEX idx_feed_posts_org_created ON public.feed_posts (organization_id, created_at DESC);
CREATE INDEX idx_feed_posts_project_created ON public.feed_posts (project_id, created_at DESC);
CREATE INDEX idx_feed_posts_ticket ON public.feed_posts (ticket_id);
CREATE INDEX idx_feed_posts_session ON public.feed_posts (session_id);

-- Add feed_retention_days to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS feed_retention_days integer NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.organizations.feed_retention_days IS 'Number of days to retain feed posts before automatic cleanup.';

-- Enable RLS
ALTER TABLE public.feed_posts ENABLE ROW LEVEL SECURITY;

-- RLS policies: authenticated users can read feed posts for their org
CREATE POLICY "feed_posts_select"
  ON public.feed_posts
  AS permissive
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- Insert/update/delete restricted to service role (edge functions insert via service role key).
-- No authenticated insert/update/delete policies needed since generation is server-side only.
CREATE POLICY "feed_posts_service_insert"
  ON public.feed_posts
  AS permissive
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "feed_posts_service_update"
  ON public.feed_posts
  AS permissive
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "feed_posts_service_delete"
  ON public.feed_posts
  AS permissive
  FOR DELETE
  TO service_role
  USING (true);
