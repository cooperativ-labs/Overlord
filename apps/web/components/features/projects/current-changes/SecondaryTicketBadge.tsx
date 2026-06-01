import { Filter } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';

import { ticketReviewHighlightClasses } from './helpers';
import type { TicketSummary } from './types';

export function SecondaryTicketBadge({
  isSelected,
  projectId,
  ticket,
  onFilter,
  onToggle
}: {
  isSelected: boolean;
  projectId: string;
  ticket: TicketSummary;
  onFilter: () => void;
  onToggle: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex max-w-[220px] items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10px] hover:bg-muted',
            ticketReviewHighlightClasses(ticket.status_type),
            isSelected
              ? 'border-primary bg-primary/10 text-primary'
              : 'bg-background text-foreground'
          )}
          aria-pressed={isSelected}
        >
          <span className="truncate">
            {ticket.title?.trim() || `Ticket ${getTicketIdentifier(ticket)}`}
          </span>
          {ticket.status ? <span className="text-muted-foreground">· {ticket.status}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="space-y-3">
          <div className="space-y-1">
            <Link
              className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
              href={buildTicketPath({ projectId, ticketId: ticket.id })}
            >
              {ticket.title?.trim() || `Ticket ${getTicketIdentifier(ticket)}`}
            </Link>
            <p className="text-xs text-muted-foreground">
              {ticket.objective?.trim() || 'No ticket objective yet.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={onFilter}
            >
              <Filter className="h-3 w-3" />
              Show only this ticket
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onToggle}
            >
              {isSelected ? 'Remove from filter' : 'Add to filter'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
