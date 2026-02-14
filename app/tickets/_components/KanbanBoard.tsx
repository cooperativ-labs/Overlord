'use client';

import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useOptimistic, useRef, useState, useTransition } from 'react';

import { reorderTicketsAction } from '@/lib/actions/tickets';
import type { BoardColumn } from '@/lib/orchestrator/types';

import KanbanCard, { type Ticket } from './KanbanCard';
import KanbanColumn from './KanbanColumn';

export default function KanbanBoard({
  tickets: initialTickets,
  columns
}: {
  tickets: Ticket[];
  columns: BoardColumn[];
}) {
  const [, startTransition] = useTransition();
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);

  const [optimisticTickets, applyOptimistic] = useOptimistic(
    initialTickets,
    (_current: Ticket[], next: Ticket[]) => next
  );

  // Keep a mutable ref for the working ticket list during drag
  const workingTickets = useRef(optimisticTickets);
  workingTickets.current = optimisticTickets;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const sortedColumns = [...columns].sort((a, b) => a.position - b.position);

  // Build lookups
  const columnBySlug = new Map(columns.map(c => [c.slug, c]));
  const statusToSlug = new Map<string, string>();
  for (const col of columns) {
    for (const s of col.statuses) {
      statusToSlug.set(s, col.slug);
    }
  }

  // Group tickets into columns
  function groupTickets(tickets: Ticket[]) {
    const groups = new Map<string, Ticket[]>();
    const uncategorized: Ticket[] = [];
    for (const col of sortedColumns) {
      groups.set(col.slug, []);
    }
    for (const ticket of tickets) {
      const slug = statusToSlug.get(ticket.status);
      if (slug && groups.has(slug)) {
        groups.get(slug)!.push(ticket);
      } else {
        uncategorized.push(ticket);
      }
    }
    return { groups, uncategorized };
  }

  const { groups: columnTickets, uncategorized } = groupTickets(optimisticTickets);

  // Find which column slug a ticket ID belongs to
  function findColumnSlug(ticketId: string): string | undefined {
    const ticket = workingTickets.current.find(t => t.id === ticketId);
    if (!ticket) return undefined;
    return statusToSlug.get(ticket.status);
  }

  // Resolve an over.id to a column slug — it could be a column slug or a ticket id
  function resolveOverColumn(overId: string): string | undefined {
    if (columnBySlug.has(overId)) return overId;
    return findColumnSlug(overId);
  }

  function handleDragStart(event: DragStartEvent) {
    const ticket = workingTickets.current.find(t => t.id === event.active.id);
    setActiveTicket(ticket ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeSlug = findColumnSlug(active.id as string);
    const overSlug = resolveOverColumn(over.id as string);
    if (!activeSlug || !overSlug || activeSlug === overSlug) return;

    // Move ticket to the target column by changing its status
    const targetColumn = columnBySlug.get(overSlug);
    if (!targetColumn || targetColumn.statuses.length === 0) return;
    const newStatus = targetColumn.statuses[0];

    const updated = workingTickets.current.map(t =>
      t.id === active.id ? { ...t, status: newStatus } : t
    );
    workingTickets.current = updated;
    startTransition(() => applyOptimistic(updated));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTicket(null);

    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const columnSlug = resolveOverColumn(overId) ?? findColumnSlug(activeId);
    if (!columnSlug) return;

    const ticket = workingTickets.current.find(t => t.id === activeId);
    if (!ticket) return;

    // Get the current column's tickets in order
    const { groups } = groupTickets(workingTickets.current);
    const colTickets = groups.get(columnSlug) ?? [];

    // If dropped on another ticket in the same column, reorder
    const oldIndex = colTickets.findIndex(t => t.id === activeId);
    const newIndex = colTickets.findIndex(t => t.id === overId);

    let reordered = colTickets;
    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      reordered = arrayMove(colTickets, oldIndex, newIndex);
    }

    const orderedIds = reordered.map(t => t.id);
    const col = columnBySlug.get(columnSlug);
    const originalSlug = statusToSlug.get(
      initialTickets.find(t => t.id === activeId)?.status ?? ''
    );
    const statusChanged = originalSlug !== columnSlug;

    startTransition(async () => {
      // Apply optimistic reorder
      const positionMap = new Map(orderedIds.map((id, i) => [id, i]));
      const updated = workingTickets.current.map(t =>
        positionMap.has(t.id) ? { ...t, board_position: positionMap.get(t.id)! } : t
      );
      applyOptimistic(updated);

      await reorderTicketsAction(
        orderedIds,
        statusChanged && col ? { ticketId: activeId, newStatus: col.statuses[0] } : undefined
      );
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="kanban-board">
        {sortedColumns.map(col => (
          <KanbanColumn key={col.id} column={col} tickets={columnTickets.get(col.slug) ?? []} />
        ))}
        {uncategorized.length > 0 && (
          <KanbanColumn
            column={{
              id: '__uncategorized',
              title: 'Uncategorized',
              slug: '__uncategorized',
              statuses: [],
              position: 999,
              created_at: '',
              updated_at: ''
            }}
            tickets={uncategorized}
          />
        )}
      </div>

      <DragOverlay>
        {activeTicket ? <KanbanCard ticket={activeTicket} isDragOverlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
