-- ADR 0060: the preceding migration and its runtime step preserve items and resolutions.
BEGIN;

DROP TABLE human_action_resolutions;
ALTER TABLE mission_summaries DROP COLUMN risks_json;
ALTER TABLE mission_summaries DROP COLUMN suggestions_json;

COMMIT;
