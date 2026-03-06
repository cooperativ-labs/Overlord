'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';

import { CopyTicketPromptButton } from '@/components/features/CopyTicketPromptButton';
import { KanbanTimerButton } from '@/components/features/everhour/KanbanTimerButton';
import { Badge } from '@/components/ui/badge';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { getDisplayTitle } from '@/lib/helpers/tickets';
import { capitalizeFirst, getOptionLabel, ticketExecutionTargetOptions } from '@/lib/options';
import { cn } from '@/lib/utils';

import type { Ticket } from './KanbanCard';

export default function TicketListCard({
  ticket,
  ticketPath,
  isSelected,
  showOrganizationName = false
}: {
  ticket: Ticket;
  ticketPath: string;
  isSelected: boolean;
  showOrganizationName?: boolean;
}) {
  const router = useRouter();

  const isAgentRunning = ticket.agent_session_state === 'attached';
  const hasUnopenedWaitingResponse = ticket.has_unopened_waiting_response === true;
  const hasUnopenedReview = ticket.has_unopened_review === true;

  const activeAgentIdentifier =
    ticket.running_agent ?? ticket.recent_agent ?? ticket.assigned_agent;
  const activeAgentType = getAgentTypeByIdentifier(activeAgentIdentifier);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(ticketPath)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') router.push(ticketPath);
      }}
      aria-label={`Open ticket: ${getDisplayTitle(ticket)}`}
      className={cn(
        'group relative flex cursor-pointer items-center gap-2.5 overflow-hidden rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50',
        isAgentRunning && 'animate-pulse border-emerald-500/40',
        isSelected && 'border-gray-500/40 bg-gray-100/70 dark:bg-gray-950/25',
        hasUnopenedReview && 'border-sky-500/40 bg-sky-50/60 dark:bg-sky-950/25'
      )}
    >
      {/* Shimmer for running agent */}
      {isAgentRunning && (
        <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2s_linear_infinite] bg-linear-to-r from-transparent via-emerald-500/20 to-transparent" />
      )}

      {/* Project color dot */}
      {ticket.project_color ? (
        <span
          className="block h-2 w-2 shrink-0 rounded-[2px] border"
          style={{ backgroundColor: ticket.project_color, borderColor: ticket.project_color }}
          title={ticket.project_name ?? 'Project'}
        />
      ) : (
        <span
          className="block h-2 w-2 shrink-0 rounded-[2px] border border-muted-foreground/50"
          title="No project"
        />
      )}

      {/* Title + meta */}
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{getDisplayTitle(ticket)}</span>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="py-0 text-[11px]">
            {capitalizeFirst(ticket.status)}
          </Badge>
          <Badge variant="outline" className="py-0 text-[11px]">
            {getOptionLabel(ticketExecutionTargetOptions, ticket.execution_target)}
          </Badge>
          {/* {showOrganizationName && ticket.organization_name ? (
            <span className="text-muted-foreground text-[11px]">{ticket.organization_name}</span>
          ) : null} */}
          {ticket.updated_at ? (
            <span className="text-muted-foreground text-[11px]">
              {new Date(ticket.updated_at).toLocaleString()}
            </span>
          ) : null}
        </div>
      </div>

      {/* Agent label */}
      {activeAgentIdentifier ? (
        <div className="hidden shrink-0 sm:block">
          {activeAgentType ? (
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <Image
                src={activeAgentType.icon}
                alt={`${activeAgentType.label} icon`}
                width={12}
                height={12}
                className="h-3 w-3 shrink-0"
              />
              <span>{activeAgentType.label}</span>
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground/70">{activeAgentIdentifier}</p>
          )}
        </div>
      ) : null}

      {/* Status dots */}
      {(hasUnopenedWaitingResponse || hasUnopenedReview) && (
        <span className="flex shrink-0 items-center gap-1">
          {hasUnopenedWaitingResponse && (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-red-500 ring-1 ring-background"
              title="Agent is waiting for your response"
            />
          )}
          {hasUnopenedReview && (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-sky-500 ring-1 ring-background"
              title="Moved to review and unopened"
            />
          )}
        </span>
      )}

      {/* Everhour timer button — stops propagation internally via KanbanTimerButton */}
      {ticket.project_everhour_project_id ? (
        <span onClick={e => e.stopPropagation()}>
          <KanbanTimerButton initialTaskId={ticket.everhour_task_id ?? null} ticketId={ticket.id} />
        </span>
      ) : null}

    </div>
  );
}
