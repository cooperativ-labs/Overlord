-- ADR 0076 cutover verification (read-only: every write is rolled back).
-- Step 1/3: compose backlog and pending shells.
SELECT status, count(*) FROM worker_jobs
 WHERE type = 'overlord.mission.summary.compose.v1' GROUP BY status ORDER BY status;
SELECT count(*) AS pending_summaries FROM mission_summaries WHERE status = 'pending';
SELECT version FROM schema_migrations
 WHERE version IN ('20261118120000','20261118140000','20261118160000') ORDER BY version;
-- Step 4: fence check inside a rolled-back transaction.
BEGIN;
INSERT INTO worker_jobs (id, workspace_id, type, status, priority, run_after, attempt_count,
  max_attempts, payload_json, created_at, updated_at, revision)
SELECT 'fence-check-job', id, 'overlord.mission.summary.compose.v1', 'queued', 50, now(), 0, 5,
  '{"missionId":"fence-check"}', now(), now(), 1 FROM workspaces LIMIT 1;
SELECT count(*) AS fence_job_rows_expect_0 FROM worker_jobs WHERE id = 'fence-check-job';
WITH target AS (SELECT mission_id, headline FROM mission_summaries ORDER BY updated_at DESC LIMIT 1)
UPDATE mission_summaries s SET headline = 'FENCE CHECK', generated_by = 'gemini',
  content_revision = s.content_revision + 1
  FROM target WHERE s.mission_id = target.mission_id;
SELECT count(*) AS fence_headline_rows_expect_0 FROM mission_summaries WHERE headline = 'FENCE CHECK';
ROLLBACK;
