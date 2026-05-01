'use client';

import { Bot, Code2, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { KanbanTimerButton } from '@/components/features/everhour/KanbanTimerButton';
import { ScheduleBadge } from '@/components/features/scheduling/ScheduleBadge';
import { Badge } from '@/components/ui/badge';
import { ContextMenu, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { getAssignedAgentIdentifier } from '@/lib/helpers/ticket-assigned-agent';
import { getDisplayTitle } from '@/lib/helpers/tickets';
import { capitalizeFirst } from '@/lib/options';
import { cn } from '@/lib/utils';

import {
  ActiveAgentDisplay,
  AttentionIndicators,
  ObjectivesExecutedBadge,
  ProjectColorDot,
  TicketPriorityContextMenu
} from './TicketCardPrimitives';
import type { Ticket } from './KanbanCard';

const executionTargetConfig = {
  agent: {
    Icon: Bot,
    className: 'text-emerald-600 dark:text-emerald-400',
    title: 'Agent ticket'
  },
  human: {
    Icon: UserRound,
    className: 'text-amber-700 dark:text-amber-400',
    title: 'Human ticket'
  }
} as const;

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

  const isAgentRunning = ticket.has_executing_objective === true;
  const hasUnopenedWaitingResponse = ticket.has_unopened_waiting_response === true;
  const hasUnopenedReview = ticket.is_read === false;

  const activeAgentIdentifier =
    ticket.running_agent ??
    ticket.latest_objective_agent ??
    getAssignedAgentIdentifier(ticket.assigned_agent);
  const executedObjectivesCount = ticket.objectives_executed_count ?? 0;

  const { Icon: ExecutionIcon, className: executionIconClass, title: executionTitle } =
    executionTargetConfig[ticket.execution_target];

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
            'group relative flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-left transition-colors hover:bg-muted/40',
            'first:rounded-t-md last:rounded-b-md last:border-b-0',
            isAgentRunning && 'animate-pulse bg-emerald-500/5',
            isSelected && 'bg-gray-100/70 dark:bg-gray-950/25',
            hasUnopenedReview && 'bg-sky-50/60 dark:bg-sky-950/25'
          )}
        >
          {/* Running agent shimmer */}
          {isAgentRunning && (
            <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2s_linear_infinite] bg-linear-to-r from-transparent via-emerald-500/15 to-transparent" />
          )}

          {/* Left accent bar */}
          <div
            className={cn(
              'absolute left-0 top-0 h-full w-0.5 rounded-l-md',
              isAgentRunning && 'bg-emerald-500/60',
              hasUnopenedReview && !isAgentRunning && 'bg-sky-500/60',
              hasUnopenedWaitingResponse && !isAgentRunning && !hasUnopenedReview && 'bg-red-500/60'
            )}
          />

          {/* Project color dot */}
          <ProjectColorDot color={ticket.project_color} name={ticket.project_name} size="sm" />

          {/* Title + delegate */}
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium leading-snug">
              {getDisplayTitle(ticket)}
            </span>
            {ticket.delegate ? (
              <span className="flex items-center gap-0.5 text-[10px] text-orange-600 mt-0.5">
                <Bot className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate max-w-[140px]">Created by {ticket.delegate}</span>
              </span>
            ) : null}
          </div>

          {/* Right metadata row */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Code area placeholder — future feature */}
            <div
              className="flex h-5 w-5 items-center justify-center rounded opacity-20"
              title="Code area (coming soon)"
            >
              <Code2 className="h-3.5 w-3.5 text-muted-foreground" />
            </div>

            {/* Execution target icon only */}
            <span title={executionTitle} className="flex shrink-0 items-center">
              <ExecutionIcon className={cn('h-3.5 w-3.5', executionIconClass)} />
            </span>

            {/* Active agent + objectives count */}
            {(activeAgentIdentifier || executedObjectivesCount > 0) && (
              <div className="hidden items-center gap-1 sm:flex">
                <ActiveAgentDisplay identifier={activeAgentIdentifier} />
                <ObjectivesExecutedBadge count={executedObjectivesCount} />
              </div>
            )}

            {/* Status badge */}
            <Badge variant="outline" className="py-0 text-[11px]">
              {capitalizeFirst(ticket.status)}
            </Badge>

            {/* Schedule badge */}
            {ticket.schedule_id ? <ScheduleBadge /> : null}

            {/* Timer button */}
            {ticket.project_everhour_project_id ? (
              <span onClick={e => e.stopPropagation()}>
                <KanbanTimerButton
                  initialTaskId={ticket.everhour_task_id ?? null}
                  ticketId={ticket.id}
                />
              </span>
            ) : null}

            {/* Attention indicators */}
            <AttentionIndicators
              hasUnopenedWaitingResponse={hasUnopenedWaitingResponse}
              hasUnopenedReview={hasUnopenedReview}
            />
          </div>
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
