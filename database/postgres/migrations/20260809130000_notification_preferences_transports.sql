-- Unify profile notification preferences across catalog notification types and
-- transports (coo:637 P4). Existing category modes fan out to every transport
-- the pre-existing catalog types can use, preserving rather than narrowing a
-- user's configured delivery mode.
BEGIN;

ALTER TABLE notification_preferences RENAME TO notification_preferences_legacy;

CREATE TABLE notification_preferences (
  id text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  type text NOT NULL CHECK (
    type IN (
      'all',
      'mission_awaiting_review',
      'agent_question',
      'mission_complete',
      'mission_failed',
      'agent_started',
      'returned_to_execute'
    )
  ),
  transport text NOT NULL CHECK (transport IN ('all', 'apns', 'realtime', 'in_app')),
  mode text NOT NULL CHECK (mode IN ('alert', 'silent', 'off')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (
    (type = 'all' AND transport = 'all' AND mode IN ('alert', 'off'))
    OR (type <> 'all' AND transport <> 'all')
  ),
  UNIQUE (profile_id, type, transport)
);

INSERT INTO notification_preferences (
  id, profile_id, type, transport, mode, created_at, updated_at
)
SELECT
  CASE
    WHEN legacy.category = 'all' THEN legacy.id
    ELSE legacy.id || ':' || transports.transport
  END,
  legacy.profile_id,
  legacy.category AS type,
  CASE WHEN legacy.category = 'all' THEN 'all' ELSE transports.transport END,
  legacy.mode,
  legacy.created_at,
  legacy.updated_at
FROM notification_preferences_legacy AS legacy
LEFT JOIN (VALUES ('apns'), ('realtime'), ('in_app')) AS transports(transport)
  ON legacy.category <> 'all';

DROP TABLE notification_preferences_legacy;

COMMIT;
