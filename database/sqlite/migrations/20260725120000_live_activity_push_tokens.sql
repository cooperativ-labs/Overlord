-- Private ActivityKit/APNs registration state (coo:439).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS live_activity_push_tokens (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL CHECK (length(trim(activity_id)) > 0),
  push_token TEXT NOT NULL CHECK (length(trim(push_token)) > 0),
  last_content_hash TEXT,
  last_sent_at TEXT CHECK (last_sent_at IS NULL OR last_sent_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  UNIQUE (profile_id, activity_id)
);

CREATE INDEX IF NOT EXISTS idx_live_activity_push_tokens_profile
  ON live_activity_push_tokens (profile_id);
