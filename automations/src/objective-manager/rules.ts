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
  /** When the objective first entered `launching`; null until launched. */
  launchedAt?: string | null;
  /** When the objective first entered `executing`; null until started. */
  startedAt?: string | null;
  /** When the objective reached `complete`; null until then. */
  completedAt?: string | null;
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
 * Flag off → always block. Flag on → never block.
 *
 * Same-resource pairs used to be blocked here because two objectives would have
 * shared one dirty checkout. They no longer are: the Runner Layer isolates a
 * concurrently launched objective onto its own branch and worktree when the
 * mission uses worktrees, and a mission that runs without worktrees has exactly
 * one checkout by construction and deliberately shares it. File attribution comes
 * from each explicitly bound objective/session ledger, never a checkout-wide scan.
 * The resource keys are still accepted so call sites read explicitly, and
 * `objectiveResourcesConflict` still answers "same checkout?" for the callers
 * that need it.
 */
export function siblingBlocksParallelLaunch({
  allowParallelObjectives
}: {
  allowParallelObjectives: boolean;
  candidateResourceKey?: string | null;
  siblingResourceKey?: string | null;
  primaryResourceKey?: string;
}): boolean {
  return !allowParallelObjectives;
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

export type RunQueuePlannerEntry = {
  id: string;
  queueId: string;
  objectiveId: string;
  position: number;
  state: 'waiting' | 'blocked' | 'dispatched' | 'running';
  attemptCount: number;
  /**
   * What consumed the previous attempts, so the block raised at the ceiling
   * names the real cause: a dispatch that threw before a request existed
   * (`dispatch_failed`) or a request that died before the agent attached
   * (`request_failed`). Defaults to `dispatch_failed`.
   */
  failureKind?: 'dispatch_failed' | 'request_failed';
};
export type RunQueuePlannerObjective = {
  id: string;
  missionId: string;
  state: ObjectiveLifecycleState | string;
  instructionText: string;
  assignedAgent?: string | null;
  resourceConnected?: boolean;
  deleted?: boolean;
};
export type RunQueuePlannerMission = {
  /** `missions.allow_parallel_objectives`. */
  allowParallelObjectives: boolean;
  /**
   * Objectives holding this mission's sibling lock at snapshot time, by the
   * same predicate the direct-launch path uses. A candidate is "mission busy"
   * when a lock holder other than itself is present — an objective never waits
   * on its own launch.
   */
  busyObjectiveIds?: readonly string[];
};
export type RunQueueWaitingReason = 'mission_busy' | 'resource_disconnected' | 'retry_pending';
export type RunQueueBlockedReason =
  | 'no_instruction'
  | 'no_agent'
  | 'dispatch_failed'
  | 'request_failed';
export type RunQueueDispatchAction =
  | { action: 'drop'; entryId: string; reason: 'objective_gone' }
  | {
      action: 'wait';
      entryId: string;
      reason: RunQueueWaitingReason;
      waitingOnObjectiveId?: string;
    }
  | { action: 'block'; entryId: string; reason: RunQueueBlockedReason }
  | { action: 'mark_running'; entryId: string }
  | {
      action: 'dispatch';
      entryId: string;
      objectiveId: string;
      promoteFutureToDraft: boolean;
      idempotencyKey: string;
    };

/**
 * Pure, target-neutral planner.
 *
 * Two rules carry the weight here:
 *
 * 1. **Every non-in-flight entry is re-evaluated, `blocked` included.** `wait`
 *    is a transient condition that clears on its own (a sibling finishing, a
 *    device reconnecting); `block` needs a human (no agent, blank instruction,
 *    attempts exhausted). Neither is terminal for the planner: a blocked entry
 *    whose cause is gone is simply dispatched on the next tick, and one whose
 *    cause remains is re-held with the same reason. Nothing but a human used to
 *    release a hold, which turned "your sibling is still running" into a
 *    permanent park.
 * 2. **A serial mission is claimed at most once per tick.** The caller's busy
 *    snapshot is taken before any action is applied, so without claims two
 *    queues sharing one `allowParallelObjectives = false` mission would both see
 *    it idle and both dispatch. The lower-positioned queue wins the mission and
 *    the other queue's head waits on it, naming the objective it is queued
 *    behind. Parallel missions are never claimed and flow independently.
 *
 * Held entries stay visible and do not block later work in their own queue.
 */
export function planRunQueueDispatch(input: {
  queues: readonly { id: string; paused: boolean; position?: number }[];
  entries: readonly RunQueuePlannerEntry[];
  objectives: Readonly<Record<string, RunQueuePlannerObjective | undefined>>;
  missions?: Readonly<Record<string, RunQueuePlannerMission | undefined>>;
  maxDispatchAttempts?: number;
}): RunQueueDispatchAction[] {
  const actions: RunQueueDispatchAction[] = [];
  const maxAttempts = input.maxDispatchAttempts ?? 3;
  /** Serial missions already spoken for this tick, mapped to the winning objective. */
  const claimedMissions = new Map<string, string>();
  const orderedQueues = [...input.queues].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id)
  );
  for (const queue of orderedQueues) {
    if (queue.paused) continue;
    const entries = input.entries.filter(entry => entry.queueId === queue.id);
    if (entries.some(entry => entry.state === 'dispatched' || entry.state === 'running')) continue;
    for (const entry of entries
      .filter(entry => entry.state === 'waiting' || entry.state === 'blocked')
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
      const objective = input.objectives[entry.objectiveId];
      if (!objective || objective.deleted || objective.state === 'complete') {
        actions.push({ action: 'drop', entryId: entry.id, reason: 'objective_gone' });
        continue;
      }
      // Already running — by a direct Run, or by this dispatcher on an earlier
      // tick. Reflect that and stop; none of the launch preconditions below
      // apply to work that has already started.
      if (objective.state === 'executing' || objective.state === 'pending_delivery') {
        actions.push({ action: 'mark_running', entryId: entry.id });
        break;
      }
      if (!objective.instructionText.trim()) {
        actions.push({ action: 'block', entryId: entry.id, reason: 'no_instruction' });
        continue;
      }
      // `undefined` means the caller did not supply the field; only an
      // explicitly blank/null agent is a block.
      if (objective.assignedAgent !== undefined && !objective.assignedAgent?.trim()) {
        actions.push({ action: 'block', entryId: entry.id, reason: 'no_agent' });
        continue;
      }
      const mission = input.missions?.[objective.missionId];
      const allowParallel = mission?.allowParallelObjectives === true;
      const blockingSibling = allowParallel
        ? undefined
        : (claimedMissions.get(objective.missionId) ??
          mission?.busyObjectiveIds?.find(id => id !== objective.id));
      if (blockingSibling) {
        actions.push({
          action: 'wait',
          entryId: entry.id,
          reason: 'mission_busy',
          waitingOnObjectiveId: blockingSibling
        });
        continue;
      }
      if (objective.resourceConnected === false) {
        actions.push({ action: 'wait', entryId: entry.id, reason: 'resource_disconnected' });
        continue;
      }
      if (entry.attemptCount >= maxAttempts) {
        actions.push({
          action: 'block',
          entryId: entry.id,
          reason: entry.failureKind ?? 'dispatch_failed'
        });
        continue;
      }
      actions.push({
        action: 'dispatch',
        entryId: entry.id,
        objectiveId: entry.objectiveId,
        promoteFutureToDraft: objective.state === 'future',
        idempotencyKey: `run_queue:${entry.id}:attempt:${entry.attemptCount + 1}`
      });
      if (!allowParallel) claimedMissions.set(objective.missionId, objective.id);
      break;
    }
  }
  return actions;
}

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

