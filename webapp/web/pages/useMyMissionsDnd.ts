import {
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type BoardDndResult, type ColumnMap, columnMapsEqual } from './board-shared.ts';
import {
  applyKanbanDrag,
  createKanbanCollisionDetection,
  findKanbanColumn,
  KANBAN_DROPPABLE_MEASURING,
  KANBAN_POINTER_SENSOR_OPTIONS
} from './kanban-dnd.ts';

/** Destination of a completed drop, handed to the page to persist. */
export interface MyMissionsDropTarget {
  /** The moved mission id. */
  movedMissionId: string;
  /** The destination merged-column key (its DnD droppable id). */
  dropColumnKey: string;
  /** Every mission id occupying the destination merged column, top-to-bottom. */
  orderedMissionIds: string[];
}

/**
 * Drag-and-drop state machine for the My Missions aggregate board. Mirrors the
 * project board's optimistic-override pattern (`useBoardColumnDnd`): a drop is
 * applied to a local override immediately, then handed to `onDrop` to persist.
 * The aggregate board groups by status type across projects and workspaces;
 * resolving a drop to each card's concrete project status is page-owned logic.
 * The hook only decides *that* something moved, not *how* it persists. `onDrop`
 * rejects to signal an invalid or failed move, which reverts the optimistic
 * override.
 */
export function useMyMissionsDnd({
  columns,
  onDrop,
  draggable = true
}: {
  columns: ColumnMap;
  onDrop: (target: MyMissionsDropTarget) => Promise<void>;
  draggable?: boolean;
}): BoardDndResult {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [override, setOverride] = useState<ColumnMap | null>(null);
  // DnD Kit can deliver `onDragEnd` immediately after `onDragOver`, before
  // React has rendered the state update from the latter. Keep the active board
  // layout in a ref as well so a cross-column drop always persists the card in
  // its destination column rather than the stale pre-drag list.
  const overrideRef = useRef<ColumnMap | null>(null);
  const lastOverId = useRef<UniqueIdentifier | null>(null);

  const setOptimisticOverride = useCallback((next: ColumnMap | null) => {
    overrideRef.current = next;
    setOverride(next);
  }, []);

  // Drop the optimistic override once the real columns catch up to it.
  useEffect(() => {
    if (activeId === null && override !== null && columnMapsEqual(override, columns)) {
      setOptimisticOverride(null);
    }
  }, [activeId, override, columns, setOptimisticOverride]);

  const dndSensors = useSensors(
    useSensor(PointerSensor, KANBAN_POINTER_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const noSensors = useSensors();
  const sensors = draggable ? dndSensors : noSensors;

  const collisionDetection = useMemo(
    () =>
      createKanbanCollisionDetection({
        getColumns: () => overrideRef.current ?? columns,
        lastOverId
      }),
    [columns]
  );

  const displayColumns = override ?? columns;

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      lastOverId.current = null;
      setActiveId(String(event.active.id));
      setOptimisticOverride(columns);
    },
    [columns, setOptimisticOverride]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeMissionId = String(active.id);
      const overId = String(over.id);
      const source = overrideRef.current ?? columns;
      const fromCol = findKanbanColumn(source, activeMissionId);
      const toCol = findKanbanColumn(source, overId);
      if (!fromCol || !toCol || fromCol === toCol) return;

      const moved = applyKanbanDrag({ columns: source, activeId: activeMissionId, overId });
      if (moved) setOptimisticOverride(moved.columns);
    },
    [columns, setOptimisticOverride]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const id = String(active.id);
      const source = overrideRef.current ?? columns;
      const overId = over
        ? String(over.id)
        : lastOverId.current
          ? String(lastOverId.current)
          : null;

      setActiveId(null);
      lastOverId.current = null;

      if (!overId) {
        setOptimisticOverride(null);
        return;
      }

      const moved = applyKanbanDrag({ columns: source, activeId: id, overId });
      if (!moved) {
        setOptimisticOverride(null);
        return;
      }

      setOptimisticOverride(moved.columns);

      if (columnMapsEqual(moved.columns, columns)) {
        setOptimisticOverride(null);
        return;
      }

      // Persist through the page. A rejection (invalid target workspace, or a
      // server error) rolls the optimistic override back to server truth.
      void onDrop({
        movedMissionId: id,
        dropColumnKey: moved.dropColumnKey,
        orderedMissionIds: moved.orderedMissionIds
      }).catch(() => setOptimisticOverride(null));
    },
    [columns, onDrop, setOptimisticOverride]
  );

  const handleDragCancel = useCallback(() => {
    lastOverId.current = null;
    setActiveId(null);
    setOptimisticOverride(null);
  }, [setOptimisticOverride]);

  return {
    activeId,
    displayColumns,
    dndContextProps: {
      sensors,
      collisionDetection,
      measuring: KANBAN_DROPPABLE_MEASURING,
      onDragStart: handleDragStart,
      onDragOver: handleDragOver,
      onDragEnd: handleDragEnd,
      onDragCancel: handleDragCancel
    }
  };
}
