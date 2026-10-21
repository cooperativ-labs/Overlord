-- Same ordering and live-row predicate as SQLite.
CREATE INDEX idx_objectives_transcript_created ON objectives (workspace_id, created_at, id)
WHERE deleted_at IS NULL;
