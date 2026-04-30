-- Compact repo operations profile, derived deterministically from the project's
-- linked working directory file tree + a small set of manifest/config files.
-- Used by generate-feed-post to seed deterministic follow-up action candidates
-- (run migrations, regenerate types, deploy edge function, reinstall, etc.)
-- without polluting the prompt with the raw file tree.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS operations_profile jsonb,
  ADD COLUMN IF NOT EXISTS operations_profile_fingerprint text,
  ADD COLUMN IF NOT EXISTS operations_profile_generated_at timestamptz;
