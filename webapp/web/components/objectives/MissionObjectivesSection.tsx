import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  deriveObjectiveLifecycleView,
  objectiveHasInstructionText
} from '@overlord/automations/objective-manager';
import { GripVertical } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ExecutionRequestDto,
  MissionDetailDto,
  ObjectiveDto
} from '../../../shared/contract.ts';
import { objectiveMatchesFocus } from '../../lib/mission-panel-search.ts';
import {
  useEnqueueRunQueueEntry,
  useProjectRunQueues,
  useRemoveRunQueueEntry,
  useReorderFutureObjectives,
  useReorderRunQueue
} from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import { Button } from '../ui.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog.tsx';

import { DraftObjective } from './DraftObjective.tsx';
import { GhostObjective } from './GhostObjective.tsx';
import { ObjectiveCollapsibleItem } from './ObjectiveCollapsibleItem.tsx';

/**
 * A future objective wrapped for drag-and-drop reordering. Mirrors the kanban
 * board's `useSortable` setup: the grip handle owns the drag listeners so the
 * objective card's own inline editing stays fully interactive. The editable
 * card itself is the existing {@link DraftObjective}, which already renders the
 * collapsed future styling and the Promote action.
 */
function SortableFutureObjective({
  objective,
  siblings,
  executionRequests,
  focusObjectiveRef,
  allowParallelObjectives
}: {
  objective: ObjectiveDto;
  siblings: ObjectiveDto[];
  executionRequests: ExecutionRequestDto[];
  focusObjectiveRef: string | undefined;
  allowParallelObjectives: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: objective.id
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative flex items-stretch gap-2', isDragging && 'z-10 opacity-70')}
    >
      <button
        type="button"
        aria-label="Reorder future objective"
        className="flex w-5 shrink-0 cursor-grab touch-none items-center justify-center self-stretch rounded text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <ObjectiveFocusAnchor objective={objective} focusRef={focusObjectiveRef}>
          <DraftObjective
            objective={objective}
            siblings={siblings}
            executionRequests={executionRequests}
            allowParallelObjectives={allowParallelObjectives}
          />
        </ObjectiveFocusAnchor>
      </div>
    </div>
  );
}

/**
 * Scrolls the named objective into view and rings it when a deep link or feed
 * card opened this panel with `?objective=`.
 *
 * `radiusClass` must match the corner radius of the card being wrapped so the
 * ring hugs it instead of bowing away from its corners: {@link DraftObjective}
 * cards are `rounded-xl`, while the tighter {@link ObjectiveCollapsibleItem}
 * rows are `rounded-md`.
 */
function ObjectiveFocusAnchor({
  objective,
  focusRef,
  radiusClass = 'rounded-xl',
  children
}: {
  objective: ObjectiveDto;
  focusRef: string | undefined;
  radiusClass?: string;
  children: ReactNode;
}) {
  const focused = objectiveMatchesFocus({ objective, focusRef });
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focused) return;
    nodeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focused, objective.id]);

  return (
    <div
      ref={nodeRef}
      id={objective.displayId ? `objective-${objective.displayId}` : undefined}
      data-objective-ref={objective.displayId ?? objective.id}
      className={focused ? cn(radiusClass, 'ring-2 ring-ring/60') : undefined}
    >
      {children}
    </div>
  );
}

/**
 * The mission panel's objective list, split into three groups:
 *
 * 1. **Executed** (complete, then executing / pending delivery) — read-first
 *    {@link ObjectiveCollapsibleItem}s.
 * 2. **Editable** (launching, then draft / submitted) — full
 *    {@link DraftObjective} launch cards.
 * 3. **Future** — {@link DraftObjective} cards made sortable via dnd-kit so they
 *    can be reordered; the new order is persisted optimistically.
 *
 * Order inside the first two groups is the mission's history, not its queue:
 * `deriveObjectiveLifecycleView` sorts completed objectives by completion time,
 * executing ones by start time, and launching ones by launch time, all oldest
 * first. Only work that has not started yet is still ordered by position, which
 * is why drag-to-reorder applies to the future group alone.
 *
 * Plus the {@link GhostObjective} composer, which is *not* an objective: the
 * always-available empty field used to be a blank objective row written to the
 * database, which every other surface then had to filter out. It is now purely
 * client-side and only persists an objective once it has instruction text, so
 * "Add objective" and the next-up slot never create empty work.
 */
