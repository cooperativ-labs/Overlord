BEGIN IMMEDIATE;
ALTER TABLE mission_items ADD COLUMN resolved_by_mission_id TEXT REFERENCES missions(id) ON DELETE SET NULL;
ALTER TABLE mission_items ADD COLUMN resolved_by_session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL
  CHECK ((resolved_by_mission_id IS NULL AND resolved_by_session_id IS NULL) OR COALESCE(resolved_by_kind, '') = 'agent');
ALTER TABLE mission_items ADD COLUMN restored_at TEXT
  CHECK (restored_at IS NULL OR restored_at GLOB '????-??-??T??:??:??.???Z');
UPDATE mission_items SET resolved_by_mission_id =
  (SELECT mission_id FROM objectives WHERE objectives.id = mission_items.resolved_by_objective_id)
 WHERE resolved_by_kind = 'agent' AND resolved_by_mission_id IS NULL;
CREATE INDEX idx_mission_items_resolver_session ON mission_items(resolved_by_session_id, resolved_by_delivery_id);
CREATE INDEX idx_mission_items_resolver_delivery ON mission_items(resolved_by_delivery_id);
COMMIT;
