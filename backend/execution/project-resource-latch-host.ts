import { PERMISSIONS } from '@overlord/auth';
import { updateProjectResourceLatchHostBodySchema } from '@overlord/contract/api';

import { setProjectResourceLatchHost } from '../../packages/core/service/project-resource-latch-host.ts';
import { buildWebappServiceContextForWorkspace } from '../db.ts';
import { ApiError } from '../errors.ts';
import { requireProjectPermission } from '../rbac.ts';

export async function updateProjectResourceLatchHost({
  projectId,
  resourceId,
  sourceId,
  body,
  signal
}: {
  projectId: string;
  resourceId: string;
  sourceId: string;
  body: unknown;
  signal?: AbortSignal;
}): Promise<{ ok: true }> {
  const scope = await requireProjectPermission({
    projectId,
    permission: PERMISSIONS.PROJECT_UPDATE
  });
  const parsed = updateProjectResourceLatchHostBodySchema.safeParse(body);
  if (!parsed.success)
    throw new ApiError(400, 'Provide a source revision and a Latch host public key or null.');
  const ctx = await buildWebappServiceContextForWorkspace(
    scope.workspaceId,
    undefined,
    scope.workspaceUserId
  );
  return setProjectResourceLatchHost({
    ctx,
    projectId,
    resourceId,
    sourceId,
    body: parsed.data,
    signal
  });
}
