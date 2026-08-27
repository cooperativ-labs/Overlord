-- Mission-less local-target capability calls (coo:833 Phase B, contract v129).
--
-- `execution_requests` was written for one thing: launching an agent on an
-- objective, so `mission_id` / `objective_id` were NOT NULL. The same table is
-- now also the transport for local-target *capability calls* — a Latch probe, a
-- repository read, `doctor`, delivering an answer into a session — queued with
-- `requested_source = 'local_target_mutation'`. Most of those have no mission,
-- and the queue was forcing callers to invent one by picking whichever mission
-- happened to be newest in the project.
--
-- Both columns become nullable, but only for that one source: every other
-- request still requires both, enforced by a CHECK rather than by convention.
-- Such a row is authorized by `project_id` + `execution_target_id` instead.
--
-- Also adds the completion wake hint that mirrors `notify_execution_request_queued`:
-- the queueing side long-polls for a claim, the calling side long-polls for the
-- result, and both should be woken rather than polled.

BEGIN;

ALTER TABLE execution_requests
  ALTER COLUMN mission_id DROP NOT NULL,
  ALTER COLUMN objective_id DROP NOT NULL;

ALTER TABLE execution_requests
  ADD CONSTRAINT execution_requests_mission_scope
  CHECK (
    requested_source = 'local_target_mutation'
    OR (mission_id IS NOT NULL AND objective_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION notify_execution_request_completed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.requested_source = 'local_target_mutation'
     AND NEW.status IN ('launched', 'failed', 'cleared', 'cancelled', 'expired')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM pg_notify(
      'overlord_execution_request_completed',
      json_build_object('requestId', NEW.id, 'workspaceId', NEW.workspace_id)::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS execution_requests_completion_notify ON execution_requests;
CREATE TRIGGER execution_requests_completion_notify
  AFTER INSERT OR UPDATE OF status ON execution_requests
  FOR EACH ROW EXECUTE FUNCTION notify_execution_request_completed();

COMMIT;
