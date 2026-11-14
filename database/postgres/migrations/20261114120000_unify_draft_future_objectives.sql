-- Unify `draft` and `future` objectives into one ordered draft queue
-- (coo:1274, contract ADR 0056).
--
-- `future` is retired from the closed `objectives.state` vocabulary. Every
-- `future` row, live or soft-deleted, becomes `draft` with its id, position,
-- ownership, provenance, configuration, attachments and Run Queue membership
-- unchanged; only `state`, `revision` and `updated_at` move. Blank rows are
-- preserved: they may carry attachments, configuration or history, and the
-- removal of the old refill logic does not require deleting them. Historical
-- mission events and delivery payloads keep the state strings they recorded.
-- Positions need no renumbering: the unique `(mission_id, position)` index
-- already holds and flipping the state moves nothing.

UPDATE objectives
   SET state = 'draft',
       revision = revision + 1,
       updated_at = now()
 WHERE state = 'future';

ALTER TABLE objectives DROP CONSTRAINT IF EXISTS objectives_state_check;
ALTER TABLE objectives
  ADD CONSTRAINT objectives_state_check
  CHECK (state IN ('draft', 'submitted', 'launching', 'executing', 'pending_delivery', 'complete'));
