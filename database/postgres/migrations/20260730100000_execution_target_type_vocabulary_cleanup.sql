-- Execution-target type vocabulary cleanup (coo:528, contract 44)
--
-- Drops the unused core `ssh` execution_targets.type value and removes the dead
-- execution_requests.target_kind column. Keeps local/virtual as the claimant
-- security boundary; transport variety belongs in the provider registry.

BEGIN;

UPDATE execution_targets
SET type = 'virtual'
WHERE type = 'ssh';

ALTER TABLE execution_targets
  DROP CONSTRAINT IF EXISTS execution_targets_type_check;
ALTER TABLE execution_targets
  ADD CONSTRAINT execution_targets_type_check CHECK (type IN ('local', 'virtual'));

ALTER TABLE execution_requests
  DROP COLUMN IF EXISTS target_kind;

COMMIT;
