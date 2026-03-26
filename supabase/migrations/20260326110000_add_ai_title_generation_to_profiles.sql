-- Allow users to opt in/out of AI-generated ticket titles (via Gemini).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ai_title_generation boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN profiles.ai_title_generation IS
  'When true, objectives longer than 100 characters are summarised into a short title by Gemini. When false, the title is truncated from the objective text.';