export function MissionObjectivesSection({
  mission,
  focusObjectiveRef
}: {
  mission: MissionDetailDto;
  /** Display id or UUID from `?objective=`, when a live surface named one. */
  focusObjectiveRef?: string;
}) {
  const reorder = useReorderFutureObjectives();
  const runQueues = useProjectRunQueues(mission.projectId);
  const reorderQueue = useReorderRunQueue(mission.projectId);
  const enqueue = useEnqueueRunQueueEntry(mission.projectId);
  const dequeue = useRemoveRunQueueEntry(mission.projectId);
  /** Whether the user asked for an extra (queued) composer via "+ Add objective". */
  const [extraSlotRequested, setExtraSlotRequested] = useState(false);

  const lifecycleView = useMemo(
    () =>
      deriveObjectiveLifecycleView(mission.objectives, {
        allowParallelObjectives: mission.allowParallelObjectives
      }),
    [mission.allowParallelObjectives, mission.objectives]
  );
  const objectives = lifecycleView.orderedObjectives;
  const executedObjectives = lifecycleView.executedObjectives;
  const editableObjectives = lifecycleView.editableObjectives;
  const futureObjectivesFromServer = lifecycleView.futureObjectives;

  // Locally-mirrored order for optimistic drag-and-drop. We resync from the
  // server whenever the *set* of future objective ids changes; updates that only
  // shuffle positions are ignored so a dragged item does not jump back before
  // our reorder lands.
  const [futureOrder, setFutureOrder] = useState<string[]>(() =>
    futureObjectivesFromServer.map(o => o.id)
  );
  const [queueBoundaryAction, setQueueBoundaryAction] = useState<
    | { kind: 'enqueue'; objective: ObjectiveDto; afterEntryId: string; queueId: string }
    | { kind: 'dequeue'; objective: ObjectiveDto; entryId: string }
    | null
  >(null);

  useEffect(() => {
    const incomingIds = futureObjectivesFromServer.map(o => o.id);
    setFutureOrder(previous => {
      const previousSet = new Set(previous);
      const incomingSet = new Set(incomingIds);
      const sameMembership =
        previous.length === incomingIds.length && previous.every(id => incomingSet.has(id));
      if (sameMembership) return previous;
      const kept = previous.filter(id => incomingSet.has(id));
      const additions = incomingIds.filter(id => !previousSet.has(id));
      return [...kept, ...additions];
    });
  }, [futureObjectivesFromServer]);

  const orderedFutureObjectives = useMemo(() => {
    const byId = new Map(futureObjectivesFromServer.map(o => [o.id, o]));
    return futureOrder.map(id => byId.get(id)).filter((o): o is ObjectiveDto => Boolean(o));
  }, [futureObjectivesFromServer, futureOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeObjective = futureObjectivesFromServer.find(
      objective => objective.id === active.id
    );
    const overObjective = futureObjectivesFromServer.find(objective => objective.id === over.id);
    if (!activeObjective || !overObjective) return;
    const activeEntry = activeObjective.queueEntry ?? null;
    const overEntry = overObjective.queueEntry ?? null;

    // Queue-to-queue drags use the authoritative queue ordering rather than the
    // legacy mission-only future-objective reorder surface. Cross-queue moves
    // are deliberately deferred to Phase 4.
    if (activeEntry && overEntry) {
      if (activeEntry.queueId !== overEntry.queueId) return;
      const queue = runQueues.data?.queues.find(item => item.id === activeEntry.queueId);
      if (
        !queue ||
        activeEntry.state === 'running' ||
        activeEntry.state === 'dispatched' ||
        overEntry.state === 'running' ||
        overEntry.state === 'dispatched'
      )
        return;
      const from = queue.entries.findIndex(entry => entry.id === activeEntry.id);
      const to = queue.entries.findIndex(entry => entry.id === overEntry.id);
      if (from < 0 || to < 0 || from === to) return;
      reorderQueue.mutate({
        queueId: queue.id,
        orderedEntryIds: arrayMove(
          queue.entries.map(entry => entry.id),
          from,
          to
        )
      });
      return;
    }
    if (activeEntry && !overEntry) {
      if (activeEntry.state === 'running' || activeEntry.state === 'dispatched') return;
      setQueueBoundaryAction({
        kind: 'dequeue',
        objective: activeObjective,
        entryId: activeEntry.id
      });
      return;
    }
    if (!activeEntry && overEntry) {
      if (overEntry.state === 'running' || overEntry.state === 'dispatched') return;
      setQueueBoundaryAction({
        kind: 'enqueue',
        objective: activeObjective,
        afterEntryId: overEntry.id,
        queueId: overEntry.queueId
      });
      return;
    }
    const oldIndex = futureOrder.indexOf(activeObjective.id);
    const newIndex = futureOrder.indexOf(overObjective.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const nextOrder = arrayMove(futureOrder, oldIndex, newIndex);
    setFutureOrder(nextOrder);
    reorder.mutate(
      { missionId: mission.id, orderedObjectiveIds: nextOrder },
      {
        onError: () => setFutureOrder(futureObjectivesFromServer.map(o => o.id))
      }
    );
  }

  // The next-up composer only appears when nothing occupies the editable slot.
  // A legacy blank draft row (written before the slot became client-only) still
  // renders as its own card, so we must not stack a ghost on top of it.
  const showNextUpGhost = editableObjectives.length === 0;
  // A second composer, queued behind the next-up objective, appears only when
  // the user explicitly asks for another slot.
  const showQueuedGhost = extraSlotRequested && !showNextUpGhost;
  const hasBlankSlot =
    showNextUpGhost ||
    showQueuedGhost ||
    [...editableObjectives, ...orderedFutureObjectives].some(
      objective => !objectiveHasInstructionText(objective)
    );

  return (
    <div className="space-y-3">
      {executedObjectives.length > 0 ? (
        <div className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)]">
          {executedObjectives.map((objective, index) => (
            <ObjectiveFocusAnchor
              key={objective.id}
              objective={objective}
              focusRef={focusObjectiveRef}
              radiusClass="rounded-md"
            >
              <ObjectiveCollapsibleItem
                objective={objective}
                index={index}
                defaultOpen={objectiveMatchesFocus({ objective, focusRef: focusObjectiveRef })}
              />
            </ObjectiveFocusAnchor>
          ))}
        </div>
      ) : null}

      <div className="space-y-3">
        {editableObjectives.map(objective => (
          <ObjectiveFocusAnchor
            key={objective.id}
            objective={objective}
            focusRef={focusObjectiveRef}
          >
            <DraftObjective
              objective={objective}
              siblings={objectives}
              executionRequests={mission.executionRequests}
              allowParallelObjectives={mission.allowParallelObjectives}
            />
          </ObjectiveFocusAnchor>
        ))}

        {showNextUpGhost ? (
          <GhostObjective
            missionId={mission.id}
            projectId={mission.projectId}
            autoFocus={extraSlotRequested}
            onMaterialized={() => setExtraSlotRequested(false)}
            onDismissEmpty={() => setExtraSlotRequested(false)}
          />
        ) : null}

        {orderedFutureObjectives.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedFutureObjectives.map(o => o.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3">
                {orderedFutureObjectives.map(objective => (
                  <SortableFutureObjective
                    key={objective.id}
                    objective={objective}
                    siblings={objectives}
                    executionRequests={mission.executionRequests}
                    focusObjectiveRef={focusObjectiveRef}
                    allowParallelObjectives={mission.allowParallelObjectives}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : null}

        {showQueuedGhost ? (
          <GhostObjective
            missionId={mission.id}
            projectId={mission.projectId}
            autoFocus
            onMaterialized={() => setExtraSlotRequested(false)}
            onDismissEmpty={() => setExtraSlotRequested(false)}
          />
        ) : null}

        <div>
          <Button
            variant="secondary"
            onClick={() => setExtraSlotRequested(true)}
            disabled={hasBlankSlot}
          >
            + Add objective
          </Button>
        </div>
      </div>
      <Dialog
        open={queueBoundaryAction !== null}
        onOpenChange={open => {
          if (!open) setQueueBoundaryAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {queueBoundaryAction?.kind === 'enqueue'
                ? 'Add to Run Queue?'
                : 'Remove from Run Queue?'}
            </DialogTitle>
            <DialogDescription>
              {queueBoundaryAction?.kind === 'enqueue'
                ? 'This objective will join the queue after the row you dropped it on.'
                : 'This objective will leave the queue and will not launch automatically.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setQueueBoundaryAction(null)}>
              Cancel
            </Button>
            <Button
              disabled={enqueue.isPending || dequeue.isPending}
              onClick={() => {
                if (!queueBoundaryAction) return;
                if (queueBoundaryAction.kind === 'enqueue') {
                  enqueue.mutate(
                    {
                      objectiveId: queueBoundaryAction.objective.id,
                      queueId: queueBoundaryAction.queueId,
                      afterEntryId: queueBoundaryAction.afterEntryId
                    },
                    { onSuccess: () => setQueueBoundaryAction(null) }
                  );
                } else {
                  dequeue.mutate(queueBoundaryAction.entryId, {
                    onSuccess: () => setQueueBoundaryAction(null)
                  });
                }
              }}
            >
              {queueBoundaryAction?.kind === 'enqueue' ? 'Add to queue' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
