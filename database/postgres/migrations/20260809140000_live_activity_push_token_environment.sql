-- Per-registration APNs host/topic for Live Activity update tokens (coo:656).
--
-- Without environment/bundle_id the update dispatcher fell back to the process
-- OVERLORD_APNS_ENV host. A sandbox debug token sent to production APNs returns
-- 400 BadDeviceToken, which is treated as permanent retirement and deletes the
-- row with no retry — so remote updates silently disappear while local sync
-- still works. Mirror the start-token / device-token CHECK constraints.
BEGIN;

-- Rows registered before routing metadata existed cannot be sent safely; the
-- client re-registers on the next home-screen sync.
DELETE FROM live_activity_push_tokens;

ALTER TABLE live_activity_push_tokens
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'sandbox'
    CHECK (environment IN ('sandbox', 'production'));

ALTER TABLE live_activity_push_tokens
  ADD COLUMN IF NOT EXISTS bundle_id text NOT NULL DEFAULT 'io.cooperativ.overlord'
    CHECK (char_length(btrim(bundle_id)) > 0);

ALTER TABLE live_activity_push_tokens ALTER COLUMN environment DROP DEFAULT;
ALTER TABLE live_activity_push_tokens ALTER COLUMN bundle_id DROP DEFAULT;

COMMIT;
