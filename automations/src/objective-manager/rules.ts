export type ObjectiveLifecycleState =
  | 'future'
  | 'draft'
  | 'submitted'
  | 'launching'
  | 'executing'
  | 'pending_delivery'
  | 'complete';

export type ObjectiveLifecycleObjective = {
  id: string;
  position: number;
  state: ObjectiveLifecycleState | string;
  instructionText?: string;
  objective?: string;
  autoAdvance?: boolean;
  assignedAgent?: string | null;
  createdAt?: string;
  /** Logical project resource; null/blank inherits the mission's primary resource. */
  resourceKey?: string | null;
};

export type ObjectiveLifecycleOptions = {
  /** When true, multiple active objectives are allowed if their resource keys differ. */
  allowParallelObjectives?: boolean;
  /**
   * Project primary `resource_key`. Used to compare a null/blank objective key
   * against an explicit sibling key. Defaults to `'primary'`.
   */
  primaryResourceKey?: string;
};

export const DEFAULT_PRIMARY_RESOURCE_KEY = 'primary';

/**
 * Canonical checkout identity for sibling-lock comparison. Null/blank inherits
 * the project's primary resource.
 */
export function canonicalObjectiveResourceKey(
  resourceKey: string | null | undefined,
  primaryResourceKey: string = DEFAULT_PRIMARY_RESOURCE_KEY
): string {
  const trimmed = resourceKey?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : primaryResourceKey;
}

export function objectiveResourcesConflict({
  left,
  right,
  primaryResourceKey = DEFAULT_PRIMARY_RESOURCE_KEY
}: {
  left: string | null | undefined;
  right: string | null | undefined;
  primaryResourceKey?: string;
}): boolean {
  return (
    canonicalObjectiveResourceKey(left, primaryResourceKey) ===
    canonicalObjectiveResourceKey(right, primaryResourceKey)
  );
}

/**
 * Whether an already-active sibling should block launching this candidate.
 * Flag off → always block. Flag on → block only when the checkouts match.
 */
export function siblingBlocksParallelLaunch({
  allowParallelObjectives,
  candidateResourceKey,
  siblingResourceKey,
  primaryResourceKey = DEFAULT_PRIMARY_RESOURCE_KEY
}: {
  allowParallelObjectives: boolean;
  candidateResourceKey: string | null | undefined;
  siblingResourceKey: string | null | undefined;
  primaryResourceKey?: string;
}): boolean {
  if (!allowParallelObjectives) return true;
  return objectiveResourcesConflict({
    left: candidateResourceKey,
    right: siblingResourceKey,
    primaryResourceKey
  });
}

export type ObjectiveLifecycleViolation = {
  code:
    | 'multiple_drafts'
    | 'multiple_active_objectives'
    | 'duplicate_position'
    | 'blank_instruction_after_draft';
  objectiveIds: string[];
  message: string;
};

export type EnsureDraftSlotPlan =
  | {
      action: 'none';
      reason: 'draft_slot_filled' | 'next_up_still_launching' | 'no_future_objective';
    }
  | { action: 'promote_future'; objectiveId: string };

export type AutoAdvanceDecision =
  | { action: 'none'; reason: 'no_non_empty_draft' | 'human_only_mission' }
  | { action: 'await_approval'; objectiveId: string; reason: string }
  | { action: 'queue_launch'; objectiveId: string; idempotencyKey: string };

export type ObjectiveLifecycleView<TObjective extends ObjectiveLifecycleObjective> = {
  orderedObjectives: TObjective[];
  executedObjectives: TObjective[];
  editableObjectives: TObjective[];
  futureObjectives: TObjective[];
  activeObjective: TObjective | null;
  /** Every `executing` / `pending_delivery` objective, position order. */
  activeObjectives: TObjective[];
  nextUpObjective: TObjective | null;
  hasNonExecuted: boolean;
  violations: ObjectiveLifecycleViolation[];
};

export const OBJECTIVE_LIFECYCLE_STATES = [
  'future',
  'draft',
  'submitted',
  'launching',
  'executing',
  'pending_delivery',
  'complete'
] as const satisfies readonly ObjectiveLifecycleState[];

export const EDITABLE_NEXT_UP_OBJECTIVE_STATES = [
  'draft',
  'submitted',
  'launching'
] as const satisfies readonly ObjectiveLifecycleState[];

export const FUTURE_OBJECTIVE_STATES = [
  'future'
] as const satisfies readonly ObjectiveLifecycleState[];

export const ACTIVE_OBJECTIVE_STATES = [
  'executing',
  'pending_delivery'
] as const satisfies readonly ObjectiveLifecycleState[];

/** States that occupy the sibling-execution lock (includes pre-attach launching). */
export const PARALLEL_BLOCKING_OBJECTIVE_STATES = [
  'launching',
  'executing',
  'pending_delivery'
] as const satisfies readonly ObjectiveLifecycleState[];

export const LAUNCHABLE_OBJECTIVE_STATES = [
  'draft',
  'submitted',
  'launching'
] as const satisfies readonly ObjectiveLifecycleState[];

