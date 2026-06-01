'use client';

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';

import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import { Button } from '@/components/ui/button';
import { upsertProjectUserPreferencesAction } from '@/lib/actions/project-user-preferences';
import { useTicketTagsBatch } from '@/lib/client-data/tags/hooks';
import { selectAllTickets } from '@/lib/client-data/tickets/board-selectors';
import { useTicketBoard } from '@/lib/client-data/tickets/hooks';
import {
  useCreateTicketMutation,
  useUpdateTicketDueDateMutation,
  useUpdateTicketStatusMutation
} from '@/lib/client-data/tickets/mutations';
import {
  normalizeTicketListFilters,
  type TicketListFilters
} from '@/lib/helpers/ticket-list-filters';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import {
  areFilterIdsEqual,
  buildTagFilterOptions,
  readStoredListFilters,
  writeStoredListFilters
} from '@/lib/helpers/ticket-tag-filters';
import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import type { Ticket } from '@/types/tickets';

import { CalendarDayCell } from './calendar/CalendarDayCell';
import { CalendarTicketOverlay } from './calendar/CalendarTicketOverlay';
import {
  buildBoardBootstrap,
  buildBoardScope,
  resolveOptimisticTicketProject,
  toBoardTicket,
  toViewTicket
} from './ticket-view-helpers';
import TicketsViewControls from './TicketsViewControls';
import { TicketTagFilterDropdown } from './TicketTagFilterDropdown';

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type CalendarViewProps = {
  tickets: Ticket[];
  statuses: Array<{ name: string; position: number; status_type?: string }>;
  completeStatusName?: string;
  initialView: string;
  showViewToggle?: boolean;
  projectId?: string;
  organizationId?: number;
  ticketUrlBase?: string;
  initialListFilters?: TicketListFilters | null;
};

