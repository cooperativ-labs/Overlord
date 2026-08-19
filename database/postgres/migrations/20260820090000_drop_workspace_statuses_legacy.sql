-- Phase G (coo:752): the v93 rollback retention window has elapsed.
-- Any remaining foreign-key dependency must fail this migration.
DROP TABLE workspace_statuses_legacy;
