import { siblingBlocksParallelLaunch } from '@overlord/automations/objective-manager';
import type { ExecutionRequestDto, ObjectiveDto, ObjectiveState } from '@overlord/contract';

const ACTIVE_SIBLING_STATES: ObjectiveState[] = ['launching', 'executing', 'pending_delivery'];
const ACTIVE_EXECUTION_REQUEST_STATES: ExecutionRequestDto['status'][] = [
  'queued',
  'claimed',
  'launching'
];

export type LaunchSiblingGuard = {
  /** Another objective is active on a resource this launch would collide with. */
  hasBlockingSibling: boolean;
  /** That sibling's id (for "Disconnect current job"), when there is one. */
  activeSiblingId: string | null;
  /** An execution request already delegated for this objective. */
  activeRequest: ExecutionRequestDto | null;
};

/**
 * The parallel-launch guard every Run surface applies (the draft card toolbar and the objective
 * detail): an already-active sibling, or a sibling's still-pending execution request, blocks a
 * direct launch unless the mission allows parallel objectives on separate resources.
 */
export function resolveLaunchSiblingGuard({
  objective,
  siblings,
  executionRequests,
  allowParallelObjectives,
  primaryResourceKey
}: {
  objective: ObjectiveDto;
  siblings: readonly ObjectiveDto[];
  executionRequests: readonly ExecutionRequestDto[];
  allowParallelObjectives: boolean;
  primaryResourceKey: string;
}): LaunchSiblingGuard {
  const activeSiblingObjective =
    siblings.find(o => o.id !== objective.id && ACTIVE_SIBLING_STATES.includes(o.state)) ?? null;
  const activeSiblingRequest =
    executionRequests.find(request => {
      if (request.objectiveId === objective.id) return false;
      if (!ACTIVE_EXECUTION_REQUEST_STATES.includes(request.status)) return false;
      const requestObjective = siblings.find(o => o.id === request.objectiveId);
      return Boolean(requestObjective && ACTIVE_SIBLING_STATES.includes(requestObjective.state));
    }) ?? null;
  const resolvedActiveSibling =
    activeSiblingObjective ??
    siblings.find(o => o.id === activeSiblingRequest?.objectiveId) ??
    null;
  const hasBlockingSibling = Boolean(
    resolvedActiveSibling &&
    siblingBlocksParallelLaunch({
      allowParallelObjectives,
      candidateResourceKey: objective.resourceKey,
      siblingResourceKey: resolvedActiveSibling.resourceKey,
      primaryResourceKey
    })
  );
  return {
    hasBlockingSibling,
    activeSiblingId: resolvedActiveSibling?.id ?? null,
    activeRequest: executionRequests.find(r => r.objectiveId === objective.id) ?? null
  };
}
