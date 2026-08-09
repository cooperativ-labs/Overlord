-- Per-registration APNs host/topic for Live Activity update tokens (coo:656).
--
-- Without environment/bundle_id the update dispatcher fell back to the process
-- OVERLORD_APNS_ENV host. A sandbox debug token sent to production APNs returns
-- 400 BadDeviceToken, which is treated as permanent retirement and deletes the
-- row with no retry — so remote updates silently disappear while local sync
-- still works. Mirror the start-token / device-token CHECK constraints.
--
-- SQLite cannot ADD a NOT NULL column without a DEFAULT, so rebuild the table.
-- Prior rows lack routing metadata and are intentionally not copied; the client
-- re-registers on the next home-screen sync.
PRAGMA foreign_keys = OFF;

CREATE TABLE live_activity_push_tokens_new (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL CHECK (length(trim(activity_id)) > 0),
  push_token TEXT NOT NULL CHECK (length(trim(push_token)) > 0),
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  bundle_id TEXT NOT NULL CHECK (length(trim(bundle_id)) > 0),
  origin TEXT NOT NULL DEFAULT 'local' CHECK (origin IN ('local', 'push_to_start')),
  last_content_hash TEXT,
  last_sent_at TEXT CHECK (last_sent_at IS NULL OR last_sent_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  UNIQUE (profile_id, activity_id)
);

DROP TABLE live_activity_push_tokens;
ALTER TABLE live_activity_push_tokens_new RENAME TO live_activity_push_tokens;

CREATE INDEX IF NOT EXISTS idx_live_activity_push_tokens_profile
  ON live_activity_push_tokens (profile_id);

PRAGMA foreign_keys = ON;
