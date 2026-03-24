'use client';

import { ArrowDown, ArrowUp, Bot } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { KanbanTimerButton } from '@/components/features/everhour/KanbanTimerButton';
import { Badge } from '@/components/ui/badge';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import { updateTicketPriorityAction } from '@/lib/actions/tickets';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { getDisplayTitle } from '@/lib/helpers/tickets';
import { capitalizeFirst } from '@/lib/options';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

import { ExecutionTargetBadge } from './ExecutionTargetBadge';
import type { Ticket } from './KanbanCard';

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
  const [isPending, startTransition] = useTransition();
  const isHighPriority = ticket.priority === 'high';
  const isMediumPriority = ticket.priority === 'medium';
  const raiseDisabled = isPending || !isMediumPriority;
  const reduceDisabled = isPending || !isHighPriority;

  function handlePriorityChange(nextPriority: Database['public']['Enums']['ticket_priority']) {
    startTransition(async () => {
      await updateTicketPriorityAction(ticket.id, nextPriority);
    });
  }

  const isAgentRunning = ticket.agent_session_state === 'attached';
  const hasUnopenedWaitingResponse = ticket.has_unopened_waiting_response === true;
  const hasUnopenedReview = ticket.is_read === false;

  const activeAgentIdentifier =
    ticket.running_agent ?? ticket.recent_agent ?? ticket.assigned_agent;
  const activeAgentType = getAgentTypeByIdentifier(activeAgentIdentifier);
  const executedObjectivesCount = ticket.objectives_executed_count ?? 0;

  const ProjectColorDot = ticket.project_color ? (
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
  );

  const ActiveAgentDisplay =
    activeAgentIdentifier || executedObjectivesCount > 0 ? (
      <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
        {activeAgentIdentifier ? (
          activeAgentType ? (
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
          )
        ) : null}
        {executedObjectivesCount > 0 ? (
          <span
            className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-muted-foreground/30 bg-muted px-1 text-[10px] font-medium text-muted-foreground"
            title={`${executedObjectivesCount} objective${executedObjectivesCount === 1 ? '' : 's'} executed`}
            aria-label={`${executedObjectivesCount} objective${executedObjectivesCount === 1 ? '' : 's'} executed`}
          >
            {executedObjectivesCount}
          </span>
        ) : null}
      </div>
    ) : null;

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
              {ProjectColorDot}
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
              {ActiveAgentDisplay}
              <Badge variant="outline" className="py-0 text-[11px]">
                {capitalizeFirst(ticket.status)}
              </Badge>
              <ExecutionTargetBadge executionTarget={ticket.execution_target} />
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
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => handlePriorityChange('high')} disabled={raiseDisabled}>
          <ArrowUp className="h-3.5 w-3.5" />
          Raise priority
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => handlePriorityChange('medium')} disabled={reduceDisabled}>
          <ArrowDown className="h-3.5 w-3.5" />
          Reduce priority
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onMarkUnread?.(ticket.id)} disabled={!onMarkUnread}>
          Mark card unread
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
