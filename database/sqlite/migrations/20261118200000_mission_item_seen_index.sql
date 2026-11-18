BEGIN IMMEDIATE;
CREATE INDEX idx_mission_items_cross_close_seen ON mission_items(mission_id, workspace_id, resolved_at DESC)
 WHERE status IN ('done', 'dismissed') AND resolved_by_kind = 'agent'
   AND resolved_by_mission_id <> mission_id;
COMMIT;
