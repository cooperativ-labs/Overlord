-- The `answer` mission event (coo:833 Phase A, contract v129).
--
-- Resolving a blocking question writes a mission event of type `answer` beside
-- the `ask` it answers, so the feed can render the exchange as a pair and
-- `has_unseen_blocking_question` can tell an answered ask from an open one.
-- Postgres can widen the CHECK in place, so this is a constraint swap rather
-- than the table rebuild the SQLite dialect needs.

ALTER TABLE mission_events DROP CONSTRAINT IF EXISTS mission_events_type_check;
ALTER TABLE mission_events ADD CONSTRAINT mission_events_type_check
  CHECK (type IN ('update', 'user_follow_up', 'alert', 'discussion_summary', 'decision', 'ask', 'answer', 'permission_request', 'delivery', 'execution_requested', 'awaiting_approval', 'status_change'));
