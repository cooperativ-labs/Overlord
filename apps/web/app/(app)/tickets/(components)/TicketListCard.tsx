'use client';

import { Bot, GripVertical, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { KanbanTimerButton } from '@/components/features/everhour/KanbanTimerButton';
import { ScheduleBadge } from '@/components/features/scheduling/ScheduleBadge';
import { ContextMenu, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { getAssignedAgentIdentifier } from '@/lib/helpers/ticket-assigned-agent';
import { getDisplayTitle } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';

import type { Ticket } from './KanbanCard';
import {
  ActiveAgentDisplay,
  AttentionIndicators,
  ObjectivesExecutedBadge,
  ProjectColorDot,
  TicketPriorityContextMenu
} from './TicketCardPrimitives';

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
  showProjectName = false,
  onMarkUnread,
  onDragStart,
  onDragEnd
}: {
  ticket: Ticket;
  ticketPath: string;
  isSelected: boolean;
  showOrganizationName?: boolean;
  showProjectName?: boolean;
  onMarkUnread?: (ticketId: string) => void;
  onDragStart?: (ticketId: string) => void;
  onDragEnd?: () => void;
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

  const {
    Icon: ExecutionIcon,
    className: executionIconClass,
    title: executionTitle
  } = executionTargetConfig[ticket.execution_target];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          draggable={Boolean(onDragStart)}
          onDragStart={() => onDragStart?.(ticket.id)}
          onDragEnd={() => onDragEnd?.()}
          onClick={() => router.push(ticketPath)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') router.push(ticketPath);
          }}
          aria-label={`Open ticket: ${getDisplayTitle(ticket)}`}
          className={cn(
            'group relative flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-muted/40 hover:border-border',
            isAgentRunning && 'animate-pulse',
            isSelected && 'bg-muted/50 border-border',
            hasUnopenedReview && 'bg-sky-50/40 dark:bg-sky-950/15'
          )}
        >
          {/* Running agent shimmer */}
          {isAgentRunning && (
            <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2s_linear_infinite] overflow-hidden rounded-md bg-linear-to-r from-transparent via-emerald-500/10 to-transparent" />
          )}

          {/* Drag handle (appears on hover) */}
          <span className="flex h-3.5 w-3 shrink-0 items-center justify-center text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100">
            <GripVertical className="h-3.5 w-3.5" />
          </span>

          {/* Project color dot */}
          <ProjectColorDot color={ticket.project_color} name={ticket.project_name} size="sm" />

          {/* Title + delegate */}
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-snug">
              {getDisplayTitle(ticket)}
            </span>
            {ticket.delegate ? (
              <span className="mt-0.5 flex items-center gap-0.5 text-[10px] text-orange-600">
                <Bot className="h-2.5 w-2.5 shrink-0" />
                <span className="max-w-[140px] truncate">Created by {ticket.delegate}</span>
              </span>
            ) : null}
          </div>

          {/* Right metadata row */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Project name (cross-project list views) */}
            {showProjectName && ticket.project_name ? (
              <span className="hidden truncate max-w-[100px] text-[10px] text-muted-foreground sm:inline">
                {ticket.project_name}
              </span>
            ) : null}

            {/* Running agent dot */}
            {isAgentRunning && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_4px_rgb(16,185,129)]"
                title="Agent running"
              />
            )}

            {/* Active agent + objectives count */}
            {(activeAgentIdentifier || executedObjectivesCount > 0) && (
              <div className="hidden items-center gap-1 sm:flex">
                <ActiveAgentDisplay identifier={activeAgentIdentifier} />
                <ObjectivesExecutedBadge count={executedObjectivesCount} />
              </div>
            )}

            {/* Execution target icon */}
            <span title={executionTitle} className="flex shrink-0 items-center opacity-70">
              <ExecutionIcon className={cn('h-3.5 w-3.5', executionIconClass)} />
            </span>

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
