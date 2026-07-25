-- Private ActivityKit/APNs registration state (coo:439).
BEGIN;

CREATE TABLE IF NOT EXISTS live_activity_push_tokens (
  id text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  activity_id text NOT NULL CHECK (char_length(btrim(activity_id)) > 0),
  push_token text NOT NULL CHECK (char_length(btrim(push_token)) > 0),
  last_content_hash text,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (profile_id, activity_id)
);

CREATE INDEX IF NOT EXISTS idx_live_activity_push_tokens_profile
  ON live_activity_push_tokens (profile_id);

COMMIT;
