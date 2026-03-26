'use client';

import { Bot } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { KanbanTimerButton } from '@/components/features/everhour/KanbanTimerButton';
import { ScheduleBadge } from '@/components/features/scheduling/ScheduleBadge';
import { Badge } from '@/components/ui/badge';
import { ContextMenu, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { getAssignedAgentIdentifier } from '@/lib/helpers/ticket-assigned-agent';
import { getDisplayTitle } from '@/lib/helpers/tickets';
import { capitalizeFirst } from '@/lib/options';
import { cn } from '@/lib/utils';

import { ExecutionTargetBadge } from './ExecutionTargetBadge';
import type { Ticket } from './KanbanCard';
import {
  ActiveAgentDisplay,
  AttentionIndicators,
  ObjectivesExecutedBadge,
  ProjectColorDot,
  TicketPriorityContextMenu
} from './TicketCardPrimitives';

export default function TicketListCard({
  ticket,
  ticketPath,
  isSelected,
  showOrganizationName: _showOrganizationName = false,
  onMarkUnread
}: {
  ticket: Ticket;
  ticketPath: string;
  isSelected: boolean;
  showOrganizationName?: boolean;
  onMarkUnread?: (ticketId: string) => void;
}) {
  const router = useRouter();

  const isAgentRunning = ticket.agent_session_state === 'attached';
  const hasUnopenedWaitingResponse = ticket.has_unopened_waiting_response === true;
  const hasUnopenedReview = ticket.is_read === false;

  const activeAgentIdentifier =
    ticket.running_agent ??
    ticket.recent_agent ??
    getAssignedAgentIdentifier(ticket.assigned_agent);
  const executedObjectivesCount = ticket.objectives_executed_count ?? 0;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={() => router.push(ticketPath)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') router.push(ticketPath);
          }}
          aria-label={`Open ticket: ${getDisplayTitle(ticket)}`}
          className={cn(
            'group relative flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50 ',
            isAgentRunning && 'animate-pulse border-emerald-500/40',
            isSelected && 'border-gray-500/40 bg-gray-100/70 dark:bg-gray-950/25',
            hasUnopenedReview && 'border-sky-500/40 bg-sky-50/60 dark:bg-sky-950/25'
          )}
        >
          {/* Shimmer for running agent */}
          {isAgentRunning && (
            <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2s_linear_infinite] bg-linear-to-r from-transparent via-emerald-500/20 to-transparent" />
          )}

          {/* Title + meta */}
          <div className="min-w-0 flex-1 flex flex-col gap-1">
            <span className="flex items-center gap-2 truncate text-sm font-medium">
              <ProjectColorDot color={ticket.project_color} name={ticket.project_name} size="sm" />
              {getDisplayTitle(ticket)}
            </span>
            <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden">
              <div>
                {ticket.project_everhour_project_id ? (
                  <span onClick={e => e.stopPropagation()}>
                    <KanbanTimerButton
                      initialTaskId={ticket.everhour_task_id ?? null}
                      ticketId={ticket.id}
                    />
                  </span>
                ) : null}
              </div>
              {(activeAgentIdentifier || executedObjectivesCount > 0) && (
                <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                  <ActiveAgentDisplay identifier={activeAgentIdentifier} />
                  <ObjectivesExecutedBadge count={executedObjectivesCount} />
                </div>
              )}
              <Badge variant="outline" className="py-0 text-[11px]">
                {capitalizeFirst(ticket.status)}
              </Badge>
              <ExecutionTargetBadge executionTarget={ticket.execution_target} />
              {ticket.schedule_id ? <ScheduleBadge /> : null}
            </div>
            {ticket.delegate ? (
              <div
                className="mt-1 flex items-center gap-0.5 text-[10px] text-orange-600"
                title={`Created by agent: ${ticket.delegate}`}
              >
                <Bot className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate max-w-[140px]">Created by {ticket.delegate}</span>
              </div>
            ) : null}
          </div>

          {/* Attention indicators */}
          <AttentionIndicators
            hasUnopenedWaitingResponse={hasUnopenedWaitingResponse}
            hasUnopenedReview={hasUnopenedReview}
            className="shrink-0"
          />
        </div>
      </ContextMenuTrigger>
      <TicketPriorityContextMenu
        ticketId={ticket.id}
        priority={ticket.priority}
        extraItems={
          <ContextMenuItem onSelect={() => onMarkUnread?.(ticket.id)} disabled={!onMarkUnread}>
            Mark card unread
          </ContextMenuItem>
        }
      />
    </ContextMenu>
  );
}
