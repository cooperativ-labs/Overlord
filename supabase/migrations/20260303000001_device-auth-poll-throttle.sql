-- Add next_poll_at to device_auth_codes to throttle CLI polling to one request per 5 seconds.
-- The poll route sets this column to now() + 5 seconds on each poll and returns slow_down
-- (HTTP 429) if a request arrives before the window expires.
ALTER TABLE device_auth_codes
  ADD COLUMN next_poll_at timestamptz;
