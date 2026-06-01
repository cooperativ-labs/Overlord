'use client';

import { getDisplayTitle } from '@/lib/helpers/tickets';
import type { Ticket } from '@/types/tickets';

import { getCalendarTicketColors } from './calendar-ticket-colors';

export function CalendarTicketOverlay({ ticket }: { ticket: Ticket }) {
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
