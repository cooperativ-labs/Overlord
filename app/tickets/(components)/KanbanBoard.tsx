'use client';

import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { Columns3, Eye, EyeOff } from 'lucide-react';
import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { createTicketInColumnAction, reorderTicketsAction } from '@/lib/actions/tickets';

import KanbanCard, { type Ticket } from './KanbanCard';
import KanbanColumn from './KanbanColumn';

const UNCATEGORIZED_COLUMN_ID = '__uncategorized';

type StatusColumn = {
  id: string;
  title: string;
  position: number;
};

function toColumnTitle(status: string): string {
  return status
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function deriveTitleFromObjective(objective: string): string {
  const trimmed = objective.trim();
  if (trimmed.length <= 60) return trimmed;
  return `${trimmed.slice(0, 60)}...`;
}

export default function KanbanBoard({
  tickets: initialTickets,
  statuses,
  showOrganizationName = false,
  organizationId,
  projectId
}: {
  tickets: Ticket[];
  statuses: Array<{ name: string; position: number }>;
  showOrganizationName?: boolean;
  organizationId?: number;
  projectId?: string;
}) {
  const [, startTransition] = useTransition();
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);

  const columns: StatusColumn[] = statuses.map(status => ({
    id: status.name,
    title: toColumnTitle(status.name),
    position: status.position
  }));

  const allColumnSlugs = columns.map(c => c.id);
  const [visibleSlugs, setVisibleSlugs] = useState<Set<string>>(() => new Set(allColumnSlugs));

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
  const columnById = new Map(columns.map(c => [c.id, c]));

  // Group tickets into columns
  function groupTickets(tickets: Ticket[]) {
    const groups = new Map<string, Ticket[]>();
    const uncategorized: Ticket[] = [];
    for (const col of sortedColumns) {
      groups.set(col.id, []);
    }
    for (const ticket of tickets) {
      if (groups.has(ticket.status)) {
        groups.get(ticket.status)!.push(ticket);
      } else {
        uncategorized.push(ticket);
      }
    }
    return { groups, uncategorized };
  }

  const { groups: columnTickets, uncategorized } = groupTickets(optimisticTickets);

  // Default uncategorized column to visible when it has tickets
  useEffect(() => {
    if (uncategorized.length > 0) {
      setVisibleSlugs(prev =>
        prev.has(UNCATEGORIZED_COLUMN_ID) ? prev : new Set(prev).add(UNCATEGORIZED_COLUMN_ID)
      );
    }
  }, [uncategorized.length]);

  const toggleColumnVisibility = (slug: string) => {
    setVisibleSlugs(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const visibleSortedColumns = sortedColumns.filter(col => visibleSlugs.has(col.id));
  const showUncategorized = uncategorized.length > 0 && visibleSlugs.has(UNCATEGORIZED_COLUMN_ID);

  // Find which column slug a ticket ID belongs to
  function findColumnSlug(ticketId: string): string | undefined {
    const ticket = workingTickets.current.find(t => t.id === ticketId);
    if (!ticket) return undefined;
    return ticket.status;
  }

  // Resolve an over.id to a column slug — it could be a column slug or a ticket id
  function resolveOverColumn(overId: string): string | undefined {
    if (columnById.has(overId)) return overId;
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
    const targetColumn = columnById.get(overSlug);
    if (!targetColumn) return;
    const newStatus = targetColumn.id;

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
    const col = columnById.get(columnSlug);
    const originalSlug = initialTickets.find(t => t.id === activeId)?.status;
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
        statusChanged && col ? { ticketId: activeId, newStatus: col.id } : undefined
      );
    });
  }

  async function handleCreateTicket(status: string, objective: string) {
    const trimmedObjective = objective.trim();
    if (!trimmedObjective) {
      return;
    }

    const previous = workingTickets.current;
    const positionInColumn =
      previous
        .filter(ticket => ticket.status === status)
        .reduce((max, ticket) => Math.max(max, ticket.board_position), -1) + 1;

    const referenceTicket =
      previous.find(ticket => (projectId ? ticket.project_id === projectId : true)) ?? previous[0];

    const optimisticTicket: Ticket = {
      id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: deriveTitleFromObjective(trimmedObjective),
      objective: trimmedObjective,
      organization_id: organizationId ?? referenceTicket?.organization_id ?? 0,
      project_id: projectId ?? referenceTicket?.project_id ?? '',
      project_name: referenceTicket?.project_name ?? null,
      project_color: referenceTicket?.project_color ?? null,
      project_everhour_project_id: referenceTicket?.project_everhour_project_id ?? null,
      everhour_task_id: null,
      agent_session_state: null,
      status,
      priority: 'medium',
      execution_target: 'agent',
      assigned_agent: null,
      board_position: positionInColumn,
      organization_name: referenceTicket?.organization_name ?? null
    };

    const optimisticNext = [...previous, optimisticTicket];
    workingTickets.current = optimisticNext;
    startTransition(() => applyOptimistic(optimisticNext));

    try {
      await createTicketInColumnAction(status, trimmedObjective, organizationId, projectId);
    } catch {
      workingTickets.current = previous;
      startTransition(() => applyOptimistic(previous));
    }
  }

  const uncategorizedColumn: StatusColumn = {
    id: UNCATEGORIZED_COLUMN_ID,
    title: 'Uncategorized',
    position: 999
  };

  return (
    <DndContext
      id="tickets-kanban-dnd"
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mb-2 flex justify-end px-4 md:px-6">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Columns3 className="h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {sortedColumns.map(col => {
                const visible = visibleSlugs.has(col.id);
                return (
                  <DropdownMenuItem
                    key={col.id}
                    onClick={() => toggleColumnVisibility(col.id)}
                    className="gap-2"
                  >
                    {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    {col.title}
                  </DropdownMenuItem>
                );
              })}
              {uncategorized.length > 0 && (
                <DropdownMenuItem
                  onClick={() => toggleColumnVisibility(UNCATEGORIZED_COLUMN_ID)}
                  className="gap-2"
                >
                  {visibleSlugs.has(UNCATEGORIZED_COLUMN_ID) ? (
                    <Eye className="h-4 w-4" />
                  ) : (
                    <EyeOff className="h-4 w-4" />
                  )}
                  Uncategorized
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-x-auto">
          <div className="inline-flex flex-nowrap gap-3 pb-4 px-4 md:px-6">
            {visibleSortedColumns.map(col => (
              <KanbanColumn
                key={col.id}
                column={col}
                tickets={columnTickets.get(col.id) ?? []}
                showOrganizationName={showOrganizationName}
                onCreateTicket={handleCreateTicket}
              />
            ))}
            {showUncategorized && (
              <KanbanColumn
                column={uncategorizedColumn}
                tickets={uncategorized}
                showOrganizationName={showOrganizationName}
                onCreateTicket={handleCreateTicket}
              />
            )}
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeTicket ? (
          <KanbanCard
            ticket={activeTicket}
            isDragOverlay
            showOrganizationName={showOrganizationName}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
