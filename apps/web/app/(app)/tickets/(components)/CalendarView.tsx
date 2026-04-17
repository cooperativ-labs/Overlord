'use client';

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
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
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { selectAllTickets } from '@/lib/client-data/tickets/board-selectors';
import { useTicketBoard } from '@/lib/client-data/tickets/hooks';
import {
  useCreateTicketMutation,
  useUpdateTicketDueDateMutation,
  useUpdateTicketStatusMutation
} from '@/lib/client-data/tickets/mutations';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { deriveTitleFromObjective, getDisplayTitle } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';

import type { Ticket } from './KanbanCard';
import {
  buildBoardBootstrap,
  buildBoardScope,
  toBoardTicket,
  toViewTicket
} from './ticket-view-helpers';
import TicketsViewControls from './TicketsViewControls';

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const normalized = value.trim();
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;

  if (hex.length === 3) {
    const [r, g, b] = hex.split('');
    if (!r || !g || !b) return null;
    return {
      r: Number.parseInt(r + r, 16),
      g: Number.parseInt(g + g, 16),
      b: Number.parseInt(b + b, 16)
    };
  }

  if (hex.length === 6) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16)
    };
  }

  return null;
}

function getCalendarTicketColors(projectColor: string | null | undefined) {
  if (!projectColor) {
    return {
      backgroundColor: undefined,
      borderColor: undefined,
      color: undefined,
      checkboxBorderColor: undefined,
      checkboxBackgroundColor: undefined
    };
  }

  const rgb = parseHexColor(projectColor);
  if (!rgb) {
    return {
      backgroundColor: projectColor,
      borderColor: projectColor,
      color: '#111827',
      checkboxBorderColor: 'rgba(17, 24, 39, 0.35)',
      checkboxBackgroundColor: 'rgba(255, 255, 255, 0.18)'
    };
  }

  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  const foreground = luminance > 0.6 ? '#111827' : '#ffffff';
  const checkboxBorderColor =
    foreground === '#111827' ? 'rgba(17, 24, 39, 0.35)' : 'rgba(255, 255, 255, 0.45)';
  const checkboxBackgroundColor =
    foreground === '#111827' ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.12)';

  return {
    backgroundColor: projectColor,
    borderColor: projectColor,
    color: foreground,
    checkboxBorderColor,
    checkboxBackgroundColor
  };
}

type CalendarViewProps = {
  tickets: Ticket[];
  statuses: Array<{ name: string; position: number; status_type?: string }>;
  completeStatusName?: string;
  initialView: string;
  showViewToggle?: boolean;
  projectId?: string;
  organizationId?: number;
  ticketUrlBase?: string;
};

export default function CalendarView({
  tickets: initialTickets,
  statuses,
  completeStatusName,
  initialView,
  showViewToggle = true,
  projectId,
  organizationId,
  ticketUrlBase = '/u'
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
  const boardQuery = useTicketBoard(boardScope, boardBootstrap);
  const tickets = useMemo(
    () => (boardQuery.data ? selectAllTickets(boardQuery.data).map(toViewTicket) : initialTickets),
    [boardQuery.data, initialTickets]
  );
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [completingTicketId, setCompletingTicketId] = useState<string | null>(null);
  const [creatingOnDateKey, setCreatingOnDateKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const createTicketMutation = useCreateTicketMutation();
  const updateDueDateMutation = useUpdateTicketDueDateMutation();
  const updateStatusMutation = useUpdateTicketStatusMutation();

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
      if (!ticket.due_datetime) continue;
      const dateKey = format(parseISO(ticket.due_datetime), 'yyyy-MM-dd');
      const existing = map.get(dateKey) ?? [];
      existing.push(ticket);
      map.set(dateKey, existing);
    }
    return map;
  }, [tickets]);

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

      const optimisticTicket: Ticket = {
        id: clientTicketId,
        title: deriveTitleFromObjective(trimmed),
        objective: trimmed,
        organization_id: organizationId ?? referenceTicket?.organization_id ?? 0,
        project_id: projectId ?? referenceTicket?.project_id ?? '',
        project_name: referenceTicket?.project_name ?? null,
        project_color: referenceTicket?.project_color ?? null,
        project_everhour_project_id: referenceTicket?.project_everhour_project_id ?? null,
        everhour_task_id: null,
        agent_session_state: null,
        status: 'draft',
        priority: 'medium',
        execution_target: 'agent',
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
          projectId,
          placement: 'top'
        });
        await updateDueDateMutation.mutateAsync({ ticketId: clientTicketId, dueDate: dueDatetime });
      } catch {
        setCreatingOnDateKey(dateKey);
      }
    },
    [createTicketMutation, organizationId, projectId, tickets, updateDueDateMutation]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          {showViewToggle && (
            <TicketsViewControls initialView={initialView} projectId={projectId} />
          )}
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

