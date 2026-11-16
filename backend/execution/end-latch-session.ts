import { PERMISSIONS } from '@overlord/auth';

import { endLatchSession } from '../../packages/core/service/end-latch-session.ts';
import { buildWebappServiceContextForWorkspace, requireDatabaseClient } from '../db.ts';
import { requiredString } from '../errors.ts';
import { requireMissionPermission } from '../rbac.ts';

export async function endMissionLatchSession(missionRef: string, body: unknown) {
  const scope = await requireMissionPermission({
    missionRef,
    permission: PERMISSIONS.MISSION_UPDATE
  });
  const executionRequestId = requiredString(
    (body as { executionRequestId?: unknown } | null)?.executionRequestId,
    'executionRequestId',
    128
  );
  const ctx = await buildWebappServiceContextForWorkspace(
    scope.workspaceId,
    requireDatabaseClient(),
    scope.workspaceUserId
  );
  return endLatchSession({ ctx, missionId: scope.missionId, executionRequestId });
}
