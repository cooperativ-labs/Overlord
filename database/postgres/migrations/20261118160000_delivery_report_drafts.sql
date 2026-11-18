-- Durable draft delivery evidence (coo:1297 phase 4, contract ADR 0078).
-- See the SQLite migration of the same name for the semantics.
BEGIN;

CREATE TABLE IF NOT EXISTS delivery_report_drafts (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY IMMEDIATE,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  mission_id text NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  objective_id text NOT NULL REFERENCES objectives (id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES agent_sessions (id) ON DELETE CASCADE,
  owner_workspace_user_id text NOT NULL REFERENCES workspace_users (id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  batch_count integer NOT NULL DEFAULT 0 CHECK (batch_count BETWEEN 0 AND 1000),
  entry_count integer NOT NULL DEFAULT 0 CHECK (entry_count BETWEEN 0 AND 1000),
  sealed_at timestamptz,
  sealed_delivery_id text REFERENCES deliveries (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (sealed_delivery_id IS NULL OR sealed_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_report_drafts_session
  ON delivery_report_drafts (session_id);
CREATE INDEX IF NOT EXISTS idx_delivery_report_drafts_objective
  ON delivery_report_drafts (objective_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_delivery_report_drafts_sealed_delivery
  ON delivery_report_drafts (sealed_delivery_id)
  WHERE sealed_delivery_id IS NOT NULL;

CREATE OR REPLACE FUNCTION delivery_report_drafts_sealed_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sealed_at IS NOT NULL AND NOT (
    NEW.sealed_delivery_id IS NULL
    AND NEW.id = OLD.id
    AND NEW.session_id = OLD.session_id
    AND NEW.revision = OLD.revision
    AND NEW.batch_count = OLD.batch_count
    AND NEW.entry_count = OLD.entry_count
    AND NEW.sealed_at = OLD.sealed_at
  ) THEN
    RAISE EXCEPTION 'sealed delivery_report_drafts rows are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_report_drafts_sealed_immutable ON delivery_report_drafts;
CREATE TRIGGER trg_delivery_report_drafts_sealed_immutable
BEFORE UPDATE ON delivery_report_drafts
FOR EACH ROW EXECUTE FUNCTION delivery_report_drafts_sealed_immutable();

CREATE TABLE IF NOT EXISTS delivery_report_draft_entries (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES delivery_report_drafts (id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY IMMEDIATE,
  entry_id text NOT NULL CHECK (char_length(entry_id) BETWEEN 1 AND 100),
  kind text NOT NULL CHECK (
    kind IN ('human_action', 'tradeoff', 'known_risk', 'deferred_work', 'assumption')
  ),
  content_json jsonb NOT NULL CHECK (
    jsonb_typeof(content_json) = 'object' AND char_length(content_json::text) <= 8000
  ),
  position integer NOT NULL CHECK (position >= 0),
  withdrawn_at timestamptz,
  withdrawn_reason text CHECK (
    withdrawn_reason IS NULL OR char_length(withdrawn_reason) BETWEEN 1 AND 280
  ),
  source_event_id text,
  imported_from_draft_id text,
  imported_from_entry_id text,
  sealed_ref text CHECK (sealed_ref IS NULL OR char_length(sealed_ref) BETWEEN 1 AND 200),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((withdrawn_at IS NULL) = (withdrawn_reason IS NULL)),
  CHECK ((imported_from_draft_id IS NULL) = (imported_from_entry_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_report_draft_entries_entry
  ON delivery_report_draft_entries (draft_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_delivery_report_draft_entries_position
  ON delivery_report_draft_entries (draft_id, position);

CREATE OR REPLACE FUNCTION delivery_report_draft_entries_sealed_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_draft text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_draft := NEW.draft_id;
  ELSE
    target_draft := OLD.draft_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM delivery_report_drafts WHERE id = target_draft AND sealed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'sealed delivery_report_drafts rows are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_report_draft_entries_sealed
  ON delivery_report_draft_entries;
CREATE TRIGGER trg_delivery_report_draft_entries_sealed
BEFORE INSERT OR UPDATE ON delivery_report_draft_entries
FOR EACH ROW EXECUTE FUNCTION delivery_report_draft_entries_sealed_immutable();

CREATE TABLE IF NOT EXISTS delivery_report_draft_batches (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES delivery_report_drafts (id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY IMMEDIATE,
  operation_id text NOT NULL CHECK (char_length(operation_id) BETWEEN 8 AND 128),
  request_digest text NOT NULL CHECK (char_length(request_digest) BETWEEN 8 AND 128),
  result_revision integer NOT NULL CHECK (result_revision >= 1),
  event_id text NOT NULL,
  operation_count integer NOT NULL CHECK (operation_count BETWEEN 1 AND 50),
  accepted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_report_draft_batches_operation
  ON delivery_report_draft_batches (draft_id, operation_id);

CREATE OR REPLACE FUNCTION delivery_report_draft_batches_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'delivery_report_draft_batches rows are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_report_draft_batches_immutable
  ON delivery_report_draft_batches;
CREATE TRIGGER trg_delivery_report_draft_batches_immutable
BEFORE UPDATE ON delivery_report_draft_batches
FOR EACH ROW EXECUTE FUNCTION delivery_report_draft_batches_immutable();

COMMIT;
