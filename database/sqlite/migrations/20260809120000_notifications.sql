-- Durable server-owned mission-notification history (coo:637 P2, contract 59).
-- This table contains references and lifecycle state only; presentation is
-- recomputed by the dispatcher and no APNs token or agent-authored payload is stored.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  recipient_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'mission_awaiting_review',
    'agent_question',
    'mission_complete',
    'mission_failed',
    'agent_started',
    'returned_to_execute'
  )),
  mission_id TEXT NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  objective_id TEXT REFERENCES objectives (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  read_at TEXT CHECK (read_at IS NULL OR read_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z')
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_active_created
  ON notifications (recipient_profile_id, deleted_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_workspace_mission
  ON notifications (workspace_id, mission_id);
