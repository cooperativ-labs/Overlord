-- Run Queue: waiting vs. blocked (coo:854 phase 1, contract v122).
--
-- `state = 'blocked'` used to mean two unrelated things: "a human must do
-- something" (no agent, no instruction) and "a transient condition has not
-- cleared yet" (a sibling of the same serial mission is running). Because the
-- dispatcher only ever re-evaluated `waiting` entries, the transient case was
-- parked permanently the first time it fired.
--
-- `waiting_reason` splits the two. `blocked` now means "needs a human";
-- `waiting` + a reason means "eligible as soon as the condition clears", and
-- the dispatcher re-evaluates both states every tick. `waiting_on_objective_id`
-- names the sibling a `mission_busy` entry is queued behind so the UI can say
-- what it is waiting for instead of showing an amber hold.

BEGIN;

ALTER TABLE run_queue_entries
  ADD COLUMN IF NOT EXISTS waiting_reason text,
  ADD COLUMN IF NOT EXISTS waiting_on_objective_id text REFERENCES objectives (id) ON DELETE SET NULL;

ALTER TABLE run_queue_entries
  ADD CONSTRAINT run_queue_entries_waiting_reason_check
  CHECK (
    waiting_reason IS NULL
    OR waiting_reason IN ('mission_busy', 'resource_disconnected', 'retry_pending')
  );

CREATE INDEX idx_run_queue_entries_waiting_on_objective
  ON run_queue_entries (waiting_on_objective_id)
  WHERE waiting_on_objective_id IS NOT NULL AND deleted_at IS NULL;

-- Release entries parked by the old semantics. These holds are transient by
-- definition, so returning them to `waiting` lets the next tick re-evaluate
-- them rather than requiring a human to drag every one of them.
UPDATE run_queue_entries
   SET state = 'waiting',
       waiting_reason = blocked_reason,
       blocked_reason = NULL,
       updated_at = now(),
       revision = revision + 1
 WHERE deleted_at IS NULL
   AND state = 'blocked'
   AND blocked_reason IN ('mission_busy', 'resource_disconnected');

COMMIT;
