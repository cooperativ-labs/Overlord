import { PERMISSIONS } from '@overlord/auth';

import {
  type ControlPlaneLaunchChannel,
  mintControlPlaneLaunchChannel
} from '../../packages/core/service/agent-session/index.ts';
import { asRecord } from '../../packages/core/service/execution-requests.ts';
import { buildWebappServiceContextForWorkspace, requireDatabaseClient } from '../db.ts';
import { ApiError } from '../errors.ts';
import { requireObjectivePermission } from '../rbac.ts';

/**
 * `POST /api/objectives/{id}/session-channels` — mint the session channel a control-plane
 * launch needs (ADR 0092).
 *
 * The runner (or `ovld launch`) calls this on the execution target, as the person launching,
 * just before it starts the control-plane supervisor. Permission is `session:attach`: the
 * channel is the precursor of the session that person would attach anyway, and it can do
 * strictly less than they can.
 *
 * The response carries the raw credential exactly once. The caller stages it in the owner-only
 * credential cache and never writes it to argv, a launch script or a log.
 */
export async function mintObjectiveSessionChannel(
  objectiveRef: string,
  rawBody: unknown
): Promise<ControlPlaneLaunchChannel> {
  const body = asRecord(rawBody);
  const adapterKey = typeof body.adapterKey === 'string' ? body.adapterKey.trim() : '';
  if (!adapterKey) throw new ApiError(400, 'adapterKey is required');
  const optional = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null;

  const db = requireDatabaseClient();
  return db.transaction(async tx => {
    const { workspaceId, workspaceUserId, objectiveId } = await requireObjectivePermission({
      objectiveId: objectiveRef,
      permission: PERMISSIONS.SESSION_ATTACH,
      db: tx
    });
    const ctx = await buildWebappServiceContextForWorkspace(workspaceId, tx, workspaceUserId);
    return mintControlPlaneLaunchChannel({
      ctx,
      objectiveId,
      adapterKey,
      adapterVersion: optional(body.adapterVersion),
      executionRequestId: optional(body.executionRequestId),
      executionTargetId: optional(body.executionTargetId)
    });
  });
}
