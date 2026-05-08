-- project_agent_tokens: per-project bearer tokens for agent auth via env vars.
-- One active token per user per project. Hashed with SHA-256 for storage.

CREATE TABLE IF NOT EXISTS public.project_agent_tokens (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash    TEXT        NOT NULL,
  token_prefix  TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ,
  UNIQUE (project_id, user_id)
);

ALTER TABLE public.project_agent_tokens ENABLE ROW LEVEL SECURITY;

-- Users can see and manage their own tokens for projects they are a member of.
CREATE POLICY "Users can manage their own project agent tokens"
  ON public.project_agent_tokens
  FOR ALL
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.members m
      JOIN public.projects p ON p.organization_id = m.organization_id
      WHERE m.user_id = auth.uid()
        AND p.id = project_agent_tokens.project_id
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.members m
      JOIN public.projects p ON p.organization_id = m.organization_id
      WHERE m.user_id = auth.uid()
        AND p.id = project_agent_tokens.project_id
    )
  );
