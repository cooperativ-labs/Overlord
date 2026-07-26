-- Private standard APNs device-token registrations and per-account notification
-- preferences (coo:444). Deliberately separate from live_activity_push_tokens:
-- an ActivityKit token dies with its activity and ships on the
-- `…push-type.liveactivity` topic, while a device token lives with the install
-- and ships on the plain bundle-id topic as an `alert` or `background` push.
BEGIN;

CREATE TABLE IF NOT EXISTS device_push_tokens (
  id text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  device_token text NOT NULL UNIQUE CHECK (char_length(btrim(device_token)) > 0),
  platform text NOT NULL CHECK (platform IN ('ios')),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  bundle_id text NOT NULL CHECK (char_length(btrim(bundle_id)) > 0),
  app_version text,
  last_registered_at timestamptz NOT NULL,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_push_tokens_profile
  ON device_push_tokens (profile_id);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  category text NOT NULL CHECK (
    category IN (
      'all',
      'mission_awaiting_review',
      'agent_question',
      'mission_complete',
      'mission_failed'
    )
  ),
  mode text NOT NULL CHECK (mode IN ('alert', 'silent', 'off')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (profile_id, category)
);

COMMIT;
