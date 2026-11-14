import type { Automation } from '../types.js';

import {
  type AutoAdvanceDecision,
  decideAutoAdvanceAfterDelivery,
  deriveObjectiveLifecycleView,
  type ObjectiveLifecycleObjective,
  type ObjectiveLifecycleOptions,
  type ObjectiveLifecycleViolation
} from './rules.js';

export type {
  AutoAdvanceDecision,
  ObjectiveLifecycleObjective,
  ObjectiveLifecycleOptions,
  ObjectiveLifecycleState,
  ObjectiveLifecycleView,
  ObjectiveLifecycleViolation,
  RunQueueBlockedReason,
  RunQueueDispatchAction,
  RunQueuePlannerEntry,
  RunQueuePlannerMission,
  RunQueuePlannerObjective,
  RunQueueWaitingReason
} from './rules.js';
export {
  ACTIVE_OBJECTIVE_STATES,
  canonicalObjectiveResourceKey,
  decideAutoAdvanceAfterDelivery,
  DEFAULT_PRIMARY_RESOURCE_KEY,
  deriveObjectiveLifecycleView,
  EDITABLE_NEXT_UP_OBJECTIVE_STATES,
  firstDraft,
  isActiveObjective,
  isEditableNextUpObjective,
  isQueuedObjective,
  LAUNCHABLE_OBJECTIVE_STATES,
  nextUpDraft,
  objectiveHasInstructionText,
  objectiveInstructionText,
  objectiveResourcesConflict,
  PARALLEL_BLOCKING_OBJECTIVE_STATES,
  planRunQueueDispatch,
  QUEUED_OBJECTIVE_STATES,
  queueHeadObjective,
  shouldDiscardEmptiedObjective,
  siblingBlocksParallelLaunch,
  sortObjectivesByLifecycleOrder,
  sortObjectivesForMissionDisplay,
  validateObjectiveLifecycle
} from './rules.js';

export type ManageObjectiveLifecycleInput = {
  objectives: ObjectiveLifecycleObjective[];
  mission?: {
    humanOnly?: boolean;
    allowParallelObjectives?: boolean;
    primaryResourceKey?: string;
  };
  planAutoAdvance?: boolean;
};

export type ManageObjectiveLifecycleOutput = {
  orderedObjectiveIds: string[];
  executedObjectiveIds: string[];
  launchingObjectiveIds: string[];
  queuedObjectiveIds: string[];
  activeObjectiveId: string | null;
  nextUpObjectiveId: string | null;
  hasNonExecuted: boolean;
  violations: ObjectiveLifecycleViolation[];
  autoAdvanceDecision: AutoAdvanceDecision | null;
};

export function manageObjectiveLifecycle(
  input: ManageObjectiveLifecycleInput
): ManageObjectiveLifecycleOutput {
  const options: ObjectiveLifecycleOptions = {};
  if (input.mission?.allowParallelObjectives !== undefined) {
    options.allowParallelObjectives = input.mission.allowParallelObjectives;
  }
  if (input.mission?.primaryResourceKey !== undefined) {
    options.primaryResourceKey = input.mission.primaryResourceKey;
  }
  const view = deriveObjectiveLifecycleView(input.objectives, options);
  const autoAdvanceOptions =
    input.mission?.humanOnly === undefined ? {} : { humanOnly: input.mission.humanOnly };

  return {
    orderedObjectiveIds: view.orderedObjectives.map(objective => objective.id),
    executedObjectiveIds: view.executedObjectives.map(objective => objective.id),
    launchingObjectiveIds: view.launchingObjectives.map(objective => objective.id),
    queuedObjectiveIds: view.queuedObjectives.map(objective => objective.id),
    activeObjectiveId: view.activeObjective?.id ?? null,
    nextUpObjectiveId: view.nextUpObjective?.id ?? null,
    hasNonExecuted: view.hasNonExecuted,
    violations: view.violations,
    autoAdvanceDecision: input.planAutoAdvance
      ? decideAutoAdvanceAfterDelivery(input.objectives, autoAdvanceOptions)
      : null
  };
}

export const manageObjectiveLifecycleTool: Automation<
  ManageObjectiveLifecycleInput,
  ManageObjectiveLifecycleOutput
> = {
  id: 'manage-objective-lifecycle',
  label: 'Manage objective lifecycle',
  description:
    'Applies the objective lifecycle ruleset to classify objectives, validate invariants, and plan auto-advance actions without writing persistence.',
  run: async ({ input }) => manageObjectiveLifecycle(input)
};
