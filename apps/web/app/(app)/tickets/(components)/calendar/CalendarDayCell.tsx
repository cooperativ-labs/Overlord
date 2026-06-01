'use client';

import { useDroppable } from '@dnd-kit/core';
import { format } from 'date-fns';

import { cn } from '@/lib/utils';
import type { Ticket } from '@/types/tickets';

import { CalendarNewTicketInput } from './CalendarNewTicketInput';
import { DraggableCalendarTicket } from './DraggableCalendarTicket';

export function CalendarDayCell({
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
