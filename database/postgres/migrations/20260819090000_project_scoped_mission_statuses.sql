-- Project-scoped mission statuses (coo:752 Phase B).
--
-- The dialect-specific DDL, UUID fan-out, dependent-FK rewiring, and verification
-- gates run immediately after this marker through
-- project-statuses-migration-runtime.ts. The runtime deliberately generates the
-- UUIDs for both adapters so the identifiers have one consistent shape.
BEGIN;
COMMIT;
