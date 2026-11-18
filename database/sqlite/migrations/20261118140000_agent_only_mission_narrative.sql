-- Agent-only mission narrative (coo:1297 phase 2, contract ADR 0076).
-- Same semantics as the Postgres migration of the same name.
--
-- 1. `mission_summaries` gains the narrative evidence basis: `evidence_revision`
--    advances on every accepted delivery, explicit follow-up start and objective
--    reopen; `published_evidence_revision` is the basis the current agent prose
--    was published against (null: no prose, or legacy prose without a provable
--    basis); `narrative_published_at` / `narrative_changed_at` are server-issued
--    display timestamps.
-- 2. `delivery_summary_publications` holds one publication opportunity per
--    eligible accepted delivery: the immutable original inline proposal, and the
--    immutable successful publication when one happens. There is no deadline or
--    expiry column; a newer basis supersedes an outstanding opportunity.
-- 3. Retired automatic composition: queued and running
--    `overlord.mission.summary.compose.v1` jobs are cancelled (their audit rows
--    stay), pending shells stop implying a running job, and existing prose is
--    left in place as legacy text with its real provenance.
-- 4. Agent-only write fence: triggers drop any new compose job, any `pending`
--    status write, and any headline/summary write not authored by an agent, so
--    an old backend replica that is still running during a rollout cannot
--    publish or enqueue automatic narrative.

PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

ALTER TABLE mission_summaries
  ADD COLUMN evidence_revision INTEGER NOT NULL DEFAULT 0 CHECK (evidence_revision >= 0);
ALTER TABLE mission_summaries
  ADD COLUMN published_evidence_revision INTEGER
    CHECK (published_evidence_revision IS NULL OR published_evidence_revision >= 0);
ALTER TABLE mission_summaries
  ADD COLUMN narrative_published_at TEXT
    CHECK (narrative_published_at IS NULL OR narrative_published_at GLOB '????-??-??T??:??:??.???Z');
ALTER TABLE mission_summaries
  ADD COLUMN narrative_changed_at TEXT
    CHECK (narrative_changed_at IS NULL OR narrative_changed_at GLOB '????-??-??T??:??:??.???Z');

-- Existing prose has no provable coverage basis: it stays legacy
-- (published_evidence_revision null) until an agent publishes. Its last change
-- time is the time it was written. Pending shells no longer mean a job runs.
UPDATE mission_summaries
   SET narrative_changed_at = CASE
         WHEN trim(headline) <> '' OR trim(summary_markdown) <> ''
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
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       revision = revision + 1
 WHERE type = 'overlord.mission.summary.compose.v1'
   AND status IN ('queued', 'running');

