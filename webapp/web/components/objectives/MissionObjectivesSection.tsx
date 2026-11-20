import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { deriveObjectiveLifecycleView } from '@overlord/automations/objective-manager';
import type { MissionDetailDto, ObjectiveDto } from '@overlord/contract';
import { useEffect, useMemo, useState } from 'react';

import { useDismissedAgentRequests } from '../../lib/dismissed-agent-requests.ts';
import { useMissionOpenAgentRequests, useReorderObjectives } from '../../lib/queries.ts';

import {
  moveObjectiveIdBy,
  OBJECTIVE_ROW_DND_MODIFIERS,
  suppressNextClick,
  useObjectiveRowSensors
} from './objective-row-dnd.ts';
import { isInFlightObjective, ObjectiveRow, type ObjectiveRowProps } from './ObjectiveRow.tsx';
import { mergeQueuedObjectiveOrder } from './queued-objective-order.ts';

type RowCallbacks = Pick<ObjectiveRowProps, 'onOpen' | 'onEditTitle' | 'onDeleted'>;

export type MissionObjectivesSectionProps = {
  mission: MissionDetailDto;
  /**
   * The objective the composer holds — while it is committing and while it is shown saved in the
   * composer (coo:1289). It is hidden from every group until the composer releases it, so a
   * realtime refetch never shows it twice.
   */
  committingObjectiveId?: string | null;
  /** The objective whose detail is open; its row carries a subtle wash. */
  openObjectiveId?: string | null;
  /** Open an objective's detail. `trigger` is the row button, for focus return on close. */
  onOpenObjective: RowCallbacks['onOpen'];
  /** Open the detail with the title in edit mode ("Edit title" in the row menu). */
  onEditObjectiveTitle?: RowCallbacks['onEditTitle'];
  /** An objective was deleted from its row menu; close its detail if it is open. */
  onObjectiveDeleted?: RowCallbacks['onDeleted'];
  /**
   * The order rows are displayed in, reported whenever it changes (including optimistic
   * reorders), so the detail's "n of m" and previous/next follow the list.
   */
  onRowOrderChange?: (orderedObjectiveIds: string[]) => void;
};

/**
 * The mission panel's compact objective list (plan §7): one {@link ObjectiveRow} per objective,
 * in every state.
 *
 * Order is unchanged from the lifecycle view: executed objectives in history order, then
 * launching ones, then not-started (draft and submitted) objectives in queue order. Only the
 * not-started group is sortable; it reorders by press-and-hold drag or the row menu's Move up /
 * Move down. Every reorder sends the complete not-started set, is applied optimistically and
 * rolls back when the server rejects it (including a 409 for a stale set).
 *
 * Blocked rows come from the shared mission-wide open-request collection; a failed read keeps
 * the last successful data, so a transient failure never clears a blocked tint.
 */
