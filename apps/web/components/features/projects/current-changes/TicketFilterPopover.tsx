import { Filter } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';

import { ticketReviewHighlightClasses } from './helpers';
import type { TicketSummary } from './types';

type TicketFilterPopoverProps = {
  fileCountsByTicketId: Map<string, number>;
  selectedTicketIds: Set<string>;
  tickets: TicketSummary[];
  onClear: () => void;
  onToggle: (ticketId: string) => void;
};

function ticketLabel(ticket: TicketSummary): string {
  const title = ticket.title?.trim();
  if (title) return title;
  return `Ticket ${getTicketIdentifier(ticket)}`;
}

export function TicketFilterPopover({
  fileCountsByTicketId,
  selectedTicketIds,
  tickets,
  onClear,
  onToggle
}: TicketFilterPopoverProps) {
  if (tickets.length === 0) return null;

  const triggerLabel =
    selectedTicketIds.size === 0
      ? 'Filter'
      : selectedTicketIds.size === 1
        ? '1 ticket'
        : `${selectedTicketIds.size} tickets`;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant={selectedTicketIds.size > 0 ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs"
            >
              <Filter className="h-3.5 w-3.5" />
              <span>{triggerLabel}</span>
              {selectedTicketIds.size > 0 ? (
                <Badge variant="default" className="h-4 min-w-4 rounded-full px-1 text-[10px]">
                  {selectedTicketIds.size}
                </Badge>
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Filter changes by ticket</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div>
            <p className="text-xs font-medium">Filter by ticket</p>
            <p className="text-[10px] text-muted-foreground">
              Show only files attributed to the selected tickets.
            </p>
          </div>
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
        <div className="max-h-72 overflow-auto p-1">
          {tickets.map(ticket => {
            const isSelected = selectedTicketIds.has(ticket.id);
            const fileCount = fileCountsByTicketId.get(ticket.id) ?? 0;
            const identifier = getTicketIdentifier(ticket);
            return (
              <button
                key={ticket.id}
                type="button"
                onClick={() => onToggle(ticket.id)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition',
                  ticketReviewHighlightClasses(ticket.status_type),
                  isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
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
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {identifier ? (
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {identifier}
                      </span>
                    ) : null}
                    <span className="truncate font-medium">{ticketLabel(ticket)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                    {ticket.status ? (
                      <span
                        className={cn(
                          'rounded-full border px-1.5 py-0.5 leading-none',
                          ticket.status_type === 'review' &&
                            'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100'
                        )}
                      >
                        {ticket.status}
                      </span>
                    ) : null}
                    <span>
                      {fileCount} {fileCount === 1 ? 'file' : 'files'}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
