-- Durable server-owned mission-notification history (coo:637 P2, contract 59).
-- This table contains references and lifecycle state only; presentation is
-- recomputed by the dispatcher and no APNs token or agent-authored payload is stored.
BEGIN;

CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  recipient_profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'mission_awaiting_review',
    'agent_question',
    'mission_complete',
    'mission_failed',
    'agent_started',
    'returned_to_execute'
  )),
  mission_id text NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  objective_id text REFERENCES objectives (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  read_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_active_created
  ON notifications (recipient_profile_id, deleted_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_workspace_mission
  ON notifications (workspace_id, mission_id);

COMMIT;
