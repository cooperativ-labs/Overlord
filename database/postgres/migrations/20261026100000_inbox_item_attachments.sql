-- Inbox item attachments (coo:1197, contract v168). Same semantics as the
-- SQLite migration of the same name: a nullable `attachments.inbox_item_id`
-- FK (`ON DELETE SET NULL`) plus a partial index for the owner's per-item list.

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS inbox_item_id text REFERENCES inbox_items (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_attachments_inbox_item_created ON attachments (inbox_item_id, created_at)
  WHERE inbox_item_id IS NOT NULL;
