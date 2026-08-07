-- Mission notes and field cleanup (coo:639).
--
-- Drops unused acceptance-criteria and available-tools mission columns and adds
-- notes_text for human-only mission notes that never enter agent context.

PRAGMA foreign_keys = OFF;

ALTER TABLE missions ADD COLUMN notes_text TEXT;

ALTER TABLE missions DROP COLUMN acceptance_criteria_text;
ALTER TABLE missions DROP COLUMN available_tools_json;

PRAGMA foreign_keys = ON;
