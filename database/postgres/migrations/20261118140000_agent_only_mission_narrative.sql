-- Agent-only mission narrative (coo:1297 phase 2, contract ADR 0076).
-- See the SQLite migration of the same name for the semantics.
BEGIN;

ALTER TABLE mission_summaries
  ADD COLUMN IF NOT EXISTS evidence_revision integer NOT NULL DEFAULT 0
    CHECK (evidence_revision >= 0);
ALTER TABLE mission_summaries
  ADD COLUMN IF NOT EXISTS published_evidence_revision integer
    CHECK (published_evidence_revision IS NULL OR published_evidence_revision >= 0);
ALTER TABLE mission_summaries ADD COLUMN IF NOT EXISTS narrative_published_at timestamptz;
ALTER TABLE mission_summaries ADD COLUMN IF NOT EXISTS narrative_changed_at timestamptz;

UPDATE mission_summaries
   SET narrative_changed_at = CASE
         WHEN btrim(headline) <> '' OR btrim(summary_markdown) <> ''
           THEN COALESCE(generated_at, updated_at)
         ELSE NULL
       END,
       status = CASE WHEN status = 'pending' THEN 'composed' ELSE status END,
       completed_generation = requested_generation;

UPDATE worker_jobs
   SET status = 'cancelled',
       last_error = 'retired: automatic mission narrative composition was removed (ADR 0076)',
       locked_by = NULL,
       locked_until = NULL,
       updated_at = now(),
       revision = revision + 1
 WHERE type = 'overlord.mission.summary.compose.v1'
   AND status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS delivery_summary_publications (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY IMMEDIATE,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  mission_id text NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  objective_id text NOT NULL REFERENCES objectives (id) ON DELETE CASCADE,
  delivery_id text NOT NULL REFERENCES deliveries (id) ON DELETE CASCADE,
  actor_workspace_user_id text REFERENCES workspace_users (id) ON DELETE CASCADE,
  session_id text REFERENCES agent_sessions (id) ON DELETE CASCADE,
  evidence_revision integer NOT NULL CHECK (evidence_revision >= 1),
  proposed_headline text,
  proposed_summary text,
  withheld_reason text CHECK (
    withheld_reason IS NULL OR withheld_reason IN (
      'absent', 'stale_content', 'stale_evidence', 'missing_evidence_base'
    )
  ),
  published_headline text,
  published_summary text,
  published_content_revision integer CHECK (
    published_content_revision IS NULL OR published_content_revision >= 1
  ),
  published_at timestamptz,
  publish_operation_id text
    CHECK (publish_operation_id IS NULL OR char_length(publish_operation_id) BETWEEN 8 AND 128),
  publish_request_digest text,
  superseded_at timestamptz,
  superseded_reason text CHECK (
    superseded_reason IS NULL OR superseded_reason IN (
      'newer_delivery', 'follow_up', 'reopened', 'source_deleted'
    )
  ),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((proposed_headline IS NULL) = (proposed_summary IS NULL)),
  CHECK (
    (published_at IS NULL AND published_headline IS NULL AND published_summary IS NULL
      AND published_content_revision IS NULL)
    OR (published_at IS NOT NULL AND published_headline IS NOT NULL
      AND published_summary IS NOT NULL AND published_content_revision IS NOT NULL)
  ),
  CHECK ((superseded_at IS NULL) = (superseded_reason IS NULL)),
  CHECK (published_at IS NULL OR superseded_at IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_summary_publications_delivery
  ON delivery_summary_publications (delivery_id);
CREATE INDEX IF NOT EXISTS idx_delivery_summary_publications_mission_open
  ON delivery_summary_publications (mission_id, evidence_revision)
  WHERE published_at IS NULL AND superseded_at IS NULL;

CREATE OR REPLACE FUNCTION delivery_summary_publications_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.delivery_id IS DISTINCT FROM OLD.delivery_id
     OR NEW.mission_id IS DISTINCT FROM OLD.mission_id
     OR NEW.actor_workspace_user_id IS DISTINCT FROM OLD.actor_workspace_user_id
     OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.evidence_revision IS DISTINCT FROM OLD.evidence_revision
     OR NEW.proposed_headline IS DISTINCT FROM OLD.proposed_headline
     OR NEW.proposed_summary IS DISTINCT FROM OLD.proposed_summary
     OR NEW.withheld_reason IS DISTINCT FROM OLD.withheld_reason
     OR (OLD.published_at IS NOT NULL AND (
           NEW.published_at IS DISTINCT FROM OLD.published_at
        OR NEW.published_headline IS DISTINCT FROM OLD.published_headline
        OR NEW.published_summary IS DISTINCT FROM OLD.published_summary
        OR NEW.published_content_revision IS DISTINCT FROM OLD.published_content_revision
        OR NEW.publish_operation_id IS DISTINCT FROM OLD.publish_operation_id
        OR NEW.publish_request_digest IS DISTINCT FROM OLD.publish_request_digest
        OR NEW.superseded_at IS NOT NULL))
     OR (OLD.superseded_at IS NOT NULL AND NEW.published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'delivery_summary_publications source and publication are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_summary_publications_immutable ON delivery_summary_publications;
CREATE TRIGGER trg_delivery_summary_publications_immutable
BEFORE UPDATE ON delivery_summary_publications
FOR EACH ROW EXECUTE FUNCTION delivery_summary_publications_immutable();

-- Agent-only narrative write fence. Returning NULL from a BEFORE trigger skips
-- the row write without failing the statement, so an old replica's delivery
-- still commits while its automatic narrative write is dropped.
CREATE OR REPLACE FUNCTION worker_jobs_no_mission_narrative() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.type = 'overlord.mission.summary.compose.v1'
       AND NEW.status IN ('queued', 'running') THEN
      RETURN NULL;
    END IF;
  ELSIF OLD.type = 'overlord.mission.summary.compose.v1' AND OLD.status = 'cancelled' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_worker_jobs_no_mission_narrative ON worker_jobs;
CREATE TRIGGER trg_worker_jobs_no_mission_narrative
BEFORE INSERT OR UPDATE ON worker_jobs
FOR EACH ROW EXECUTE FUNCTION worker_jobs_no_mission_narrative();

CREATE OR REPLACE FUNCTION mission_summaries_agent_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.generated_by <> 'agent' AND (NEW.headline <> '' OR NEW.summary_markdown <> '') THEN
      RETURN NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.generated_by <> 'agent' AND (
       NEW.headline IS DISTINCT FROM OLD.headline
    OR NEW.summary_markdown IS DISTINCT FROM OLD.summary_markdown
    OR NEW.content_revision IS DISTINCT FROM OLD.content_revision) THEN
    RETURN NULL;
  END IF;
  -- Agent prose written without a new publication timestamp (an older
  -- replica's inline write during a rollout) cannot claim a coverage basis.
  IF NEW.content_revision IS DISTINCT FROM OLD.content_revision
     AND NEW.narrative_published_at IS NOT DISTINCT FROM OLD.narrative_published_at THEN
    NEW.published_evidence_revision := NULL;
    NEW.narrative_changed_at := COALESCE(NEW.generated_at, NEW.updated_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mission_summaries_agent_only ON mission_summaries;
CREATE TRIGGER trg_mission_summaries_agent_only
BEFORE INSERT OR UPDATE ON mission_summaries
FOR EACH ROW EXECUTE FUNCTION mission_summaries_agent_only();

COMMIT;