export const AUTO_ADVANCE_TOGGLE_OBJECTIVE_STATES = [
  'future',
  'draft',
  'submitted',
  'launching'
] as const satisfies readonly ObjectiveLifecycleState[];

const NON_EMPTY_INSTRUCTION_STATES = new Set([
  'submitted',
  'launching',
  'executing',
  'pending_delivery',
  'complete'
]);

function stateIn(
  state: string,
  states: readonly ObjectiveLifecycleState[]
): state is ObjectiveLifecycleState {
  return (states as readonly string[]).includes(state);
}

export function objectiveInstructionText(objective: ObjectiveLifecycleObjective): string {
  return objective.instructionText ?? objective.objective ?? '';
}

export function objectiveHasInstructionText(objective: ObjectiveLifecycleObjective): boolean {
  return objectiveInstructionText(objective).trim().length > 0;
}

export function isEditableNextUpObjective(objective: ObjectiveLifecycleObjective): boolean {
  return stateIn(objective.state, EDITABLE_NEXT_UP_OBJECTIVE_STATES);
}

export function isFutureObjective(objective: ObjectiveLifecycleObjective): boolean {
  return stateIn(objective.state, FUTURE_OBJECTIVE_STATES);
}

export function isActiveObjective(objective: ObjectiveLifecycleObjective): boolean {
  return stateIn(objective.state, ACTIVE_OBJECTIVE_STATES);
}

export function isLaunchableObjective(objective: ObjectiveLifecycleObjective): boolean {
  return stateIn(objective.state, LAUNCHABLE_OBJECTIVE_STATES);
}

export function canToggleObjectiveAutoAdvance(objective: ObjectiveLifecycleObjective): boolean {
  return stateIn(objective.state, AUTO_ADVANCE_TOGGLE_OBJECTIVE_STATES);
}

export function canEditObjectiveInstruction(objective: ObjectiveLifecycleObjective): boolean {
  return (
    isFutureObjective(objective) ||
    objective.state === 'draft' ||
    objective.state === 'submitted' ||
    objective.state === 'launching'
  );
}

/**
 * Whether an objective whose instruction text was just cleared should be
 * discarded rather than saved as a blank row.
 *
 * Blank objectives are not part of the model: the "empty field to type into" is
 * a client-only composer, so an unsaved-yet objective the user empties out is
 * simply not work and disappears. Only the editable states qualify — an
 * executing or complete objective is history and is never removed this way.
 *
 * `attachmentCount` is the escape hatch: an objective carrying attachments is
 * real work even with no text, so it is kept and the empty text is saved.
 *
 * Callers must only ask this when the *edit has finished* (blur, ⌘/Ctrl+Enter).
 * A debounced autosave firing mid-keystroke cannot be told apart from a user who
 * cleared the field to retype it, and would delete the card out from under them.
 */
export function shouldDiscardEmptiedObjective(
  objective: ObjectiveLifecycleObjective,
  { attachmentCount = 0 }: { attachmentCount?: number } = {}
): boolean {
  if (objectiveHasInstructionText(objective)) return false;
  if (attachmentCount > 0) return false;
  return isFutureObjective(objective) || objective.state === 'draft';
}

export function sortObjectivesByLifecycleOrder<TObjective extends ObjectiveLifecycleObjective>(
  objectives: readonly TObjective[]
): TObjective[] {
  return [...objectives].sort((a, b) => {
    const byPosition = a.position - b.position;
    if (byPosition !== 0) return byPosition;
    const byCreatedAt = (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
    if (byCreatedAt !== 0) return byCreatedAt;
    return a.id.localeCompare(b.id);
  });
}

export function validateObjectiveLifecycle(
  objectives: readonly ObjectiveLifecycleObjective[],
  options: ObjectiveLifecycleOptions = {}
): ObjectiveLifecycleViolation[] {
  const ordered = sortObjectivesByLifecycleOrder(objectives);
  const violations: ObjectiveLifecycleViolation[] = [];
  const primaryResourceKey = options.primaryResourceKey ?? DEFAULT_PRIMARY_RESOURCE_KEY;
  const allowParallel = options.allowParallelObjectives === true;

  const drafts = ordered.filter(o => o.state === 'draft');
  if (drafts.length > 1) {
    violations.push({
      code: 'multiple_drafts',
      objectiveIds: drafts.map(o => o.id),
      message: 'A mission may have at most one draft objective.'
    });
  }

  const active = ordered.filter(isActiveObjective);
  const conflictingActive = allowParallel
    ? active.filter((candidate, index) =>
        active.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            objectiveResourcesConflict({
              left: candidate.resourceKey,
              right: other.resourceKey,
              primaryResourceKey
            })
        )
      )
    : active;
  const uniqueConflicting = [...new Map(conflictingActive.map(item => [item.id, item])).values()];
  if (uniqueConflicting.length > 1) {
    violations.push({
      code: 'multiple_active_objectives',
      objectiveIds: uniqueConflicting.map(o => o.id),
      message: allowParallel
        ? 'A mission may not run two executing or pending-delivery objectives on the same resource.'
        : 'A mission may have at most one executing or pending-delivery objective.'
    });
  }

  const byPosition = new Map<number, ObjectiveLifecycleObjective[]>();
  for (const objective of ordered) {
    byPosition.set(objective.position, [...(byPosition.get(objective.position) ?? []), objective]);
  }
  for (const duplicates of byPosition.values()) {
    if (duplicates.length <= 1) continue;
    violations.push({
      code: 'duplicate_position',
      objectiveIds: duplicates.map(o => o.id),
      message: `Objectives share position ${duplicates[0]?.position ?? 'unknown'}.`
    });
  }

  const blankAfterDraft = ordered.filter(
    objective =>
      NON_EMPTY_INSTRUCTION_STATES.has(objective.state) && !objectiveHasInstructionText(objective)
  );
  if (blankAfterDraft.length > 0) {
    violations.push({
      code: 'blank_instruction_after_draft',
      objectiveIds: blankAfterDraft.map(o => o.id),
      message: 'Submitted, launching, active, and complete objectives require instruction text.'
    });
  }

  return violations;
}

