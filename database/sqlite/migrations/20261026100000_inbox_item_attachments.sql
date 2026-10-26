-- Inbox item attachments (coo:1197, contract v168).
--
-- A profile-owned inbox item may carry files before it becomes a mission. The
-- attachment row lives in the owner's storage workspace (its `workspace_id`
-- and `storage_bucket_id` stay NOT NULL) with no project, mission, or
-- objective, and points at the capture through `inbox_item_id`. Promotion
-- re-points the row at the created mission's first objective and clears
-- `inbox_item_id`; deleting the item tombstones its attachments first. The FK
-- is `ON DELETE SET NULL` so the hard delete of an inbox item (promotion,
-- deletion, or profile cascade) never blocks on attachment rows.

PRAGMA foreign_keys = ON;

ALTER TABLE attachments
  ADD COLUMN inbox_item_id TEXT REFERENCES inbox_items (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_attachments_inbox_item_created ON attachments (inbox_item_id, created_at)
  WHERE inbox_item_id IS NOT NULL;
