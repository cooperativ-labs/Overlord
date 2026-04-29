-- Add a general-purpose preferences JSONB field to profiles.
-- Used to persist UI preferences (e.g. ticket view mode) in the database,
-- which is necessary for Electron where cookie-based storage is unreliable.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}';
