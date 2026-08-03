-- Account-owned unassigned mission capture (coo:574, contract 54).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inbox_items (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  objectives_json TEXT NOT NULL CHECK (json_valid(objectives_json)),
  due_datetime TEXT CHECK (due_datetime IS NULL OR due_datetime GLOB '????-??-??T??:??:??.???Z'),
  priority TEXT CHECK (priority IS NULL OR priority IN ('low', 'normal', 'high', 'urgent')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inbox_items_profile_created_at
  ON inbox_items (profile_id, created_at DESC);
