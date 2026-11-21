ALTER TABLE execution_requests ADD COLUMN background_probe_key TEXT
  CHECK (background_probe_key IS NULL OR
    (requested_source = 'local_target_mutation' AND mission_id IS NULL AND objective_id IS NULL));

CREATE INDEX idx_execution_requests_probe_lookup ON execution_requests (background_probe_key, created_at)
  WHERE background_probe_key IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_execution_requests_probe_retention ON execution_requests (updated_at, id)
  WHERE background_probe_key IS NOT NULL;
