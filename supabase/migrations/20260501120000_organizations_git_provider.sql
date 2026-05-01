-- Add git_provider column to organizations for per-org GitHub/Bitbucket selection
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS git_provider text
    CHECK (git_provider IN ('github', 'bitbucket'))
    DEFAULT NULL;
