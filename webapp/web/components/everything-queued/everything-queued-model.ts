import type { ProjectDto, ProjectRunQueuesDto, RunQueueDto } from '../../../shared/contract.ts';

/** One project-scoped queue read included in the cross-project projection. */
export interface EverythingQueuedSource {
  project: Pick<ProjectDto, 'id' | 'name' | 'workspaceId'>;
  workspaceName: string;
  queues: ProjectRunQueuesDto | undefined;
  /** A failed per-project read must never reveal that project's queue contents. */
  readable: boolean;
}

export interface EverythingQueuedQueue {
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  queue: RunQueueDto;
  /** This projection deliberately has no queue controls. */
  canMutate: false;
}

/**
 * Flattens independently authorized project queue reads without creating a
 * cross-project order. Each queue retains its project's existing order and
 * entries retain their queue-local sequence.
 */
export function buildEverythingQueuedProjection(
  sources: EverythingQueuedSource[]
): EverythingQueuedQueue[] {
  return sources.flatMap(source => {
    if (!source.readable || !source.queues) return [];
    return source.queues.queues
      .filter(queue => queue.entries.length > 0)
      .map(queue => ({
        projectId: source.project.id,
        projectName: source.project.name,
        workspaceId: source.project.workspaceId,
        workspaceName: source.workspaceName,
        queue,
        canMutate: false as const
      }));
  });
}
