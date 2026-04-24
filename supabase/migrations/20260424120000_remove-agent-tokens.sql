ALTER TABLE IF EXISTS public.auth_grants
  DROP CONSTRAINT IF EXISTS auth_grants_agent_token_id_fkey;

ALTER TABLE IF EXISTS public.auth_grants
  DROP COLUMN IF EXISTS agent_token_id;

DROP POLICY IF EXISTS "Users can manage own agent tokens" ON public.agent_tokens;

DROP TABLE IF EXISTS public.agent_tokens;
