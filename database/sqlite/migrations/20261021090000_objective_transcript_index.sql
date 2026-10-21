-- Keyset history walks do not sort the complete objective archive.
CREATE INDEX idx_objectives_transcript_created ON objectives (workspace_id, created_at, id)
WHERE deleted_at IS NULL;