export function deriveObjectiveLifecycleView<TObjective extends ObjectiveLifecycleObjective>(
  objectives: readonly TObjective[],
  options: ObjectiveLifecycleOptions = {}
): ObjectiveLifecycleView<TObjective> {
  const orderedObjectives = sortObjectivesByLifecycleOrder(objectives);
  const executedObjectives = orderedObjectives.filter(
    objective =>
      (isActiveObjective(objective) || objective.state === 'complete') &&
      objectiveHasInstructionText(objective)
  );
  const editableObjectives = orderedObjectives.filter(isEditableNextUpObjective);
  const futureObjectives = orderedObjectives.filter(isFutureObjective);
  const activeObjectives = orderedObjectives.filter(isActiveObjective);
  const activeObjective = activeObjectives[0] ?? null;
  const nextUpObjective = orderedObjectives.find(isEditableNextUpObjective) ?? null;

  return {
    orderedObjectives,
    executedObjectives,
    editableObjectives,
    futureObjectives,
    activeObjective,
    activeObjectives,
    nextUpObjective,
    hasNonExecuted: editableObjectives.length > 0 || futureObjectives.length > 0,
    violations: validateObjectiveLifecycle(orderedObjectives, options)
  };
}

/**
 * Plans the next-up slot refill after an objective leaves the queue.
 *
 * A mission's "empty slot to type into" is a **client-only** affordance (the
 * mission panel's ghost objective card), never a persisted blank objective: a
 * stored objective with no instruction text is indistinguishable from real work
 * to agents, counts, and auto-advance. So this planner only ever promotes an
 * already-authored future objective; when there is none it does nothing and the
 * UI renders its own unsaved composer.
 */
export function planEnsureDraftSlot(
  objectives: readonly ObjectiveLifecycleObjective[]
): EnsureDraftSlotPlan {
  const ordered = sortObjectivesByLifecycleOrder(objectives);
  if (ordered.some(objective => objective.state === 'draft')) {
    return { action: 'none', reason: 'draft_slot_filled' };
  }
  if (
    ordered.some(objective => objective.state === 'submitted' || objective.state === 'launching')
  ) {
    return { action: 'none', reason: 'next_up_still_launching' };
  }

  // Only an authored future objective refills the slot. A blank one is a legacy
  // row from when blank slots were persisted, not work to promote — matching the
  // `TRIM(instruction_text) <> ''` guard the backend and core refill paths use,
  // so the planner and the implementations cannot disagree.
  const nextFuture = ordered.find(
    objective => isFutureObjective(objective) && objectiveHasInstructionText(objective)
  );
  if (nextFuture) {
    return { action: 'promote_future', objectiveId: nextFuture.id };
  }

  return { action: 'none', reason: 'no_future_objective' };
}

export function decideAutoAdvanceAfterDelivery(
  objectives: readonly ObjectiveLifecycleObjective[],
  options: { humanOnly?: boolean; defaultApprovalReason?: string } = {}
): AutoAdvanceDecision {
  const nextDraft = sortObjectivesByLifecycleOrder(objectives).find(
    objective => objective.state === 'draft' && objectiveHasInstructionText(objective)
  );

  if (!nextDraft) {
    return { action: 'none', reason: 'no_non_empty_draft' };
  }
  if (options.humanOnly) {
    return { action: 'none', reason: 'human_only_mission' };
  }
  if (!nextDraft.autoAdvance) {
    return {
      action: 'await_approval',
      objectiveId: nextDraft.id,
      reason: options.defaultApprovalReason ?? 'Next objective is waiting for approval.'
    };
  }
  if (!nextDraft.assignedAgent) {
    return {
      action: 'await_approval',
      objectiveId: nextDraft.id,
      reason: 'Auto-advance requires an assigned agent.'
    };
  }

  return {
    action: 'queue_launch',
    objectiveId: nextDraft.id,
    idempotencyKey: `auto_advance:${nextDraft.id}`
  };
}
