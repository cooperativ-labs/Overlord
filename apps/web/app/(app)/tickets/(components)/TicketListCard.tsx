'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bot, Check, GripVertical, Tag, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { KanbanTimerButton } from '@/components/features/everhour/KanbanTimerButton';
import { ScheduleBadge } from '@/components/features/scheduling/ScheduleBadge';
import { ContextMenu, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { getDisplayTitle } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';
import type { Ticket } from '@/types/tickets';

import { ObjectivesExecutedBadge } from './ObjectivesExecutedBadge';
import {
  AttentionIndicators,
  ProjectColorDot,
  TicketPriorityContextMenu
} from './TicketCardPrimitives';

function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const normalized = value.trim();
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;

  if (hex.length === 3) {
    const [r, g, b] = hex.split('');
    if (!r || !g || !b) return null;
    return {
      r: Number.parseInt(r + r, 16),
      g: Number.parseInt(g + g, 16),
      b: Number.parseInt(b + b, 16)
    };
  }

  if (hex.length === 6) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16)
    };
  }

  return null;
}

function getTicketCheckboxColors(projectColor: string | null | undefined) {
  if (!projectColor) {
    return {
      borderColor: undefined,
      backgroundColor: undefined,
      completedBackgroundColor: undefined,
      checkColor: undefined
    };
  }

  const rgb = parseHexColor(projectColor);
  if (!rgb) {
    return {
      borderColor: projectColor,
      backgroundColor: `${projectColor}22`,
      completedBackgroundColor: projectColor,
      checkColor: '#ffffff'
    };
  }

  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  const foreground = luminance > 0.6 ? '#111827' : '#ffffff';
  const tintedBackground = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.14)`;

  return {
    borderColor: projectColor,
    backgroundColor: tintedBackground,
    completedBackgroundColor: projectColor,
    checkColor: foreground
  };
}

const executionTargetConfig = {
  false: {
    Icon: Bot,
    className: 'text-emerald-600 dark:text-emerald-400',
    title: 'Agent ticket'
  },
  true: {
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
  completeStatusName,
  onCompleteTicket,
  onMarkUnread,
  onDragStart,
  onDragEnd
}: {
  ticket: Ticket;
  ticketPath: string;
  isSelected: boolean;
  showOrganizationName?: boolean;
  showProjectName?: boolean;
  completeStatusName?: string;
  onCompleteTicket?: (ticketId: string) => void;
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
  const normalizedTicketStatus = ticket.status.trim().toLowerCase();
  const normalizedCompleteStatus = completeStatusName?.trim().toLowerCase();
  const isComplete =
    normalizedCompleteStatus !== undefined && normalizedTicketStatus === normalizedCompleteStatus;
  const checkboxColors = getTicketCheckboxColors(ticket.project_color);

  const {
    Icon: ExecutionIcon,
    className: executionIconClass,
    title: executionTitle
  } = executionTargetConfig[String(ticket.for_human) as 'true' | 'false'];

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
            'group relative flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-muted/40 hover:border-border overflow-hidden',
            isAgentRunning && 'animate-pulse',
            isDragging && 'opacity-40',
            isSelected && 'bg-muted/50 border-border',
            hasUnopenedReview && 'bg-sky-50/40 dark:bg-sky-950/15',
            isComplete && 'opacity-60 saturate-0'
          )}
        >
          {/* Running agent shimmer */}
          {isAgentRunning && (
            <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2s_linear_infinite] overflow-hidden rounded-md bg-linear-to-r from-transparent via-emerald-500/20 to-transparent" />
          )}

          {/* Drag handle — activates dnd-kit within-group reorder */}
          <span
            ref={setActivatorNodeRef}
            {...listeners}
            className="flex h-3.5 w-3 shrink-0 cursor-grab items-center justify-center text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>

          {completeStatusName ? (
            <button
              type="button"
              aria-label={isComplete ? 'Ticket completed' : 'Mark ticket complete'}
              aria-pressed={isComplete}
              disabled={isComplete}
              className={cn(
                'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                isComplete ? '' : 'text-transparent',
                isComplete && 'cursor-default'
              )}
              style={{
                borderColor: ticket.project_color ? checkboxColors.borderColor : undefined,
                backgroundColor:
                  isComplete && ticket.project_color
                    ? checkboxColors.completedBackgroundColor
                    : ticket.project_color
                      ? checkboxColors.backgroundColor
                      : undefined,
                color: isComplete && ticket.project_color ? checkboxColors.checkColor : undefined
              }}
              title={ticket.project_name ?? 'Project'}
              onPointerDown={e => {
                e.stopPropagation();
              }}
              onClick={e => {
                e.stopPropagation();
                if (!isComplete) {
                  onCompleteTicket?.(ticket.id);
                }
              }}
            >
              <Check className="h-3 w-3" />
            </button>
          ) : (
            <ProjectColorDot color={ticket.project_color} name={ticket.project_name} size="sm" />
          )}

          {/* Title + delegate + tags */}
          <div className="min-w-0 flex-1">
            <span
              className={cn(
                'block truncate text-[13px] font-medium leading-snug text-fg1',
                isComplete && 'text-fg3'
              )}
            >
              {getDisplayTitle(ticket)}
            </span>
            {ticket.tags && ticket.tags.length > 0 ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                {ticket.tags.map(tag => (
                  <span
                    key={tag.id}
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
            <span
              className="text-[10px] tabular-nums text-fg3"
              title={`Ticket ID: ${ticket.ticket_id}`}
            >
              {ticket.ticket_id}
            </span>
            {/* Agent-created badge */}
            {ticket.delegate ? (
              <span
                title={`${ticket.delegate} created this ticket`}
                className="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-orange-400/10 text-orange-600 border border-orange-400/30"
              >
                <Bot className="h-2.5 w-2.5 shrink-0" />
                <span>created</span>
              </span>
            ) : null}
            {/* Project name (cross-project list views) */}
            {showProjectName && ticket.project_name ? (
              <span className="hidden truncate max-w-[100px] text-[10px] text-fg3 sm:inline">
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

            <ObjectivesExecutedBadge
              count={ticket.objectives_executed_count}
              hasDraftObjectiveWithText={ticket.has_draft_objective_with_text}
            />

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
