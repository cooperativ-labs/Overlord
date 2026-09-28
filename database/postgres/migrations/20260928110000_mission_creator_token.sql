BEGIN;

-- Soft provenance: a token can be deleted without removing mission history.
ALTER TABLE missions ADD COLUMN IF NOT EXISTS created_by_token_id text;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS created_by_token_label text;

COMMIT;