/**
 * Comparator over a lifecycle timestamp, oldest first.
 *
 * A missing timestamp means the moment was never recorded — a row written
 * before the columns existed, or a state reached by a path that does not stamp
 * one. Those sort *last* within their group and fall back to the position order
 * so the list stays stable and deterministic rather than jumping around.
 */
function byLifecycleMoment<TObjective extends ObjectiveLifecycleObjective>(
  moment: (objective: TObjective) => string | null | undefined
) {
  return (a: TObjective, b: TObjective): number => {
    const left = moment(a) ?? '';
    const right = moment(b) ?? '';
    if (left === right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return left.localeCompare(right);
  };
}

/**
 * Sorts one lifecycle group by when it entered that state, oldest first.
 *
 * `objectives` must already be in position order: the sort is stable, so
 * anything without a recorded moment keeps the position order it arrived with.
 */
function sortByLifecycleMoment<TObjective extends ObjectiveLifecycleObjective>(
  objectives: readonly TObjective[],
  moment: (objective: TObjective) => string | null | undefined
): TObjective[] {
  return [...objectives].sort(byLifecycleMoment(moment));
}

/**
 * The order objectives are shown in on a mission, as one flat list.
 *
 * Queue position stops being the whole story once objectives can run out of
 * order (parallel objectives, run queues, ad-hoc launches). What a reader wants
 * instead is the mission's history followed by its plan:
 *
 * 1. **complete** — oldest completion first, so the list reads as a timeline.
 * 2. **executing / pending_delivery** — oldest start first.
 * 3. **launching** — oldest launch first.
 * 4. **draft / submitted**, then **future** — still the authored queue order,
 *    which is the only order that means anything for work that has not started.
 *
 * Each group is sorted by its own moment; position remains the tiebreaker
 * everywhere, so a mission whose objectives were never timestamped renders
 * exactly as it did before.
 */
export function sortObjectivesForMissionDisplay<TObjective extends ObjectiveLifecycleObjective>(
  objectives: readonly TObjective[]
): TObjective[] {
  const ordered = sortObjectivesByLifecycleOrder(objectives);
  return [
    ...sortByLifecycleMoment(
      ordered.filter(objective => objective.state === 'complete'),
      objective => objective.completedAt
    ),
    ...sortByLifecycleMoment(ordered.filter(isActiveObjective), objective => objective.startedAt),
    ...sortByLifecycleMoment(
      ordered.filter(objective => objective.state === 'launching'),
      objective => objective.launchedAt
    ),
    ...ordered.filter(objective => objective.state === 'draft' || objective.state === 'submitted'),
    ...ordered.filter(isFutureObjective)
  ];
}

export function validateObjectiveLifecycle(
  objectives: readonly ObjectiveLifecycleObjective[],
  options: ObjectiveLifecycleOptions = {}
): ObjectiveLifecycleViolation[] {
  const ordered = sortObjectivesByLifecycleOrder(objectives);
  const violations: ObjectiveLifecycleViolation[] = [];
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
  // With parallel objectives opted in, several actives are legal on any resource:
  // same-resource pairs are separated by per-objective worktree isolation (or run
  // in the mission's single shared checkout when worktrees are off).
  const conflictingActive = allowParallel ? [] : active;
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
  // One display order, then filtered into the render groups. The groups are
  // contiguous slices of it, so the UI stacking them top to bottom reproduces
  // `orderedObjectives` exactly.
  const orderedObjectives = sortObjectivesForMissionDisplay(objectives);
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
