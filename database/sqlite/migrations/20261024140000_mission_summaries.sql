-- Mission summary storage (coo:1202, contract v166).
--
-- `missions.summary_enabled` is a creation-time eligibility marker. The column
-- default is true, so every mission created after this migration is eligible on
-- every creation path with no per-path code; every existing mission is set to
-- false here and never becomes eligible, so it keeps the full delivery
-- presentation and never gets a summary row or compose job.
--
-- `mission_summaries` holds one agent-maintained summary per eligible mission,
-- replaced in place. `requested_generation` increments on every compose trigger
-- and `completed_generation` records the generation the published content
-- represents, so a trigger during generation is never lost. Suggestions and
-- risks are references into delivery reports; item text is projected at read
-- time and never copied here.
--
-- `mission_summary_seen` is the per-user evidence watermark behind the
-- new-since-last-visit dot. Writes are monotonic and record no entity change.

PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

ALTER TABLE missions ADD COLUMN summary_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (summary_enabled IN (0, 1));

UPDATE missions SET summary_enabled = 0;

CREATE TABLE mission_summaries (
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
  generated_by TEXT NOT NULL CHECK (generated_by IN ('deterministic', 'gemini')),
  generated_at TEXT CHECK (generated_at IS NULL OR generated_at GLOB '????-??-??T??:??:??.???Z'),
  model TEXT,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z')
);

CREATE INDEX idx_mission_summaries_workspace_updated
  ON mission_summaries (workspace_id, updated_at);

CREATE TABLE mission_summary_seen (
  mission_id TEXT NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  workspace_user_id TEXT NOT NULL REFERENCES workspace_users (id) ON DELETE CASCADE,
  seen_at TEXT NOT NULL CHECK (seen_at GLOB '????-??-??T??:??:??.???Z'),
  PRIMARY KEY (mission_id, workspace_user_id)
);

COMMIT;
