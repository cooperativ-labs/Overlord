-- Creation provenance for missions and objectives (coo:669 Phase 1).
--
-- Records whether a row was authored by a human, an agent, or Overlord
-- automation, plus optional agent identifier and authoring session. The session
-- id is a deliberate soft reference to agent_sessions.id (no FK) so a dangling
-- provenance pointer can never block a delete.
--
-- Historical labelling is best-effort and biased toward 'human', which is the
-- safe direction: a wrongly-unmarked mission looks like today's behavior; a
-- wrongly-marked one is a visible lie. Only rows whose entity_changes insert
-- event still exists with source = 'protocol' are backfilled to 'agent'.

PRAGMA foreign_keys = ON;

ALTER TABLE missions ADD COLUMN created_by_kind TEXT NOT NULL DEFAULT 'human'
  CHECK (created_by_kind IN ('human', 'agent', 'automation'));
ALTER TABLE missions ADD COLUMN created_by_agent TEXT;
ALTER TABLE missions ADD COLUMN created_by_session_id TEXT;

ALTER TABLE objectives ADD COLUMN created_by_kind TEXT NOT NULL DEFAULT 'human'
  CHECK (created_by_kind IN ('human', 'agent', 'automation'));
ALTER TABLE objectives ADD COLUMN created_by_agent TEXT;
ALTER TABLE objectives ADD COLUMN created_by_session_id TEXT;

UPDATE missions SET created_by_kind = 'agent'
 WHERE id IN (
   SELECT entity_id FROM entity_changes
    WHERE entity_type = 'mission' AND operation = 'insert' AND source = 'protocol'
 );

UPDATE objectives SET created_by_kind = 'agent'
 WHERE id IN (
   SELECT entity_id FROM entity_changes
    WHERE entity_type = 'objective' AND operation = 'insert' AND source = 'protocol'
 );
