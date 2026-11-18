BEGIN;
ALTER TABLE mission_items ADD COLUMN IF NOT EXISTS resolved_by_mission_id text REFERENCES missions(id) ON DELETE SET NULL;
ALTER TABLE mission_items ADD COLUMN IF NOT EXISTS resolved_by_session_id text REFERENCES agent_sessions(id) ON DELETE SET NULL;
ALTER TABLE mission_items ADD COLUMN IF NOT EXISTS restored_at timestamptz;
ALTER TABLE mission_items ADD CONSTRAINT mission_items_agent_provenance CHECK (
  (resolved_by_mission_id IS NULL AND resolved_by_session_id IS NULL) OR COALESCE(resolved_by_kind, '') = 'agent');
UPDATE mission_items SET resolved_by_mission_id =
  (SELECT mission_id FROM objectives WHERE objectives.id = mission_items.resolved_by_objective_id)
 WHERE resolved_by_kind = 'agent' AND resolved_by_mission_id IS NULL;
CREATE INDEX idx_mission_items_resolver_session ON mission_items(resolved_by_session_id, resolved_by_delivery_id);
CREATE INDEX idx_mission_items_resolver_delivery ON mission_items(resolved_by_delivery_id);
COMMIT;
