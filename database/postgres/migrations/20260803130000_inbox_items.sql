-- Account-owned unassigned mission capture (coo:574, contract 54).
CREATE TABLE IF NOT EXISTS inbox_items (
  id text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  objectives_json jsonb NOT NULL,
  due_datetime timestamptz,
  priority text CHECK (priority IS NULL OR priority IN ('low', 'normal', 'high', 'urgent')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inbox_items_profile_created_at
  ON inbox_items (profile_id, created_at DESC);
