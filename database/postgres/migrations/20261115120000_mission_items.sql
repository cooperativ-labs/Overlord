-- Mission items (coo:1260, contract ADR 0060). Same semantics as the SQLite
-- migration of the same name: create `mission_items` with its closed
-- vocabularies, unique item identity and read indexes; add the narrative
-- concurrency token and provenance columns to `mission_summaries`; and allow
-- `generated_by = 'agent'`. Rows are backfilled by the TypeScript runtime step
-- that runs after this file (`mission-items-migration-runtime.ts`). Nothing is
-- dropped here.
--
-- Every statement is idempotent so an interrupted backfill can be retried by
-- running the migration again.

BEGIN;

CREATE TABLE IF NOT EXISTS mission_items (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  mission_id text NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  objective_id text NOT NULL REFERENCES objectives (id) ON DELETE CASCADE,
  delivery_id text NOT NULL REFERENCES deliveries (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('risk', 'human_action', 'suggestion')),
  item_ref text NOT NULL
    CHECK (char_length(btrim(item_ref)) > 0 AND char_length(item_ref) <= 200),
  position integer NOT NULL CHECK (position >= 0),
  text text NOT NULL CHECK (char_length(btrim(text)) > 0),
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail_json) = 'object'),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'done', 'dismissed', 'superseded')),
  status_reason text
    CHECK (status_reason IS NULL OR
           (char_length(btrim(status_reason)) > 0 AND char_length(status_reason) <= 280)),
  resolved_by_kind text CHECK (resolved_by_kind IS NULL OR resolved_by_kind IN ('person', 'agent')),
  resolved_by_workspace_user_id text REFERENCES workspace_users (id) ON DELETE SET NULL,
  resolved_by_objective_id text REFERENCES objectives (id) ON DELETE SET NULL,
  resolved_by_delivery_id text REFERENCES deliveries (id) ON DELETE SET NULL,
  outcome text CHECK (outcome IS NULL OR outcome IN ('mission_created', 'objective_added')),
  outcome_ref text CHECK (outcome_ref IS NULL OR char_length(btrim(outcome_ref)) > 0),
  resolved_at timestamptz,
  reported_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  -- A closed item names who closed it and when; open and superseded items name nobody.
  CHECK ((status IN ('done', 'dismissed')) = (resolved_by_kind IS NOT NULL)),
  CHECK ((status IN ('done', 'dismissed')) = (resolved_at IS NOT NULL)),
  CHECK (status_reason IS NULL OR status IN ('done', 'dismissed')),
  CHECK (resolved_by_kind IS NULL OR resolved_by_kind <> 'agent' OR status_reason IS NOT NULL),
  CHECK (outcome IS NULL OR status = 'done'),
  CHECK (outcome_ref IS NULL OR outcome IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_items_delivery_kind_ref
  ON mission_items (delivery_id, kind, item_ref);
CREATE INDEX IF NOT EXISTS idx_mission_items_mission_status_kind
  ON mission_items (mission_id, status, kind);
CREATE INDEX IF NOT EXISTS idx_mission_items_project_status_kind
  ON mission_items (project_id, status, kind);
CREATE INDEX IF NOT EXISTS idx_mission_items_objective_status
  ON mission_items (objective_id, status);

ALTER TABLE mission_summaries
  ADD COLUMN IF NOT EXISTS content_revision integer NOT NULL DEFAULT 0
    CHECK (content_revision >= 0);
ALTER TABLE mission_summaries ADD COLUMN IF NOT EXISTS narrative_delivery_id text;
ALTER TABLE mission_summaries ADD COLUMN IF NOT EXISTS narrative_objective_id text;

ALTER TABLE mission_summaries DROP CONSTRAINT IF EXISTS mission_summaries_generated_by_check;
ALTER TABLE mission_summaries ADD CONSTRAINT mission_summaries_generated_by_check
  CHECK (generated_by IN ('deterministic', 'gemini', 'agent'));

COMMIT;
