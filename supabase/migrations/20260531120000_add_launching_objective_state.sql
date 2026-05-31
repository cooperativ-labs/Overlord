-- Agent launch pipeline remediation (ticket 1:1288), Phase 2.
-- Add the `launching` objective state: the pre-attach state for a queued launch
-- request. It is treated identically to `submitted` by readers/UI for now, but
-- new launch requests write `launching` instead of `submitted` so the
-- (legacy) `submitted` state can be repurposed later.
--
-- Note: this `launching` value lives on objectives.state and is a DIFFERENT
-- column with a different lifespan from execution_requests.status = 'launching'.
-- objectives.state 'launching' covers the whole pre-attach window (request
-- created -> attach moves it to 'executing'); execution_requests.status
-- 'launching' only covers post-spawn/pre-attach. See the remediation plan's
-- "two distinct launching values" table.
alter type public.objective_state add value if not exists 'launching';

comment on type public.objective_state is
  'Objective queue state. launching is the pre-attach state for a queued launch request (treated like the legacy submitted state); pending_delivery means follow-up execution after a prior delivery produced work that needs a redelivery.';
