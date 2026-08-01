-- Agent-session inject honesty (coo:562 phase 3, contract 51)
--
-- `status` alone cannot tell a UI whether an emitted instruction was Delivered to the
-- agent or Queued at a named boundary. Cursor's `followup_message` can never honestly
-- report Delivered — only Queued(turn-boundary) — and the UI must say so. This column is
-- written at emit time by the adapter that chose the path; it is never inferred from the
-- agent identifier after the fact.

PRAGMA foreign_keys = ON;

ALTER TABLE agent_session_inputs
  ADD COLUMN delivery_outcome TEXT
  CHECK (
    delivery_outcome IS NULL
    OR delivery_outcome IN (
      'delivered',
      'queued_turn_boundary',
      'queued_next_turn',
      'unsupported'
    )
  );