export default function CalendarView({
  tickets: initialTickets,
  statuses,
  completeStatusName,
  initialView,
  showViewToggle = true,
  projectId,
  organizationId,
  ticketUrlBase = '/u',
  initialListFilters
}: CalendarViewProps) {
  const router = useRouter();
  const boardScope = useMemo(
    () => buildBoardScope({ organizationId, projectId }),
    [organizationId, projectId]
  );
  const boardBootstrap = useMemo(
    () => buildBoardBootstrap({ scope: boardScope, tickets: initialTickets, statuses }),
    [boardScope, initialTickets, statuses]
  );
  const boardQuery = useTicketBoard(boardScope, boardBootstrap, { dataset: 'calendar' });
  const tickets = useMemo(
    () => (boardQuery.data ? selectAllTickets(boardQuery.data).map(toViewTicket) : initialTickets),
    [boardQuery.data, initialTickets]
  );
  const visibleTicketIds = useMemo(() => tickets.map(ticket => ticket.id), [tickets]);
  const { data: tagsByTicketId } = useTicketTagsBatch(visibleTicketIds);
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [storedListFilters] = useState<TicketListFilters | null>(() =>
    projectId ? null : readStoredListFilters()
  );
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(() => {
    const fromInitial = initialListFilters?.filter_tag_ids;
    if (fromInitial && fromInitial.length > 0) return [...fromInitial];
    const fromStored = storedListFilters?.filter_tag_ids;
    if (fromStored && fromStored.length > 0) return [...fromStored];
    return [];
  });
  const persistedSelectedStatuses = useMemo(
    () => initialListFilters?.selected_statuses ?? storedListFilters?.selected_statuses ?? [],
    [initialListFilters?.selected_statuses, storedListFilters?.selected_statuses]
  );
  const persistedProjectIds = useMemo(
    () => initialListFilters?.filter_project_ids ?? storedListFilters?.filter_project_ids ?? [],
    [initialListFilters?.filter_project_ids, storedListFilters?.filter_project_ids]
  );
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [completingTicketId, setCompletingTicketId] = useState<string | null>(null);
  const [creatingOnDateKey, setCreatingOnDateKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const createTicketMutation = useCreateTicketMutation();
  const updateDueDateMutation = useUpdateTicketDueDateMutation();
  const updateStatusMutation = useUpdateTicketStatusMutation();
  const { defaultProject } = useDefaultProject();
  const tagOptions = useMemo(() => buildTagFilterOptions(tagsByTicketId), [tagsByTicketId]);

  const saveListFilters = useCallback(
    (nextTagIds: string[]) => {
      const nextFilters = normalizeTicketListFilters({
        selected_statuses: persistedSelectedStatuses,
        filter_project_ids: persistedProjectIds,
        filter_tag_ids: nextTagIds
      });

      if (projectId) {
        startTransition(() => {
          void upsertProjectUserPreferencesAction(projectId, { list_filters: nextFilters });
        });
        return;
      }

      try {
        writeStoredListFilters(nextFilters);
      } catch {
        // ignore localStorage errors
      }
    },
    [persistedProjectIds, persistedSelectedStatuses, projectId, startTransition]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }
    })
  );

  // Build calendar grid (Sunday-Saturday)
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [currentMonth]);

  // Group tickets by date string
  const ticketsByDate = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const ticket of tickets) {
      if (
        selectedTagIds.length > 0 &&
        !(tagsByTicketId?.[ticket.id] ?? []).some(tag => selectedTagIds.includes(tag.id))
      ) {
        continue;
      }
      if (!ticket.due_datetime) continue;
      const dateKey = format(parseISO(ticket.due_datetime), 'yyyy-MM-dd');
      const existing = map.get(dateKey) ?? [];
      existing.push(ticket);
      map.set(dateKey, existing);
    }
    return map;
  }, [selectedTagIds, tagsByTicketId, tickets]);

  useEffect(() => {
    if (selectedTagIds.length === 0) return;
    const validIds = new Set(tagOptions.map(tag => tag.id));
    const next = selectedTagIds.filter(id => validIds.has(id));
    if (areFilterIdsEqual(next, selectedTagIds)) return;
    saveListFilters(next);
    setSelectedTagIds(next);
  }, [saveListFilters, selectedTagIds, tagOptions]);

  const handlePrevMonth = useCallback(() => {
    setCurrentMonth(prev => subMonths(prev, 1));
  }, []);

  const handleNextMonth = useCallback(() => {
    setCurrentMonth(prev => addMonths(prev, 1));
  }, []);

  const handleToday = useCallback(() => {
    setCurrentMonth(startOfMonth(new Date()));
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const ticket = tickets.find(t => t.id === event.active.id);
      setActiveTicket(ticket ?? null);
    },
    [tickets]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTicket(null);
      const { active, over } = event;
      if (!over) return;

      const ticketId = active.id as string;
      const newDateKey = over.id as string;

      // Find current ticket
      const ticket = tickets.find(t => t.id === ticketId);
      if (!ticket) return;

      // Check if the date actually changed
      const currentDateKey = ticket.due_datetime
        ? format(parseISO(ticket.due_datetime), 'yyyy-MM-dd')
        : null;
      if (currentDateKey === newDateKey) return;

      // Build new due_datetime preserving time or defaulting to noon
      const newDueDate = `${newDateKey}T12:00:00.000Z`;

      startTransition(async () => {
        await updateDueDateMutation.mutateAsync({ ticketId, dueDate: newDueDate });
      });
    },
    [tickets, startTransition, updateDueDateMutation]
  );

  const handleTicketClick = useCallback(
    (ticket: Ticket) => {
      const path =
        ticketUrlBase === '/u'
          ? `/u/${ticket.id}`
          : buildTicketPath({ projectId: ticket.project_id, ticketId: ticket.id });
      router.push(path);
    },
    [router, ticketUrlBase]
  );

  const handleStartCreating = useCallback((dateKey: string) => {
    setCreatingOnDateKey(dateKey);
  }, []);

  const handleCloseCreating = useCallback(() => {
    setCreatingOnDateKey(null);
  }, []);

  const handleCreateCalendarTicket = useCallback(
    async (dateKey: string, objective: string) => {
      const trimmed = objective.trim();
      if (!trimmed) return;

      const dueDatetime = `${dateKey}T12:00:00.000Z`;
      const clientTicketId = crypto.randomUUID();

      const referenceTicket =
        tickets.find(t => (projectId ? t.project_id === projectId : true)) ?? tickets[0];

      const optimisticProject = resolveOptimisticTicketProject({
        projectId,
        defaultProject,
        referenceTicket
      });
      const effectiveProjectId = optimisticProject.project_id ?? undefined;

      const optimisticTicket: Ticket = {
        id: clientTicketId,
        ticket_id: null,
        title: deriveTitleFromObjective(trimmed),
        objective: trimmed,
        organization_id:
          organizationId ??
          optimisticProject.organization_id ??
          referenceTicket?.organization_id ??
          0,
        project_id: optimisticProject.project_id,
        project_name: optimisticProject.project_name,
        project_color: optimisticProject.project_color,
        project_everhour_project_id: optimisticProject.project_everhour_project_id,
        everhour_task_id: null,
        agent_session_state: null,
        status: 'draft',
        priority: 'medium',
        for_human: false,
        assigned_agent: null,
        board_position: 0,
        due_datetime: dueDatetime,
        waiting_for_response_at: null,
        has_unopened_waiting_response: false,
        is_read: true
      };

      setCreatingOnDateKey(null);

      try {
        await createTicketMutation.mutateAsync({
          optimisticTicket: toBoardTicket(optimisticTicket),
          status: optimisticTicket.status,
          objective: trimmed,
          organizationId,
          projectId: effectiveProjectId,
          placement: 'top'
        });
        await updateDueDateMutation.mutateAsync({ ticketId: clientTicketId, dueDate: dueDatetime });
      } catch {
        setCreatingOnDateKey(dateKey);
      }
    },
    [
      createTicketMutation,
      defaultProject,
      organizationId,
      projectId,
      tickets,
      updateDueDateMutation
    ]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          {showViewToggle && (
            <TicketsViewControls initialView={initialView} projectId={projectId} />
          )}
          <TicketTagFilterDropdown
            tagOptions={tagOptions}
            selectedTagIds={selectedTagIds}
            onToggle={tagId => {
              setSelectedTagIds(prev => {
                const next = prev.includes(tagId)
                  ? prev.filter(currentTagId => currentTagId !== tagId)
                  : [...prev, tagId];
                queueMicrotask(() => {
                  saveListFilters(next);
                });
                return next;
              });
            }}
            onClear={() => {
              setSelectedTagIds([]);
              saveListFilters([]);
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleToday}>
            Today
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePrevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="min-w-[140px] text-center text-sm font-semibold">
            {format(currentMonth, 'MMMM yyyy')}
          </h2>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleNextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Calendar grid */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-md border">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b bg-muted/50">
            {DAY_HEADERS.map(day => (
              <div
                key={day}
                className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid flex-1 grid-cols-7 auto-rows-fr">
            {calendarDays.map(day => {
              const dateKey = format(day, 'yyyy-MM-dd');
              const dayTickets = ticketsByDate.get(dateKey) ?? [];
              const inCurrentMonth = isSameMonth(day, currentMonth);
              const today = isToday(day);

              return (
                <CalendarDayCell
                  key={dateKey}
                  dateKey={dateKey}
                  day={day}
                  tickets={dayTickets}
                  inCurrentMonth={inCurrentMonth}
                  isToday={today}
                  completeStatusName={completeStatusName}
                  completingTicketId={completingTicketId}
                  isCreating={creatingOnDateKey === dateKey}
                  onStartCreating={handleStartCreating}
                  onCloseCreating={handleCloseCreating}
                  onCreateTicket={handleCreateCalendarTicket}
                  onTicketComplete={ticketId => {
                    if (!completeStatusName) return;
                    setCompletingTicketId(ticketId);

                    startTransition(async () => {
                      try {
                        await updateStatusMutation.mutateAsync({
                          ticketId,
                          status: completeStatusName
                        });
                      } catch {
                        // useUpdateTicketStatusMutation restores the previous cache snapshot.
                      } finally {
                        setCompletingTicketId(current => (current === ticketId ? null : current));
                      }
                    });
                  }}
                  onTicketClick={handleTicketClick}
                />
              );
            })}
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeTicket ? <CalendarTicketOverlay ticket={activeTicket} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
