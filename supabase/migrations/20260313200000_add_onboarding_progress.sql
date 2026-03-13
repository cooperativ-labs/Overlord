-- Add onboarding progress tracking to profiles.
-- Stores completed_step (0-5) and skipped flag so the tutorial wizard
-- can auto-resume or skip on every page load.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding jsonb NOT NULL
  DEFAULT '{"completed_step": 0, "skipped": false}'::jsonb;

COMMENT ON COLUMN profiles.onboarding IS
  'Tutorial wizard progress. completed_step: 0=not started, 1=org, 2=project, 3=download-app, 4=agent-setup, 5=ticket-flow/complete. skipped: user dismissed early.';
