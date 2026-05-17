-- user_agent_tokens: per-user bearer tokens for agent auth via env vars.
-- Multiple labeled tokens per user. Hashed with SHA-256 for storage.
-- Replaces project_agent_tokens (which was user + project scoped).

DROP TABLE IF EXISTS public.project_agent_tokens;

CREATE TABLE IF NOT EXISTS public.user_agent_tokens (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label         TEXT        NOT NULL,
  token_hash    TEXT        NOT NULL UNIQUE,
  token_prefix  TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_agent_tokens_user_id_idx
  ON public.user_agent_tokens (user_id);

ALTER TABLE public.user_agent_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own agent tokens"
  ON public.user_agent_tokens
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
