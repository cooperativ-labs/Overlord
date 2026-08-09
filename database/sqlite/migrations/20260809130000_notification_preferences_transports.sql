-- Unify profile notification preferences across catalog notification types and
-- transports (coo:637 P4). SQLite rebuilds the table to replace the old
-- category CHECK constraint and unique key.
PRAGMA foreign_keys = OFF;

CREATE TABLE notification_preferences_new (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (
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
  transport TEXT NOT NULL CHECK (transport IN ('all', 'apns', 'realtime', 'in_app')),
  mode TEXT NOT NULL CHECK (mode IN ('alert', 'silent', 'off')),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  CHECK (
    (type = 'all' AND transport = 'all' AND mode IN ('alert', 'off'))
    OR (type <> 'all' AND transport <> 'all')
  ),
  UNIQUE (profile_id, type, transport)
);

INSERT INTO notification_preferences_new (
  id, profile_id, type, transport, mode, created_at, updated_at
)
SELECT
  CASE
    WHEN legacy.category = 'all' THEN legacy.id
    ELSE legacy.id || ':' || transports.transport
  END,
  legacy.profile_id,
  legacy.category,
  CASE WHEN legacy.category = 'all' THEN 'all' ELSE transports.transport END,
  legacy.mode,
  legacy.created_at,
  legacy.updated_at
FROM notification_preferences AS legacy
LEFT JOIN (
  SELECT 'apns' AS transport
  UNION ALL SELECT 'realtime'
  UNION ALL SELECT 'in_app'
) AS transports ON legacy.category <> 'all';

DROP TABLE notification_preferences;
ALTER TABLE notification_preferences_new RENAME TO notification_preferences;

PRAGMA foreign_keys = ON;
