'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bot, GripVertical, Tag, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { KanbanTimerButton } from '@/components/features/everhour/KanbanTimerButton';
import { ScheduleBadge } from '@/components/features/scheduling/ScheduleBadge';
import { ContextMenu, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { getDisplayTitle } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';

import type { Ticket } from './KanbanCard';
import {
  AttentionIndicators,
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
  onDragStart?: (ticketId: string, event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
}) {
  const router = useRouter();
  const { listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: ticket.id });
  const sortableStyle = { transform: CSS.Transform.toString(transform), transition };

  const isAgentRunning = ticket.has_executing_objective === true;
  const hasUnopenedWaitingResponse = ticket.has_unopened_waiting_response === true;
  const hasUnopenedReview = ticket.is_read === false;

  const {
    Icon: ExecutionIcon,
    className: executionIconClass,
    title: executionTitle
  } = executionTargetConfig[ticket.execution_target];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          draggable={Boolean(onDragStart)}
          onDragStart={event => onDragStart?.(ticket.id, event)}
          onDragEnd={() => onDragEnd?.()}
          onClick={() => router.push(ticketPath)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') router.push(ticketPath);
          }}
          aria-label={`Open ticket: ${getDisplayTitle(ticket)}`}
          style={sortableStyle}
          className={cn(
            'group relative flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-muted/40 hover:border-border',
            isAgentRunning && 'animate-pulse',
            isDragging && 'opacity-40',
            isSelected && 'bg-muted/50 border-border',
            hasUnopenedReview && 'bg-sky-50/40 dark:bg-sky-950/15'
          )}
        >
          {/* Running agent shimmer */}
          {isAgentRunning && (
            <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2s_linear_infinite] overflow-hidden rounded-md bg-linear-to-r from-transparent via-emerald-500/10 to-transparent" />
          )}

          {/* Drag handle — activates dnd-kit within-group reorder */}
          <span
            ref={setActivatorNodeRef}
            {...listeners}
            className="flex h-3.5 w-3 shrink-0 cursor-grab items-center justify-center text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>

          {/* Project color dot */}
          <ProjectColorDot color={ticket.project_color} name={ticket.project_name} size="sm" />

          {/* Title + delegate + tags */}
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
            {ticket.tags && ticket.tags.length > 0 ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                {ticket.tags.map(tag => (
                  <span
                    key={tag.tagDefinitionId}
                    className="inline-flex items-center gap-0.5 rounded px-1 py-0 text-[10px] font-medium text-muted-foreground bg-muted"
                    style={
                      tag.color
                        ? { backgroundColor: `${tag.color}22`, color: tag.color }
                        : undefined
                    }
                  >
                    <Tag className="h-2 w-2 shrink-0" />
                    {tag.label}
                  </span>
                ))}
              </div>
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
