'use client';

import { Activity } from 'lucide-react';
import Link from 'next/link';

import { AgentIcon } from '@/components/features/AgentIcon';
import type { ExecutingFeedTicket } from '@/lib/actions/feed';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { buildTicketPath } from '@/lib/helpers/ticket-path';

type ExecutingTicketsSectionProps = {
  tickets: ExecutingFeedTicket[];
};

export function ExecutingTicketsSection({ tickets }: ExecutingTicketsSectionProps) {
  if (tickets.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
        <Activity className="h-4 w-4 text-emerald-600" />
        <span>In execution</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {tickets.map(ticket => {
          const ticketPath = buildTicketPath({ projectId: ticket.project_id, ticketId: ticket.id });
          const agentType = getAgentTypeByIdentifier(ticket.running_agent);

          return (
            <Link
              key={ticket.id}
              href={ticketPath}
              className="group rounded-lg border border-emerald-500/20 bg-card px-4 py-3 transition-colors hover:border-emerald-500/40 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/10"
            >
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: ticket.project_color }}
                />
                <span className="truncate">{ticket.project_name}</span>
              </div>

              <p className="line-clamp-2 text-sm font-medium leading-5 text-foreground">
                {ticket.ticket_id ? `${ticket.ticket_id} ` : ''}
                {ticket.title ?? 'Untitled ticket'}
              </p>

              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                {agentType ? (
                  <>
                    <AgentIcon
                      agentType={agentType}
                      size={12}
                      alt={`${agentType.label} icon`}
                      className="h-3 w-3 shrink-0"
                    />
                    <span>{agentType.label}</span>
                  </>
                ) : (
                  <span>{ticket.running_agent}</span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
