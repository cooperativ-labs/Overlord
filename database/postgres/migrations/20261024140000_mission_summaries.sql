-- Mission summary storage (coo:1202, contract v166). Same semantics as the
-- SQLite migration of the same name: existing missions become ineligible,
-- every mission created afterwards defaults to eligible, and the summary and
-- per-user seen tables are created.
--
-- The column is added with default false so existing rows are false without a
-- table rewrite, then the default flips to true for every later insert.

BEGIN;

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS summary_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE missions ALTER COLUMN summary_enabled SET DEFAULT true;

CREATE TABLE IF NOT EXISTS mission_summaries (
  mission_id text PRIMARY KEY REFERENCES missions (id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  requested_generation integer NOT NULL DEFAULT 0 CHECK (requested_generation >= 0),
  completed_generation integer NOT NULL DEFAULT 0 CHECK (completed_generation >= 0),
  status text NOT NULL CHECK (status IN ('pending', 'composed', 'fallback')),
  headline text NOT NULL DEFAULT '',
  summary_markdown text NOT NULL DEFAULT '',
  risks_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(risks_json) = 'array'),
  suggestions_json jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(suggestions_json) = 'array'),
  source_delivery_id text,
  generated_by text NOT NULL CHECK (generated_by IN ('deterministic', 'gemini')),
  generated_at timestamptz,
  model text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mission_summaries_workspace_updated
  ON mission_summaries (workspace_id, updated_at);

CREATE TABLE IF NOT EXISTS mission_summary_seen (
  mission_id text NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  workspace_user_id text NOT NULL REFERENCES workspace_users (id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL,
  PRIMARY KEY (mission_id, workspace_user_id)
);

COMMIT;
