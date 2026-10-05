// `POST /api/projects/:id/repository-reads` (contract v152, coo:1108.zg8m): the
// authenticated, mission-less repository read route. It authorizes
// `project:read` on the named project, then hands the request to the core
// gateway that the chat tool gateway also uses, which checks the caller's
// access to the execution target, resolves the registered resource binding,
// and queues the read for that target's runner.

import { PERMISSIONS } from '@overlord/auth';
import type { RepositoryReadResult } from '@overlord/contract';

import { ServiceError } from '../packages/core/service/errors.ts';
import {
  parseRepositoryReadRequest,
  performRepositoryRead
} from '../packages/core/service/repository-reads.ts';

import { createCompletionListenerFactory } from './execution/local-target-completion-notify.ts';
import { buildWebappServiceContextForWorkspace } from './db.ts';
import { requireProjectPermission } from './rbac.ts';

export async function postProjectRepositoryRead({
  projectId,
  body,
  signal
}: {
  projectId: string;
  body: unknown;
  /** Aborted when the client disconnects; stops waiting, never the target job. */
  signal?: AbortSignal;
}): Promise<RepositoryReadResult> {
  const request = parseRepositoryReadRequest(body);
  if (request.projectId !== projectId) {
    throw new ServiceError('projectId must match the project in the path.', 'invalid_request', 400);
  }
  const scope = await requireProjectPermission({
    projectId,
    permission: PERMISSIONS.PROJECT_READ
  });
  const ctx = await buildWebappServiceContextForWorkspace(
    scope.workspaceId,
    undefined,
    scope.workspaceUserId
  );
  return performRepositoryRead({
    ctx,
    request,
    // The route's concurrency scope is the caller; a chat run passes its run id.
    scopeKey: `user:${scope.workspaceUserId}`,
    signal: signal ?? null,
    queueOptions: { createCompletionListener: createCompletionListenerFactory() }
  });
}
