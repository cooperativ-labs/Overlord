-- Human action resolutions (coo:963, contract v136).
--
-- Agents report follow-up human actions inside the delivery report
-- (deliveries.payload_json.deliveryReport.presentation.humanActions). Those
-- lists were only ever visible on one delivery card, and nothing recorded
-- whether the operator actually did them. This table records the operator's
-- decision per action; the action text itself stays in the delivery report,
-- keyed by the stable HumanActionV1.id the compose worker preserves.
-- Reopening an action deletes its row, so there is no soft delete.

PRAGMA foreign_keys = ON;

CREATE TABLE human_action_resolutions (
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL CHECK (length(trim(action_id)) > 0),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('done', 'dismissed')),
  resolved_by_workspace_user_id TEXT REFERENCES workspace_users(id) ON DELETE SET NULL,
  resolved_at TEXT NOT NULL
    CHECK (resolved_at GLOB '????-??-??T??:??:??.???Z'),
  PRIMARY KEY (delivery_id, action_id)
);

CREATE INDEX idx_human_action_resolutions_workspace_resolved
  ON human_action_resolutions (workspace_id, resolved_at);
