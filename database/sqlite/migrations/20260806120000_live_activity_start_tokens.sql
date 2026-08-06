-- Private ActivityKit push-to-start registrations (coo:633).
--
-- A third credential family, deliberately stored apart from the two that
-- already exist. `live_activity_push_tokens` holds a token that dies with one
-- activity; `device_push_tokens` holds a token that lives with the install and
-- ships alert/background pushes; a push-to-start token is scoped to the
-- (install, activity type) pair, outlives every individual activity, and is the
-- only credential that may carry an `event: "start"` payload. None of the three
-- are interchangeable.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS live_activity_start_tokens (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  start_token TEXT NOT NULL UNIQUE CHECK (length(trim(start_token)) > 0),
  platform TEXT NOT NULL CHECK (platform IN ('ios')),
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  bundle_id TEXT NOT NULL CHECK (length(trim(bundle_id)) > 0),
  activity_type TEXT NOT NULL CHECK (length(trim(activity_type)) > 0),
  app_version TEXT,
  last_registered_at TEXT NOT NULL CHECK (last_registered_at GLOB '????-??-??T??:??:??.???Z'),
  last_started_at TEXT CHECK (last_started_at IS NULL OR last_started_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z')
);

CREATE INDEX IF NOT EXISTS idx_live_activity_start_tokens_profile
  ON live_activity_start_tokens (profile_id);

-- Records which registrations arrived as the handoff after APNs remotely started
-- an activity, so a start is never sent twice for the same live activity.
ALTER TABLE live_activity_push_tokens
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'local'
    CHECK (origin IN ('local', 'push_to_start'));
