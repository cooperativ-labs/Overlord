PRAGMA foreign_keys = ON;
BEGIN;

-- Soft provenance: a token can be deleted without removing mission history.
ALTER TABLE missions ADD COLUMN created_by_token_id TEXT;
ALTER TABLE missions ADD COLUMN created_by_token_label TEXT;

COMMIT;
