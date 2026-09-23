-- Deferred-work resolution outcome (coo:1045, contract v147).
--
-- A deferred-work item in a delivery can be promoted into a new mission, added
-- to the delivering mission as a future objective, or dismissed. Promotion is
-- recorded as a `done` resolution; `outcome` says which promotion happened so
-- every surface (delivery card, Feed rail) can show the operator's choice, and
-- `outcome_ref` keeps the display id of the mission or objective it created.
-- Both are nullable and additive: existing rows and plain `done`/`dismissed`
-- resolutions keep null.

PRAGMA foreign_keys = ON;

ALTER TABLE human_action_resolutions ADD COLUMN outcome TEXT
  CHECK (outcome IS NULL OR outcome IN ('mission_created', 'objective_added'));

ALTER TABLE human_action_resolutions ADD COLUMN outcome_ref TEXT
  CHECK (outcome_ref IS NULL OR length(trim(outcome_ref)) > 0);