export function MissionObjectivesSection({
  mission,
  committingObjectiveId = null,
  openObjectiveId = null,
  onOpenObjective,
  onEditObjectiveTitle,
  onObjectiveDeleted,
  onRowOrderChange
}: MissionObjectivesSectionProps) {
  const reorder = useReorderObjectives();
  const openRequests = useMissionOpenAgentRequests(mission.id);
  const blockingByObjective = openRequests.blockingByObjective;
  const { dismissedIds } = useDismissedAgentRequests({
    workspaceId: mission.workspaceId,
    missionId: mission.id
  });

  const visibleObjectives = useMemo(
    () =>
      committingObjectiveId === null
        ? mission.objectives
        : mission.objectives.filter(objective => objective.id !== committingObjectiveId),
    [committingObjectiveId, mission.objectives]
  );
  const lifecycleView = useMemo(
    () =>
      deriveObjectiveLifecycleView(visibleObjectives, {
        allowParallelObjectives: mission.allowParallelObjectives
      }),
    [mission.allowParallelObjectives, visibleObjectives]
  );
  const executedObjectives = lifecycleView.executedObjectives;
  const launchingObjectives = lifecycleView.launchingObjectives;
  const queuedObjectivesFromServer = lifecycleView.queuedObjectives;

  // Locally-mirrored order for optimistic reordering. While our own reorder is in flight the
  // local order wins, so a moved row does not jump back before it lands. Otherwise the server
  // order wins, because the Run Queue also reorders objectives (queue reorder, dequeue-to-end).
  const [queueOrder, setQueueOrder] = useState<string[]>(() =>
    queuedObjectivesFromServer.map(o => o.id)
  );
  useEffect(() => {
    const incomingIds = queuedObjectivesFromServer.map(o => o.id);
    setQueueOrder(previous =>
      mergeQueuedObjectiveOrder({
        previousIds: previous,
        incomingIds,
        reorderPending: reorder.isPending
      })
    );
  }, [queuedObjectivesFromServer, reorder.isPending]);

  const orderedQueuedObjectives = useMemo(() => {
    const byId = new Map(queuedObjectivesFromServer.map(o => [o.id, o]));
    return queueOrder.map(id => byId.get(id)).filter((o): o is ObjectiveDto => Boolean(o));
  }, [queuedObjectivesFromServer, queueOrder]);

  const rowOrderKey = [
    ...executedObjectives.map(o => o.id),
    ...launchingObjectives.map(o => o.id),
    ...orderedQueuedObjectives.map(o => o.id)
  ].join(',');
  useEffect(() => {
    onRowOrderChange?.(rowOrderKey.length > 0 ? rowOrderKey.split(',') : []);
  }, [onRowOrderChange, rowOrderKey]);

  const sensors = useObjectiveRowSensors(orderedQueuedObjectives.length > 1);
  /** A row is being dragged: no row opens its hover line, and an open one closes. */
  const [dragging, setDragging] = useState(false);

  /** Persist a new not-started order: optimistic, complete set, rollback on rejection. */
  function commitOrder(nextOrder: string[]) {
    // The request must name the complete not-started set; a partial local view (a row that
    // arrived but has not merged yet) would be rejected, so send nothing until it is whole.
    if (queueOrder.length !== queuedObjectivesFromServer.length) return;
    setQueueOrder(nextOrder);
    reorder.mutate(
      { missionId: mission.id, orderedObjectiveIds: nextOrder },
      {
        // A rejected reorder (including a 409 for a stale set) rolls the cache back; the
        // settled invalidation refetches the current order.
        onError: () => setQueueOrder(queuedObjectivesFromServer.map(o => o.id))
      }
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(false);
    // The pointer release after a drag fires a click on the row button; never open on drop.
    suppressNextClick();
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = queueOrder.indexOf(String(active.id));
    const newIndex = queueOrder.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    commitOrder(arrayMove(queueOrder, oldIndex, newIndex));
  }

  function moveBy(objectiveId: string, delta: -1 | 1) {
    const next = moveObjectiveIdBy(queueOrder, objectiveId, delta);
    if (next) commitOrder(next);
  }

  const rowCallbacks = {
    mission,
    onOpen: onOpenObjective,
    onEditTitle: onEditObjectiveTitle,
    onDeleted: onObjectiveDeleted
  };
  const isBlocked = (objective: ObjectiveDto) =>
    isInFlightObjective(objective.state) &&
    (blockingByObjective.get(objective.id) ?? []).some(request => !dismissedIds.has(request.id));

  const fixedRows = [...executedObjectives, ...launchingObjectives];
  if (fixedRows.length === 0 && orderedQueuedObjectives.length === 0) {
    // The mission's only objective is still in the composer: no "No objectives yet" above it.
    if (committingObjectiveId !== null) return null;
    return <p className="px-3 py-3 text-sm text-(--color-ink-dim)">No objectives yet</p>;
  }

  return (
    // The container sizes the rows' hover line, whose labels collapse at narrow panel widths.
    <div className="@container/objective-list min-w-0" data-mission-objective-list="">
      {fixedRows.length > 0 ? (
        <ol aria-label="Started objectives" className="min-w-0">
          {fixedRows.map(objective => (
            <ObjectiveRow
              key={objective.id}
              objective={objective}
              blocked={isBlocked(objective)}
              selected={objective.id === openObjectiveId}
              {...rowCallbacks}
            />
          ))}
        </ol>
      ) : null}

      {orderedQueuedObjectives.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={OBJECTIVE_ROW_DND_MODIFIERS}
          onDragStart={() => setDragging(true)}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setDragging(false);
            suppressNextClick();
          }}
        >
          <SortableContext
            items={orderedQueuedObjectives.map(o => o.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol aria-label="Objectives not started" className="relative min-w-0">
              {orderedQueuedObjectives.map((objective, index) => (
                <SortableObjectiveRow
                  key={objective.id}
                  objective={objective}
                  selected={objective.id === openObjectiveId}
                  listDragging={dragging}
                  onMoveUp={index > 0 ? () => moveBy(objective.id, -1) : undefined}
                  onMoveDown={
                    index < orderedQueuedObjectives.length - 1
                      ? () => moveBy(objective.id, 1)
                      : undefined
                  }
                  {...rowCallbacks}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      ) : null}
    </div>
  );
}

/** A not-started row wired to the sortable list. The row button carries the drag listeners. */
function SortableObjectiveRow(props: Omit<ObjectiveRowProps, 'drag'>) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: props.objective.id
  });
  return (
    <ObjectiveRow
      {...props}
      drag={{
        setNodeRef,
        listeners,
        style: { transform: CSS.Translate.toString(transform), transition },
        isDragging
      }}
    />
  );
}
