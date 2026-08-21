-- Objective lifecycle timestamps (coo:811).
--
-- Mission objectives are now ordered by *when they moved through the
-- lifecycle*, not only by their queue position: completed objectives first in
-- completion order, then executing objectives in start order, then launching
-- objectives in launch order. `completed_at` already existed; `launched_at`
-- and `started_at` are the two moments that were never recorded.
--
-- Both are written first-wins (COALESCE), so a re-launch or a re-attach after
-- delivery never reshuffles an objective that already has a place in the list.

PRAGMA foreign_keys = ON;

ALTER TABLE objectives ADD COLUMN launched_at TEXT
  CHECK (launched_at IS NULL OR launched_at GLOB '????-??-??T??:??:??.???Z');
ALTER TABLE objectives ADD COLUMN started_at TEXT
  CHECK (started_at IS NULL OR started_at GLOB '????-??-??T??:??:??.???Z');

-- Backfill from updated_at so existing missions get a stable, plausible order
-- immediately instead of falling back to position for every historical row.
UPDATE objectives SET launched_at = updated_at
  WHERE launched_at IS NULL
    AND state IN ('launching', 'executing', 'pending_delivery', 'complete');
UPDATE objectives SET started_at = updated_at
  WHERE started_at IS NULL
    AND state IN ('executing', 'pending_delivery', 'complete');
UPDATE objectives SET completed_at = updated_at
  WHERE completed_at IS NULL AND state = 'complete';
