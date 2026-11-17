import type { MissionDetailDto, ObjectiveDto } from '@overlord/contract';

import { objectiveResourceConnection } from '../../lib/project-resources.ts';
import {
  useEnqueueRunQueueEntry,
  useLaunchObjective,
  useProjectExecutionTarget,
  useProjectResources
} from '../../lib/queries.ts';

import { type AgentModelSelection, MANUAL_AGENT_KEY } from './AgentModelSelector.tsx';
import { resolveLaunchSiblingGuard } from './launch-sibling-guard.ts';

export type ObjectiveQuickRun = {
  /** "Run", or "Run after current work" when an active sibling blocks a direct launch. */
  label: string;
  /** Why Run cannot start now, or null when it can. */
  disabledReason: string | null;
  pending: boolean;
  run: () => void;
};

/**
 * Run from the objective row menu (coo:1289): the split Run button's primary action without its
 * split. It launches with the row's agent/model selection on the project's default execution
 * target. When another objective already works the mission and parallel launch is not allowed,
 * it adds this objective to the mission's Run Queue instead — the safe choice of the Run
 * button's confirmation, which a menu item cannot show.
 */
export function useObjectiveQuickRun({
  objective,
  mission,
  selection,
  selectionLoaded,
  onError
}: {
  objective: ObjectiveDto;
  mission: MissionDetailDto | null;
  selection: AgentModelSelection;
  selectionLoaded: boolean;
  /** Reports a launch or queue failure, and null when a new attempt starts. */
  onError?: (message: string | null) => void;
}): ObjectiveQuickRun {
  const launch = useLaunchObjective();
  const enqueue = useEnqueueRunQueueEntry(objective.projectId);
  const resourcesQ = useProjectResources(objective.projectId);
  const executionTargetQ = useProjectExecutionTarget(objective.projectId);
  const setError = (message: string | null) => onError?.(message);

  const resources = resourcesQ.data ?? [];
  const connection = objectiveResourceConnection({
    resources,
    resourceKey: objective.resourceKey,
    executionTargetId: executionTargetQ.data?.selectedExecutionTargetId ?? null
  });
  const guard = mission
    ? resolveLaunchSiblingGuard({
        objective,
        siblings: mission.objectives,
        executionRequests: mission.executionRequests,
        allowParallelObjectives: mission.allowParallelObjectives,
        primaryResourceKey: resources.find(r => r.isPrimary)?.resourceKey ?? 'primary'
      })
    : null;
  const queueBehind = guard?.hasBlockingSibling ?? false;
  const pending = launch.isPending || enqueue.isPending;

  const disabledReason =
    objective.instructionText.trim().length === 0
      ? 'Write an instruction before running.'
      : guard?.activeRequest
        ? 'Already launching.'
        : !selectionLoaded
          ? 'Loading your agent selection.'
          : selection.agent === MANUAL_AGENT_KEY
            ? 'Choose an agent to run this objective.'
            : !connection.connected
              ? connection.message
              : queueBehind && objective.queueEntry
                ? 'Already in the Run Queue.'
                : pending
                  ? 'Starting…'
                  : null;

  function run() {
    if (disabledReason) return;
    setError(null);
    if (queueBehind) {
      enqueue.mutate(
        { objectiveId: objective.id },
        {
          onError: err =>
            setError(err instanceof Error ? err.message : 'Failed to add to the Run Queue')
        }
      );
      return;
    }
    launch.mutate(
      {
        id: objective.id,
        body: {
          agent: selection.agent,
          model: selection.model,
          reasoningEffort: selection.reasoningEffort
        }
      },
      {
        onError: err => setError(err instanceof Error ? err.message : 'Failed to launch execution')
      }
    );
  }

  return {
    label: queueBehind ? 'Run after current work' : 'Run',
    disabledReason,
    pending,
    run
  };
}
