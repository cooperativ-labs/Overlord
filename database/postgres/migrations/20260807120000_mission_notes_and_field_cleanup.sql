-- Mission notes and field cleanup (coo:639).
--
-- Drops unused acceptance-criteria and available-tools mission columns and adds
-- notes_text for human-only mission notes that never enter agent context.

BEGIN;

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS notes_text text;

ALTER TABLE missions
  DROP COLUMN IF EXISTS acceptance_criteria_text,
  DROP COLUMN IF EXISTS available_tools_json;

COMMIT;
