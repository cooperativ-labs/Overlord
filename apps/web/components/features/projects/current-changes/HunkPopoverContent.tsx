import { Filter } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { getTicketIdentifier } from '@/lib/helpers/tickets';

import type { FileChangeRecord, TicketSummary } from './types';

type HunkPopoverContentProps = {
  fileTickets?: TicketSummary[];
  matches: FileChangeRecord[];
  projectId: string;
  onFilterByTicket?: (ticketId: string) => void;
};

export function HunkPopoverContent({
  fileTickets,
  matches,
  projectId,
  onFilterByTicket
}: HunkPopoverContentProps) {
  const matchedTickets = Array.from(
    new Map(
      matches
        .flatMap(match => (match.ticket ? [match.ticket] : []))
        .map(ticket => [ticket.id, ticket] as const)
    ).values()
  );
  const tickets = matchedTickets.length > 0 ? matchedTickets : (fileTickets ?? []);

  if (tickets.length === 0) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">No linked ticket yet</p>
        <p className="text-xs text-muted-foreground">
          No agent has recorded a rationale for this line yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {matchedTickets.length > 0
            ? tickets.length === 1
              ? 'Line linked to ticket'
              : 'Line linked to tickets'
            : tickets.length === 1
              ? 'File linked to ticket'
              : 'File linked to tickets'}
        </p>
        <p className="text-xs text-muted-foreground">
          {matchedTickets.length > 0
            ? 'An agent attributed this hunk to the ticket below.'
            : 'No rationale targets this exact hunk, so showing the file-level tickets instead.'}
        </p>
      </div>

      <div className="max-h-96 space-y-2 overflow-auto">
        {tickets.map(ticket => (
          <div key={ticket.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                href={buildTicketPath({ projectId, ticketId: ticket.id })}
              >
                {ticket.title?.trim() || `Ticket ${getTicketIdentifier(ticket)}`}
              </Link>
              {ticket.status ? (
                <Badge variant="outline" className="rounded-full text-[10px]">
                  {ticket.status}
                </Badge>
              ) : null}
              {onFilterByTicket ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 gap-1 px-2 text-[10px]"
                  onClick={() => onFilterByTicket(ticket.id)}
                >
                  <Filter className="h-3 w-3" />
                  Filter list
                </Button>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {ticket.objective?.trim() || 'No ticket objective yet.'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
