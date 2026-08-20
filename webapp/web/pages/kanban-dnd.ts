import {
  closestCenter,
  type CollisionDetection,
  getFirstCollision,
  MeasuringStrategy,
  pointerWithin,
  rectIntersection,
  type UniqueIdentifier
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';

import type { ColumnMap } from './board-shared.ts';

/** Stable PointerSensor options so DndContext does not tear down listeners every render. */
export const KANBAN_POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 6 } } as const;

/** Re-measure droppables while dragging so a card entering another column is hittable. */
export const KANBAN_DROPPABLE_MEASURING = {
  droppable: { strategy: MeasuringStrategy.Always }
} as const;

export function findKanbanColumn(columns: ColumnMap, id: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(columns, id)) return id;
  return Object.keys(columns).find(columnId => columns[columnId]?.includes(id));
}

/** Result of applying a drop onto the current board layout. */
export interface KanbanDragResult {
  columns: ColumnMap;
  dropColumnKey: string;
  orderedMissionIds: string[];
}

/**
 * Move `activeId` onto `overId` (another card or a column droppable). Handles
 * both within-column reorder and cross-column insert, including the case where
 * `onDragOver` has not yet placed the card in the destination list.
 */
export function applyKanbanDrag({
  columns,
  activeId,
  overId
}: {
  columns: ColumnMap;
  activeId: string;
  overId: string;
}): KanbanDragResult | null {
  const fromCol = findKanbanColumn(columns, activeId);
  const toCol = findKanbanColumn(columns, overId);
  if (!fromCol || !toCol) return null;

  if (fromCol === toCol) {
    const items = columns[fromCol] ?? [];
    const fromIndex = items.indexOf(activeId);
    const overIndex = overId === toCol ? items.length - 1 : items.indexOf(overId);
    if (fromIndex === -1 || overIndex === -1) return null;
    const orderedMissionIds =
      fromIndex === overIndex ? items : arrayMove(items, fromIndex, overIndex);
    return {
      columns: { ...columns, [toCol]: orderedMissionIds },
      dropColumnKey: toCol,
      orderedMissionIds
    };
  }

  const fromItems = (columns[fromCol] ?? []).filter(id => id !== activeId);
  const toItems = (columns[toCol] ?? []).filter(id => id !== activeId);
  const overIndex = overId === toCol ? toItems.length : toItems.indexOf(overId);
  const insertAt = overIndex >= 0 ? overIndex : toItems.length;
  const orderedMissionIds = [...toItems.slice(0, insertAt), activeId, ...toItems.slice(insertAt)];
  return {
    columns: { ...columns, [fromCol]: fromItems, [toCol]: orderedMissionIds },
    dropColumnKey: toCol,
    orderedMissionIds
  };
}

/**
 * Kanban collision: a column droppable wraps its cards, so `pointerWithin`
 * otherwise reports the column first and within-column reorder never sees the
 * card under the pointer. Prefer the closest card in that column; remember the
 * last hit so a drop in a gap still has a target.
 */
export function createKanbanCollisionDetection({
  getColumns,
  lastOverId
}: {
  getColumns: () => ColumnMap;
  lastOverId: { current: UniqueIdentifier | null };
}): CollisionDetection {
  return args => {
    const columns = getColumns();
    const pointerHits = pointerWithin(args);
    const intersections = pointerHits.length > 0 ? pointerHits : rectIntersection(args);
    let overId = getFirstCollision(intersections, 'id');

    if (overId !== null && overId !== undefined) {
      const columnKey = String(overId);
      if (Object.prototype.hasOwnProperty.call(columns, columnKey)) {
        const containerItems = columns[columnKey] ?? [];
        if (containerItems.length > 0) {
          const closestItem = closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter(container => {
              const id = String(container.id);
              return id !== columnKey && containerItems.includes(id);
            })
          });
          overId = closestItem[0]?.id ?? overId;
        }
      }
      lastOverId.current = overId;
      return [{ id: overId }];
    }

    return lastOverId.current ? [{ id: lastOverId.current }] : [];
  };
}
