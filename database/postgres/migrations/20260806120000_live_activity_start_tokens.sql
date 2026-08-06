-- Private ActivityKit push-to-start registrations (coo:633).
--
-- A third credential family, deliberately stored apart from the two that
-- already exist. `live_activity_push_tokens` holds a token that dies with one
-- activity; `device_push_tokens` holds a token that lives with the install and
-- ships alert/background pushes; a push-to-start token is scoped to the
-- (install, activity type) pair, outlives every individual activity, and is the
-- only credential that may carry an `event: "start"` payload. None of the three
-- are interchangeable.
BEGIN;

CREATE TABLE IF NOT EXISTS live_activity_start_tokens (
  id text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  start_token text NOT NULL UNIQUE CHECK (char_length(btrim(start_token)) > 0),
  platform text NOT NULL CHECK (platform IN ('ios')),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  bundle_id text NOT NULL CHECK (char_length(btrim(bundle_id)) > 0),
  activity_type text NOT NULL CHECK (char_length(btrim(activity_type)) > 0),
  app_version text,
  last_registered_at timestamptz NOT NULL,
  last_started_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_live_activity_start_tokens_profile
  ON live_activity_start_tokens (profile_id);

-- Records which registrations arrived as the handoff after APNs remotely started
-- an activity, so a start is never sent twice for the same live activity.
ALTER TABLE live_activity_push_tokens
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'local'
    CHECK (origin IN ('local', 'push_to_start'));

COMMIT;