CREATE TABLE delivery_summary_publications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  objective_id TEXT NOT NULL REFERENCES objectives (id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL REFERENCES deliveries (id) ON DELETE CASCADE,
  actor_workspace_user_id TEXT REFERENCES workspace_users (id) ON DELETE CASCADE,
  session_id TEXT REFERENCES agent_sessions (id) ON DELETE CASCADE,
  evidence_revision INTEGER NOT NULL CHECK (evidence_revision >= 1),
  proposed_headline TEXT,
  proposed_summary TEXT,
  withheld_reason TEXT CHECK (
    withheld_reason IS NULL OR withheld_reason IN (
      'absent', 'stale_content', 'stale_evidence', 'missing_evidence_base'
    )
  ),
  published_headline TEXT,
  published_summary TEXT,
  published_content_revision INTEGER CHECK (
    published_content_revision IS NULL OR published_content_revision >= 1
  ),
  published_at TEXT CHECK (published_at IS NULL OR published_at GLOB '????-??-??T??:??:??.???Z'),
  publish_operation_id TEXT
    CHECK (publish_operation_id IS NULL OR (length(publish_operation_id) BETWEEN 8 AND 128)),
  publish_request_digest TEXT,
  superseded_at TEXT CHECK (superseded_at IS NULL OR superseded_at GLOB '????-??-??T??:??:??.???Z'),
  superseded_reason TEXT CHECK (
    superseded_reason IS NULL OR superseded_reason IN (
      'newer_delivery', 'follow_up', 'reopened', 'source_deleted'
    )
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
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

CREATE UNIQUE INDEX idx_delivery_summary_publications_delivery
  ON delivery_summary_publications (delivery_id);
CREATE INDEX idx_delivery_summary_publications_mission_open
  ON delivery_summary_publications (mission_id, evidence_revision)
  WHERE published_at IS NULL AND superseded_at IS NULL;

-- The original proposal and a successful publication are immutable; a
-- fulfilled publication is never superseded.
CREATE TRIGGER trg_delivery_summary_publications_immutable
BEFORE UPDATE ON delivery_summary_publications
FOR EACH ROW
WHEN NEW.id IS NOT OLD.id
  OR NEW.delivery_id IS NOT OLD.delivery_id
  OR NEW.mission_id IS NOT OLD.mission_id
  OR NEW.actor_workspace_user_id IS NOT OLD.actor_workspace_user_id
  OR NEW.session_id IS NOT OLD.session_id
  OR NEW.evidence_revision IS NOT OLD.evidence_revision
  OR NEW.proposed_headline IS NOT OLD.proposed_headline
  OR NEW.proposed_summary IS NOT OLD.proposed_summary
  OR NEW.withheld_reason IS NOT OLD.withheld_reason
  OR (OLD.published_at IS NOT NULL AND (
        NEW.published_at IS NOT OLD.published_at
     OR NEW.published_headline IS NOT OLD.published_headline
     OR NEW.published_summary IS NOT OLD.published_summary
     OR NEW.published_content_revision IS NOT OLD.published_content_revision
     OR NEW.publish_operation_id IS NOT OLD.publish_operation_id
     OR NEW.publish_request_digest IS NOT OLD.publish_request_digest
     OR NEW.superseded_at IS NOT NULL))
  OR (OLD.superseded_at IS NOT NULL AND NEW.published_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'delivery_summary_publications source and publication are immutable');
END;

-- Agent-only narrative write fence. RAISE(IGNORE) drops the row write and
-- lets the statement continue, so an old replica's delivery still commits.
CREATE TRIGGER trg_worker_jobs_no_mission_narrative_insert
BEFORE INSERT ON worker_jobs
FOR EACH ROW
WHEN NEW.type = 'overlord.mission.summary.compose.v1' AND NEW.status IN ('queued', 'running')
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER trg_worker_jobs_no_mission_narrative_revival
BEFORE UPDATE ON worker_jobs
FOR EACH ROW
WHEN OLD.type = 'overlord.mission.summary.compose.v1' AND OLD.status = 'cancelled'
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER trg_mission_summaries_agent_only_insert
BEFORE INSERT ON mission_summaries
FOR EACH ROW
WHEN NEW.status = 'pending'
  OR (NEW.generated_by <> 'agent' AND (NEW.headline <> '' OR NEW.summary_markdown <> ''))
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER trg_mission_summaries_agent_only_update
BEFORE UPDATE ON mission_summaries
FOR EACH ROW
WHEN NEW.status = 'pending'
  OR (NEW.generated_by <> 'agent' AND (
        NEW.headline IS NOT OLD.headline
     OR NEW.summary_markdown IS NOT OLD.summary_markdown
     OR NEW.content_revision IS NOT OLD.content_revision))
BEGIN
  SELECT RAISE(IGNORE);
END;

-- Agent prose written without a new publication timestamp (an older replica's
-- inline write during a rollout) cannot claim a coverage basis: it is legacy.
CREATE TRIGGER trg_mission_summaries_unverified_prose
AFTER UPDATE OF content_revision ON mission_summaries
FOR EACH ROW
WHEN NEW.content_revision IS NOT OLD.content_revision
  AND NEW.narrative_published_at IS OLD.narrative_published_at
BEGIN
  UPDATE mission_summaries
     SET published_evidence_revision = NULL,
         narrative_changed_at = COALESCE(NEW.generated_at, NEW.updated_at)
   WHERE mission_id = NEW.mission_id;
END;

COMMIT;
