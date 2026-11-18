-- Durable draft delivery evidence (coo:1297 phase 4, contract ADR 0078).
-- Same semantics as the Postgres migration of the same name.
--
-- An executing agent may record provisional report evidence while it works
-- (`update` with reportDraft). Each live protocol session owns at most one
-- draft. The draft is provisional: it creates no mission_items, no human
-- obligation and no lifecycle meaning. `deliver` seals it in the finalization
-- transaction, after which the draft and its entries are immutable.
--
-- delivery_report_drafts          one per session; `revision` is the CAS
--                                  revision agents send as expectedRevision
-- delivery_report_draft_entries   one per stable client entry id; withdrawn
--                                  entries stay as audit data
-- delivery_report_draft_batches   one immutable receipt per accepted batch
--                                  (caller operation id + canonical digest +
--                                  result revision + attributable event id),
--                                  retained for the draft's lifetime
--
-- Retained history is bounded explicitly (1,000 accepted batches and 1,000
-- distinct entry ids per draft); writes beyond either bound are refused and
-- nothing is pruned, so a batch receipt always replays.

PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE delivery_report_drafts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  objective_id TEXT NOT NULL REFERENCES objectives (id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES agent_sessions (id) ON DELETE CASCADE,
  owner_workspace_user_id TEXT NOT NULL REFERENCES workspace_users (id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  batch_count INTEGER NOT NULL DEFAULT 0 CHECK (batch_count BETWEEN 0 AND 1000),
  entry_count INTEGER NOT NULL DEFAULT 0 CHECK (entry_count BETWEEN 0 AND 1000),
  sealed_at TEXT CHECK (sealed_at IS NULL OR sealed_at GLOB '????-??-??T??:??:??.???Z'),
  sealed_delivery_id TEXT REFERENCES deliveries (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  CHECK (sealed_delivery_id IS NULL OR sealed_at IS NOT NULL)
);

CREATE UNIQUE INDEX idx_delivery_report_drafts_session
  ON delivery_report_drafts (session_id);
CREATE INDEX idx_delivery_report_drafts_objective
  ON delivery_report_drafts (objective_id, updated_at);
CREATE INDEX idx_delivery_report_drafts_sealed_delivery
  ON delivery_report_drafts (sealed_delivery_id)
  WHERE sealed_delivery_id IS NOT NULL;

-- A sealed draft never changes again. The only permitted write is the
-- foreign-key action that clears sealed_delivery_id when its source delivery
-- row is hard-deleted.
CREATE TRIGGER trg_delivery_report_drafts_sealed_immutable
BEFORE UPDATE ON delivery_report_drafts
FOR EACH ROW
WHEN OLD.sealed_at IS NOT NULL
  AND NOT (
    NEW.sealed_delivery_id IS NULL
    AND NEW.id = OLD.id
    AND NEW.session_id = OLD.session_id
    AND NEW.revision = OLD.revision
    AND NEW.batch_count = OLD.batch_count
    AND NEW.entry_count = OLD.entry_count
    AND NEW.sealed_at = OLD.sealed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'sealed delivery_report_drafts rows are immutable');
END;

CREATE TABLE delivery_report_draft_entries (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES delivery_report_drafts (id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  entry_id TEXT NOT NULL CHECK (length(entry_id) BETWEEN 1 AND 100),
  kind TEXT NOT NULL CHECK (
    kind IN ('human_action', 'tradeoff', 'known_risk', 'deferred_work', 'assumption')
  ),
  content_json TEXT NOT NULL CHECK (
    json_valid(content_json) AND json_type(content_json) = 'object'
      AND length(content_json) <= 8000
  ),
  position INTEGER NOT NULL CHECK (position >= 0),
  withdrawn_at TEXT CHECK (withdrawn_at IS NULL OR withdrawn_at GLOB '????-??-??T??:??:??.???Z'),
  withdrawn_reason TEXT CHECK (
    withdrawn_reason IS NULL OR length(withdrawn_reason) BETWEEN 1 AND 280
  ),
  source_event_id TEXT,
  imported_from_draft_id TEXT,
  imported_from_entry_id TEXT,
  sealed_ref TEXT CHECK (sealed_ref IS NULL OR length(sealed_ref) BETWEEN 1 AND 200),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  CHECK ((withdrawn_at IS NULL) = (withdrawn_reason IS NULL)),
  CHECK ((imported_from_draft_id IS NULL) = (imported_from_entry_id IS NULL))
);

CREATE UNIQUE INDEX idx_delivery_report_draft_entries_entry
  ON delivery_report_draft_entries (draft_id, entry_id);
CREATE INDEX idx_delivery_report_draft_entries_position
  ON delivery_report_draft_entries (draft_id, position);

CREATE TRIGGER trg_delivery_report_draft_entries_sealed_insert
BEFORE INSERT ON delivery_report_draft_entries
FOR EACH ROW
WHEN (SELECT sealed_at FROM delivery_report_drafts WHERE id = NEW.draft_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'sealed delivery_report_drafts rows are immutable');
END;

CREATE TRIGGER trg_delivery_report_draft_entries_sealed_update
BEFORE UPDATE ON delivery_report_draft_entries
FOR EACH ROW
WHEN (SELECT sealed_at FROM delivery_report_drafts WHERE id = OLD.draft_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'sealed delivery_report_drafts rows are immutable');
END;

CREATE TABLE delivery_report_draft_batches (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES delivery_report_drafts (id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 8 AND 128),
  request_digest TEXT NOT NULL CHECK (length(request_digest) BETWEEN 8 AND 128),
  result_revision INTEGER NOT NULL CHECK (result_revision >= 1),
  event_id TEXT NOT NULL,
  operation_count INTEGER NOT NULL CHECK (operation_count BETWEEN 1 AND 50),
  accepted_at TEXT NOT NULL CHECK (accepted_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z')
);

CREATE UNIQUE INDEX idx_delivery_report_draft_batches_operation
  ON delivery_report_draft_batches (draft_id, operation_id);

CREATE TRIGGER trg_delivery_report_draft_batches_immutable
BEFORE UPDATE ON delivery_report_draft_batches
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'delivery_report_draft_batches rows are immutable');
END;

COMMIT;