function CalendarNewTicketInput({
  dateKey,
  onSubmit,
  onClose
}: {
  dateKey: string;
  onSubmit: (dateKey: string, objective: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (isSubmitting) return;
      const trimmed = e.currentTarget.value.trim();
      if (!trimmed) {
        onClose();
        return;
      }
      setIsSubmitting(true);
      onSubmit(dateKey, trimmed);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (isSubmitting) return;
    const trimmed = e.target.value.trim();
    if (trimmed) {
      setIsSubmitting(true);
      onSubmit(dateKey, trimmed);
    } else {
      onClose();
    }
  };

  return (
    <div
      className="mt-0.5 rounded border border-border/60 bg-background shadow-sm"
      onClick={e => e.stopPropagation()}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={isSubmitting}
        placeholder="Write an objective…"
        rows={2}
        className="w-full resize-none rounded bg-transparent px-1.5 py-1 text-xs outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  );
}

function CalendarDayCell({
  dateKey,
  day,
  tickets,
  inCurrentMonth,
  isToday: today,
  completeStatusName,
  completingTicketId,
  isCreating,
  onStartCreating,
  onCloseCreating,
  onCreateTicket,
  onTicketComplete,
  onTicketClick
}: {
  dateKey: string;
  day: Date;
  tickets: Ticket[];
  inCurrentMonth: boolean;
  isToday: boolean;
  completeStatusName?: string;
  completingTicketId: string | null;
  isCreating: boolean;
  onStartCreating: (dateKey: string) => void;
  onCloseCreating: () => void;
  onCreateTicket: (dateKey: string, objective: string) => void;
  onTicketComplete: (ticketId: string) => void;
  onTicketClick: (ticket: Ticket) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dateKey });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'min-h-[100px] border-b border-r p-1 transition-colors',
        !inCurrentMonth && 'bg-muted/30',
        isOver && 'bg-primary/10'
      )}
      onClick={() => {
        if (!isCreating) onStartCreating(dateKey);
      }}
    >
      <div className="mb-0.5 flex items-center justify-between px-0.5">
        <span
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs',
            today && 'bg-primary text-primary-foreground font-semibold',
            !today && !inCurrentMonth && 'text-muted-foreground/50',
            !today && inCurrentMonth && 'text-foreground'
          )}
        >
          {format(day, 'd')}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {tickets.map(ticket => (
          <DraggableCalendarTicket
            key={ticket.id}
            ticket={ticket}
            completeStatusName={completeStatusName}
            isCompleting={completingTicketId === ticket.id}
            onComplete={() => onTicketComplete(ticket.id)}
            onClick={() => onTicketClick(ticket)}
          />
        ))}
        {isCreating && (
          <CalendarNewTicketInput
            dateKey={dateKey}
            onSubmit={onCreateTicket}
            onClose={onCloseCreating}
          />
        )}
      </div>
    </div>
  );
}

function DraggableCalendarTicket({
  ticket,
  completeStatusName,
  isCompleting,
  onComplete,
  onClick
}: {
  ticket: Ticket;
  completeStatusName?: string;
  isCompleting: boolean;
  onComplete: () => void;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ticket.id });
  const normalizedTicketStatus = ticket.status.trim().toLowerCase();
  const normalizedCompleteStatus = completeStatusName?.trim().toLowerCase();
  const isComplete =
    normalizedCompleteStatus !== undefined && normalizedTicketStatus === normalizedCompleteStatus;
  const ticketColors = getCalendarTicketColors(ticket.project_color);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group flex cursor-grab items-center gap-1 rounded border px-1.5 py-1 text-xs transition-[opacity,colors] hover:brightness-[0.98]',
        !ticket.project_color && 'border-transparent hover:bg-accent',
        isDragging && 'opacity-40',
        isComplete && 'opacity-45'
      )}
      style={ticketColors}
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
      {...listeners}
      {...attributes}
    >
      {completeStatusName ? (
        <button
          type="button"
          aria-label={isComplete ? 'Ticket completed' : 'Mark ticket complete'}
          aria-pressed={isComplete}
          disabled={isComplete || isCompleting}
          className={cn(
            'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
            isComplete ? 'bg-current text-black/80' : 'text-transparent',
            (isComplete || isCompleting) && 'cursor-default'
          )}
          style={{
            borderColor: ticket.project_color ? ticketColors.checkboxBorderColor : undefined,
            backgroundColor:
              isComplete && ticket.project_color
                ? ticketColors.color
                : ticket.project_color
                  ? ticketColors.checkboxBackgroundColor
                  : undefined,
            color: isComplete && ticket.project_color ? ticket.project_color : undefined
          }}
          onPointerDown={e => {
            e.stopPropagation();
          }}
          onClick={e => {
            e.stopPropagation();
            onComplete();
          }}
        >
          <Check className="h-3 w-3" />
        </button>
      ) : null}
      <span className="truncate">{getDisplayTitle(ticket)}</span>
    </div>
  );
}

function CalendarTicketOverlay({ ticket }: { ticket: Ticket }) {
  const ticketColors = getCalendarTicketColors(ticket.project_color);

  return (
    <div
      className="flex items-center gap-1 rounded border px-2 py-1 text-xs shadow-lg"
      style={{
        backgroundColor: ticketColors.backgroundColor ?? 'var(--card)',
        borderColor: ticketColors.borderColor,
        color: ticketColors.color
      }}
    >
      <span className="truncate">{getDisplayTitle(ticket)}</span>
    </div>
  );
}
