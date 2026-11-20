-- Rename the objective "description" (ADR 0057/0059) to "summary" (coo:1321, ADR 0083).
-- The agent-facing text is the instructions; the human-facing overview is the
-- summary. A pure rename: no data, default or constraint meaning changes. CHECK
-- constraints follow the renamed columns; no index, trigger or view references them.
BEGIN;
ALTER TABLE objectives RENAME COLUMN description TO summary;
ALTER TABLE objectives RENAME COLUMN description_source TO summary_source;
ALTER TABLE objectives RENAME COLUMN description_instruction_hash TO summary_instruction_hash;
ALTER TABLE objectives RENAME COLUMN description_author_workspace_user_id TO summary_author_workspace_user_id;
ALTER TABLE objectives RENAME COLUMN description_author_agent TO summary_author_agent;
ALTER TABLE objectives RENAME COLUMN description_updated_at TO summary_updated_at;
ALTER TABLE objectives RENAME COLUMN description_revision TO summary_revision;
ALTER TABLE objectives RENAME COLUMN description_suppressed TO summary_suppressed;
ALTER TABLE objectives RENAME COLUMN description_generation TO summary_generation;
ALTER TABLE objectives RENAME COLUMN description_status TO summary_status;
ALTER TABLE objectives RENAME COLUMN description_request_kind TO summary_request_kind;
ALTER TABLE objectives RENAME COLUMN description_failure_code TO summary_failure_code;
COMMIT;
