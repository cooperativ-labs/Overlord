-- Project-scoped mission statuses (coo:752 Phase B).
--
-- The dialect-specific DDL, UUID fan-out, dependent-FK rebuilds, and verification
-- gates run immediately after this marker through
-- project-statuses-migration-runtime.ts. SQLite needs that runtime because it
-- cannot generate UUIDs or replace foreign keys in place.
PRAGMA foreign_keys = ON;
