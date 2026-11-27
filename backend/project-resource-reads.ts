import { PERMISSIONS } from '@overlord/auth';
import type { ProjectResourceReadRequest, ProjectResourceReadResult } from '@overlord/contract';
import { projectResourceReadRequestSchema } from '@overlord/contract/api';

import type { ServiceContext } from '../packages/core/service/context.ts';
import { ServiceError } from '../packages/core/service/errors.ts';
import { targetMetadata } from '../packages/core/service/local-target/registry.ts';
import { normalizeRepositoryRelativePath } from '../packages/core/service/local-target/repository-paths.ts';
import { RunnerQueueProvider } from '../packages/core/service/local-target/runner-queue-provider.ts';
import {
  listProjectResourceReadCatalog,
  PROJECT_RESOURCE_READ_TIMEOUT_MS,
  resolveProjectResourceReadSource
} from '../packages/core/service/project-resource-read-bindings.ts';
import { repositoryReadLimiter } from '../packages/core/service/repository-reads.ts';

import { createCompletionListenerFactory } from './execution/local-target-completion-notify.ts';
import { buildWebappServiceContextForWorkspace } from './db.ts';
import { requireProjectPermission } from './rbac.ts';

async function projectReadContext(projectId: string): Promise<ServiceContext> {
  const { workspaceId, workspaceUserId } = await requireProjectPermission({
    projectId,
    permission: PERMISSIONS.PROJECT_READ
  });
  return buildWebappServiceContextForWorkspace(workspaceId, undefined, workspaceUserId);
}

export async function getProjectResourceReadCatalog(projectId: string) {
  return listProjectResourceReadCatalog(await projectReadContext(projectId), projectId);
}

function normalizePaths(request: ProjectResourceReadRequest): ProjectResourceReadRequest {
  function normalize(value: string | undefined) {
    const checked = normalizeRepositoryRelativePath(value);
    if (!checked.ok || (value !== undefined && checked.relativePath !== value)) {
      throw new ServiceError('Use an exact resource-relative path.', 'invalid_request', 400);
    }
    return checked.relativePath;
  }

  switch (request.operation) {
    case 'list_directory':
      return { ...request, relativePath: normalize(request.relativePath) };
    case 'read_file':
      if (!normalize(request.relativePath)) {
        throw new ServiceError('A file path is required.', 'invalid_request', 400);
      }
      return request;
    case 'diff':
      if (!normalize(request.relativePath)) {
        throw new ServiceError('A changed file path is required.', 'invalid_request', 400);
      }
      return request;
    case 'git_status':
      return request;
  }
}

const outcomeMessages = {
  target_offline: 'The owning runner is offline.',
  unsupported: 'Update the native runner to read this checkout.',
  timeout: 'The runner did not answer in time.',
  unavailable: 'The resource could not be read.',
  denied: 'The runner could not safely read this path.',
  binary: 'This file is binary or is not valid UTF-8.',
  oversized: 'This file exceeds the preview size limit.',
  not_found: 'This path is no longer available.',
  not_git_repository: 'The linked directory is not a Git worktree root.'
} satisfies Record<Exclude<ProjectResourceReadResult['outcome'], 'ok'>, string>;

function unavailable(outcome: keyof typeof outcomeMessages): ProjectResourceReadResult {
  return {
    outcome,
    message: outcomeMessages[outcome],
    observedAt: new Date().toISOString(),
    branch: null,
    truncated: false,
    data: null
  };
}

function sourceNotFound(): never {
  throw new ServiceError('Project resource source not found or changed.', 'not_found', 404);
}

export async function postProjectResourceRead({
  projectId,
  body,
  signal
}: {
  projectId: string;
  body: unknown;
  signal: AbortSignal;
}): Promise<ProjectResourceReadResult> {
  const ctx = await projectReadContext(projectId);
  const parsed = projectResourceReadRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ServiceError(
      'A valid project source and read operation are required.',
      'invalid_request',
      400
    );
  }
  const request = normalizePaths(parsed.data);
  const deadline = Date.now() + PROJECT_RESOURCE_READ_TIMEOUT_MS;
  const release = await repositoryReadLimiter.acquire(
    `user:${ctx.actorWorkspaceUserId}`,
    PROJECT_RESOURCE_READ_TIMEOUT_MS,
    signal
  );
  if (!release) return unavailable('timeout');
  try {
    const source = await resolveProjectResourceReadSource({ ctx, projectId, source: request });
    if (!source) sourceNotFound();
    const catalog = await listProjectResourceReadCatalog(ctx, projectId);
    const binding = catalog
      .find(resource => resource.id === source.resourceId)
      ?.sources.find(
        entry =>
          entry.sourceId === request.sourceId && entry.sourceRevision === request.sourceRevision
      );
    if (!binding) sourceNotFound();
    if (binding.availability !== 'ready') return unavailable(binding.availability);
    if (signal.aborted || Date.now() >= deadline) return unavailable('timeout');

    const provider = new RunnerQueueProvider(
      targetMetadata(
        { executionTargetId: request.executionTargetId, type: 'local', reachable: true },
        'runner_queue'
      ),
      {
        ctx,
        projectId,
        resourceKey: request.resourceKey,
        signal,
        readTimeoutMs: Math.max(1, deadline - Date.now()),
        createCompletionListener: createCompletionListenerFactory()
      }
    );
    // The runner receives the path only from the exact claim-time binding.
    const answer = await provider.readProjectResource({
      ...request,
      repoPath: '',
      resourceId: source.resourceId
    });
    const currentCtx = await projectReadContext(projectId);
    if (
      currentCtx.actorWorkspaceUserId !== ctx.actorWorkspaceUserId ||
      !(await resolveProjectResourceReadSource({ ctx: currentCtx, projectId, source: request }))
    ) {
      sourceNotFound();
    }
    if (!answer.ok) {
      switch (answer.code) {
        case 'NOT_GIT_REPOSITORY':
          return unavailable('not_git_repository');
        case 'LOCAL_TARGET_TIMEOUT':
          return unavailable('timeout');
        case 'LOCAL_TARGET_UNREACHABLE':
          return unavailable('target_offline');
        case 'RESOURCE_MISSING':
          return unavailable('not_found');
        case 'PERMISSION_DENIED':
          return unavailable('denied');
        default:
          return unavailable('unavailable');
      }
    }
    const { outcome, branch, observedAt, truncated, data } = answer.value;
    return {
      outcome,
      branch,
      observedAt,
      truncated,
      data,
      message: outcome === 'ok' ? null : outcomeMessages[outcome]
    };
  } finally {
    release();
  }
}
