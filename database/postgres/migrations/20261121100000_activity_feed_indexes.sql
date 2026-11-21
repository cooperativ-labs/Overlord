BEGIN;
-- Activity feed read paths (coo:1344). The feed scopes every source by workspace:
-- delivered missions by (workspace_id, delivered_at) window, blocking questions by
-- (workspace_id, type = 'ask', created_at), and live runs by (workspace_id, state).
-- The existing workspace-leading indexes key on id or created_at, so each feed load
-- scanned the workspace's full delivery, event and objective history.
CREATE INDEX idx_deliveries_workspace_delivered ON deliveries (workspace_id, delivered_at);
CREATE INDEX idx_mission_events_workspace_type_created ON mission_events (workspace_id, type, created_at);
CREATE INDEX idx_objectives_workspace_state_updated ON objectives (workspace_id, state, updated_at);
COMMIT;
