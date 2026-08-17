-- Stable per-objective display keys (coo:756 Phase A).
--
-- Public id is computed at read time as {missions.display_id}.{display_key}
-- (e.g. coo:756.k7xm). The key is random Crockford Base32, unique among live
-- rows of a mission, and never encodes position. Node finalize backfills
-- existing rows, sets NOT NULL, and creates idx_objectives_mission_display_key.

BEGIN;

ALTER TABLE objectives ADD COLUMN IF NOT EXISTS display_key text;

COMMIT;
