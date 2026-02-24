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
import { usePathname } from 'next/navigation';
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
import {
  getOpenedTicketTimestamps,
  hasUnopenedWaitingResponse,
  markTicketOpened,
  type TicketOpenedTimestamps
} from '@/lib/helpers/ticket-waiting-response';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';

import KanbanCard, { type Ticket } from './KanbanCard';
import KanbanColumn from './KanbanColumn';

const UNCATEGORIZED_COLUMN_ID = '__uncategorized';
const WAITING_SOUND_PATH = '/sounds/notification-question.wav';

type StatusColumn = {
  id: string;
  title: string;
  position: number;
};

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type ToastState = {
  ticketId: string;
  message: string;
  title: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getEventMessage(event: TicketEvent): string {
  const summary = event.summary?.trim();
  if (summary) return summary;

  const payload = isRecord(event.payload) ? event.payload : {};
  const payloadMessage = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (payloadMessage) return payloadMessage;

  return 'An agent is waiting for your response.';
}

function toWaitingByTicket(tickets: Ticket[]): Record<string, string> {
  return tickets.reduce<Record<string, string>>((acc, ticket) => {
    if (ticket.waiting_for_response_at) {
      acc[ticket.id] = ticket.waiting_for_response_at;
    }
    return acc;
  }, {});
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
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const [waitingByTicket, setWaitingByTicket] = useState<Record<string, string>>(() =>
    toWaitingByTicket(initialTickets)
  );
  const [openedTicketTimestamps, setOpenedTicketTimestamps] = useState<TicketOpenedTimestamps>(() =>
    getOpenedTicketTimestamps()
  );

  const soundRef = useRef<HTMLAudioElement | null>(null);
  const openedTicketTimestampsRef = useRef(openedTicketTimestamps);

  useEffect(() => {
    openedTicketTimestampsRef.current = openedTicketTimestamps;
  }, [openedTicketTimestamps]);

  useEffect(() => {
    setWaitingByTicket(toWaitingByTicket(initialTickets));
  }, [initialTickets]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setToastState(null), 3_000);
    return () => window.clearTimeout(timeoutId);
  }, [toastState]);

  useEffect(() => {
    const audio = new Audio(WAITING_SOUND_PATH);
    audio.preload = 'auto';
    soundRef.current = audio;

    return () => {
      soundRef.current = null;
    };
  }, []);

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

  const ticketsWithIndicators = optimisticTickets.map(ticket => {
    const waitingForResponseAt =
      waitingByTicket[ticket.id] ?? ticket.waiting_for_response_at ?? null;
    return {
      ...ticket,
      waiting_for_response_at: waitingForResponseAt,
      has_unopened_waiting_response: hasUnopenedWaitingResponse(
        waitingForResponseAt,
        openedTicketTimestamps[ticket.id]
      )
    };
  });

  // Keep a mutable ref for the working ticket list during drag
  const workingTickets = useRef(optimisticTickets);
  workingTickets.current = optimisticTickets;

  const ticketIdsRef = useRef<Set<string>>(new Set());
  ticketIdsRef.current = new Set(optimisticTickets.map(ticket => ticket.id));

  const ticketsByIdRef = useRef<Map<string, Ticket>>(new Map());
  ticketsByIdRef.current = new Map(ticketsWithIndicators.map(ticket => [ticket.id, ticket]));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const sortedColumns = [...columns].sort((a, b) => a.position - b.position);

  const columnById = new Map(columns.map(c => [c.id, c]));

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

  const { groups: columnTickets, uncategorized } = groupTickets(ticketsWithIndicators);

  useEffect(() => {
    if (uncategorized.length > 0) {
      setVisibleSlugs(prev =>
        prev.has(UNCATEGORIZED_COLUMN_ID) ? prev : new Set(prev).add(UNCATEGORIZED_COLUMN_ID)
      );
    }
  }, [uncategorized.length]);

  useEffect(() => {
    const pathSegments = pathname.split('/').filter(Boolean);
    const pathTicketId = pathSegments[pathSegments.length - 1];
    if (!pathTicketId || !ticketIdsRef.current.has(pathTicketId)) {
      return;
    }

    const next = markTicketOpened(pathTicketId);
    setOpenedTicketTimestamps(next);
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`kanban-agent-notifications:${organizationId ?? 'all'}:${projectId ?? 'all'}`)
      .on<TicketEvent>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ticket_events',
          filter: 'event_type=eq.question'
        },
        payload => {
          const event = payload.new;
          if (!event.is_blocking) {
            return;
          }

          if (!ticketIdsRef.current.has(event.ticket_id)) {
            return;
          }

          setWaitingByTicket(previous => {
            const existing = previous[event.ticket_id];
            if (existing && Date.parse(existing) >= Date.parse(event.created_at)) {
              return previous;
            }
            return { ...previous, [event.ticket_id]: event.created_at };
          });

          const openedAt = openedTicketTimestampsRef.current[event.ticket_id];
          if (!hasUnopenedWaitingResponse(event.created_at, openedAt)) {
            return;
          }

          const ticket = ticketsByIdRef.current.get(event.ticket_id);
          const title = ticket?.title?.trim()
            ? `Agent waiting: ${ticket.title.trim()}`
            : 'Agent waiting for response';

          setToastState({
            ticketId: event.ticket_id,
            title,
            message: getEventMessage(event)
          });

          const waitingSound = soundRef.current;
          if (waitingSound) {
            waitingSound.currentTime = 0;
            void waitingSound.play().catch(() => undefined);
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organizationId, projectId]);

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

  function findColumnSlug(ticketId: string): string | undefined {
    const ticket = workingTickets.current.find(t => t.id === ticketId);
    if (!ticket) return undefined;
    return ticket.status;
  }

  function resolveOverColumn(overId: string): string | undefined {
    if (columnById.has(overId)) return overId;
    return findColumnSlug(overId);
  }

  function handleDragStart(event: DragStartEvent) {
    const ticket = ticketsByIdRef.current.get(event.active.id as string) ?? null;
    setActiveTicket(ticket);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeSlug = findColumnSlug(active.id as string);
    const overSlug = resolveOverColumn(over.id as string);
    if (!activeSlug || !overSlug || activeSlug === overSlug) return;

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

    const { groups } = groupTickets(workingTickets.current);
    const colTickets = groups.get(columnSlug) ?? [];

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
      organization_name: referenceTicket?.organization_name ?? null,
      waiting_for_response_at: null,
      has_unopened_waiting_response: false
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
    <>
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
            <div className="inline-flex flex-nowrap gap-3 px-4 pb-4 md:px-6">
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

      {toastState ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border bg-card px-4 py-3 shadow-lg">
          <p className="text-sm font-medium">{toastState.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{toastState.message}</p>
        </div>
      ) : null}
    </>
  );
}
