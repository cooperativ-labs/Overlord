'use client';

import { useDraggable } from '@dnd-kit/core';
import { Check } from 'lucide-react';

import { getDisplayTitle } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';
import type { Ticket } from '@/types/tickets';

import { TicketAssigneeAvatar } from '../TicketCardPrimitives';

import { getCalendarTicketColors } from './calendar-ticket-colors';

export function DraggableCalendarTicket({
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
      <TicketAssigneeAvatar assignee={ticket.assignee} className="ml-auto h-3.5 w-3.5" />
    </div>
  );
}
