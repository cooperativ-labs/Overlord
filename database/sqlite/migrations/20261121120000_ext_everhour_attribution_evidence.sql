PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS ext_everhour_connection_attribution (
  connection_id TEXT NOT NULL,
  actor_workspace_user_id TEXT NOT NULL,
  PRIMARY KEY (connection_id, actor_workspace_user_id)
);

INSERT OR IGNORE INTO ext_everhour_connection_attribution (connection_id, actor_workspace_user_id)
SELECT DISTINCT entity_id, actor_workspace_user_id
FROM entity_changes
WHERE entity_type = 'everhour:workspace_connection'
  AND operation IN ('insert', 'update') AND actor_workspace_user_id IS NOT NULL;
