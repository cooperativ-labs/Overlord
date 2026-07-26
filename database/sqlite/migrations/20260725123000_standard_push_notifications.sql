-- Private standard APNs device-token registrations and per-account notification
-- preferences (coo:444). Deliberately separate from live_activity_push_tokens:
-- an ActivityKit token dies with its activity and ships on the
-- `…push-type.liveactivity` topic, while a device token lives with the install
-- and ships on the plain bundle-id topic as an `alert` or `background` push.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS device_push_tokens (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  device_token TEXT NOT NULL UNIQUE CHECK (length(trim(device_token)) > 0),
  platform TEXT NOT NULL CHECK (platform IN ('ios')),
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  bundle_id TEXT NOT NULL CHECK (length(trim(bundle_id)) > 0),
  app_version TEXT,
  last_registered_at TEXT NOT NULL CHECK (last_registered_at GLOB '????-??-??T??:??:??.???Z'),
  last_sent_at TEXT CHECK (last_sent_at IS NULL OR last_sent_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z')
);

CREATE INDEX IF NOT EXISTS idx_device_push_tokens_profile
  ON device_push_tokens (profile_id);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (
    category IN (
      'all',
      'mission_awaiting_review',
      'agent_question',
      'mission_complete',
      'mission_failed'
    )
  ),
  mode TEXT NOT NULL CHECK (mode IN ('alert', 'silent', 'off')),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  UNIQUE (profile_id, category)
);
