-- Add requester_ip to device_auth_codes for issuance rate limiting.
-- The /api/auth/device/request route stores the client IP on each new code and
-- checks how many codes were issued to that IP in the past 10 minutes before
-- inserting a new one. The index supports that count query efficiently.
ALTER TABLE device_auth_codes
  ADD COLUMN requester_ip text;

CREATE INDEX device_auth_codes_requester_ip_created_idx
  ON device_auth_codes (requester_ip, created_at);
