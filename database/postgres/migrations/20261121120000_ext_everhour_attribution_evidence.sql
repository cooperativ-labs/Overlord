-- Preserve the actor set needed to assess legacy workspace-key adoption after
-- change-feed rows are pruned. Missing memberships remain fail-closed.
CREATE TABLE IF NOT EXISTS ext_everhour_connection_attribution (
  connection_id text NOT NULL,
  actor_workspace_user_id text NOT NULL,
  PRIMARY KEY (connection_id, actor_workspace_user_id)
);

INSERT INTO ext_everhour_connection_attribution (connection_id, actor_workspace_user_id)
SELECT DISTINCT entity_id, actor_workspace_user_id
FROM entity_changes
WHERE entity_type = 'everhour:workspace_connection'
  AND operation IN ('insert', 'update') AND actor_workspace_user_id IS NOT NULL
ON CONFLICT DO NOTHING;
