import { Filter } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';

import type { TicketSummary } from './types';

type TicketFilterPopoverProps = {
  selectedTicketIds: Set<string>;
  tickets: TicketSummary[];
  onClear: () => void;
  onToggle: (ticketId: string) => void;
};

export function TicketFilterPopover({
  selectedTicketIds,
  tickets,
  onClear,
  onToggle
}: TicketFilterPopoverProps) {
  if (tickets.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2">
          <Filter className="h-3.5 w-3.5" />
          {selectedTicketIds.size > 0 ? (
            <Badge variant="secondary" className="h-4 min-w-4 rounded-full px-1 text-[10px]">
              {selectedTicketIds.size}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-xs font-medium">Filter by ticket</p>
          {selectedTicketIds.size > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="max-h-60 overflow-auto p-1">
          {tickets.map(ticket => {
            const isSelected = selectedTicketIds.has(ticket.id);
            return (
              <button
                key={ticket.id}
                type="button"
                onClick={() => onToggle(ticket.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition',
                  isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/30'
                  )}
                >
                  {isSelected ? (
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : null}
                </span>
                <span className="min-w-0 truncate">
                  {ticket.title?.trim() || `Ticket ${getTicketIdentifier(ticket)}`}
                </span>
                {ticket.status ? (
                  <span className="ml-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] text-muted-foreground">
                    {ticket.status}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
