import Link from 'next/link';

import { buildTicketPath } from '@/lib/helpers/ticket-path';

import type { FileChangeRecord, TicketSummary } from './types';

type HunkPopoverContentProps = {
  fileTickets?: TicketSummary[];
  matches: FileChangeRecord[];
  projectId: string;
};

export function HunkPopoverContent({ fileTickets, matches, projectId }: HunkPopoverContentProps) {
  if (matches.length === 0) {
    if (fileTickets && fileTickets.length > 0) {
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium">No rationale for this hunk</p>
          <p className="text-xs text-muted-foreground">
            This hunk doesn&apos;t have a specific rationale, but the file was changed by{' '}
            {fileTickets.length === 1 ? 'this ticket' : 'these tickets'}:
          </p>
          <div className="space-y-1">
            {fileTickets.map(ticket => (
              <Link
                key={ticket.id}
                className="block rounded-md border px-3 py-2 text-xs font-medium text-primary hover:bg-muted/60"
                href={buildTicketPath({ projectId, ticketId: ticket.id })}
              >
                {ticket.title?.trim() || `Ticket ${ticket.id.slice(-8)}`}
              </Link>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">No rationale recorded</p>
        <p className="text-xs text-muted-foreground">
          This changed hunk does not have a linked Overlord rationale yet.
        </p>
      </div>
    );
  }

  return (
    <div className="max-h-96 space-y-3 overflow-auto">
      {matches.map(match => (
        <div key={match.id} className="space-y-2 rounded-lg border p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">{match.label}</p>
              <p className="text-xs text-muted-foreground">{match.summary}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {match.confidence}
              </span>
            </div>
          </div>
          <div className="space-y-1 text-xs">
            <p>
              <span className="font-medium text-foreground">Why:</span> {match.why}
            </p>
            <p>
              <span className="font-medium text-foreground">Impact:</span> {match.impact}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {match.ticket ? (
              <>
                <Link
                  className="rounded underline-offset-4 hover:underline"
                  href={buildTicketPath({ projectId, ticketId: match.ticket.id })}
                >
                  {match.ticket.title?.trim() || `Ticket ${match.ticket.id.slice(-8)}`}
                </Link>
                <span className="rounded-full border px-1.5 py-0.5 text-[9px]">
                  {match.ticket.status}
                </span>
              </>
            ) : null}
            {match.event ? <span>{match.event.event_type}</span> : null}
            {match.session ? <span>{match.session.agent_identifier}</span> : null}
            <span>{new Date(match.created_at).toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
