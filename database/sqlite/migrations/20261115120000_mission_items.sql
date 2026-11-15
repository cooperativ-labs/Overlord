-- Mission items (coo:1260, contract ADR 0060). Same semantics as the Postgres
-- migration of the same name.
--
-- `mission_items` holds one row per risk, human action or suggestion that a
-- delivery reported, with a status. It is the live working set of those items;
-- the delivery report stays the immutable record of what the agent reported.
-- `item_ref` is the item's stable identity inside its delivery: a suggestion
-- reuses `DeferredWorkV1.id`, a risk or human action uses a digest of its
-- canonical content (`@overlord/database` `missionItemRef`).
--
-- Rows are backfilled from every live delivery by the TypeScript runtime step
-- that runs after this file (`mission-items-migration-runtime.ts`): it derives
-- each delivery's items, copies `human_action_resolutions` onto suggestion rows
-- and applies the supersede rules. Nothing is dropped here.
--
-- `mission_summaries` gains the narrative concurrency token and provenance
-- columns, and `generated_by` gains the value `agent`. SQLite cannot alter a
-- CHECK constraint, so the table is rebuilt; no table references it.

PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE mission_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  objective_id TEXT NOT NULL REFERENCES objectives (id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL REFERENCES deliveries (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('risk', 'human_action', 'suggestion')),
  item_ref TEXT NOT NULL CHECK (length(trim(item_ref)) > 0 AND length(item_ref) <= 200),
  position INTEGER NOT NULL CHECK (position >= 0),
  text TEXT NOT NULL CHECK (length(trim(text)) > 0),
  detail_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(detail_json) AND json_type(detail_json) = 'object'),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'done', 'dismissed', 'superseded')),
  status_reason TEXT
    CHECK (status_reason IS NULL OR (length(trim(status_reason)) > 0 AND length(status_reason) <= 280)),
  resolved_by_kind TEXT CHECK (resolved_by_kind IS NULL OR resolved_by_kind IN ('person', 'agent')),
  resolved_by_workspace_user_id TEXT REFERENCES workspace_users (id) ON DELETE SET NULL,
  resolved_by_objective_id TEXT REFERENCES objectives (id) ON DELETE SET NULL,
  resolved_by_delivery_id TEXT REFERENCES deliveries (id) ON DELETE SET NULL,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('mission_created', 'objective_added')),
  outcome_ref TEXT CHECK (outcome_ref IS NULL OR length(trim(outcome_ref)) > 0),
  resolved_at TEXT CHECK (resolved_at IS NULL OR resolved_at GLOB '????-??-??T??:??:??.???Z'),
  reported_at TEXT NOT NULL CHECK (reported_at GLOB '????-??-??T??:??:??.???Z'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  -- A closed item names who closed it and when; open and superseded items name nobody.
  CHECK ((status IN ('done', 'dismissed')) = (resolved_by_kind IS NOT NULL)),
  CHECK ((status IN ('done', 'dismissed')) = (resolved_at IS NOT NULL)),
  CHECK (status_reason IS NULL OR status IN ('done', 'dismissed')),
  CHECK (resolved_by_kind IS NULL OR resolved_by_kind <> 'agent' OR status_reason IS NOT NULL),
  CHECK (outcome IS NULL OR status = 'done'),
  CHECK (outcome_ref IS NULL OR outcome IS NOT NULL)
);

CREATE UNIQUE INDEX idx_mission_items_delivery_kind_ref
  ON mission_items (delivery_id, kind, item_ref);
CREATE INDEX idx_mission_items_mission_status_kind
  ON mission_items (mission_id, status, kind);
CREATE INDEX idx_mission_items_project_status_kind
  ON mission_items (project_id, status, kind);
CREATE INDEX idx_mission_items_objective_status
  ON mission_items (objective_id, status);

CREATE TABLE mission_summaries_v173 (
  mission_id TEXT PRIMARY KEY REFERENCES missions (id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  requested_generation INTEGER NOT NULL DEFAULT 0 CHECK (requested_generation >= 0),
  completed_generation INTEGER NOT NULL DEFAULT 0 CHECK (completed_generation >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'composed', 'fallback')),
  headline TEXT NOT NULL DEFAULT '',
  summary_markdown TEXT NOT NULL DEFAULT '',
  risks_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(risks_json) AND json_type(risks_json) = 'array'),
  suggestions_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(suggestions_json) AND json_type(suggestions_json) = 'array'),
  source_delivery_id TEXT,
  generated_by TEXT NOT NULL CHECK (generated_by IN ('deterministic', 'gemini', 'agent')),
  generated_at TEXT CHECK (generated_at IS NULL OR generated_at GLOB '????-??-??T??:??:??.???Z'),
  model TEXT,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  content_revision INTEGER NOT NULL DEFAULT 0 CHECK (content_revision >= 0),
  narrative_delivery_id TEXT,
  narrative_objective_id TEXT
);

INSERT INTO mission_summaries_v173 (
  mission_id, workspace_id, project_id, revision, requested_generation, completed_generation,
  status, headline, summary_markdown, risks_json, suggestions_json, source_delivery_id,
  generated_by, generated_at, model, created_at, updated_at
)
SELECT mission_id, workspace_id, project_id, revision, requested_generation, completed_generation,
       status, headline, summary_markdown, risks_json, suggestions_json, source_delivery_id,
       generated_by, generated_at, model, created_at, updated_at
  FROM mission_summaries;

DROP TABLE mission_summaries;

ALTER TABLE mission_summaries_v173 RENAME TO mission_summaries;

CREATE INDEX idx_mission_summaries_workspace_updated
  ON mission_summaries (workspace_id, updated_at);

COMMIT;
