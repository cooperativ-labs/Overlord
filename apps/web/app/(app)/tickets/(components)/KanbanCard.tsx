'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bot, Tag } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';

import { DeleteTicketButton } from '@/components/features/DeleteTicketButton';
import { KanbanTimerButton } from '@/components/features/everhour/KanbanTimerButton';
import { ScheduleBadge } from '@/components/features/scheduling/ScheduleBadge';
import { Card, CardContent } from '@/components/ui/card';
import { ContextMenu, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { getDisplayTitle } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';
import type { Ticket } from '@/types/tickets';

import { ExecutionTargetBadge } from './ExecutionTargetBadge';
import { IsHumanToggle } from './IsHumanToggle';
import { KanbanCardTagSelector } from './KanbanCardTagSelector';
import { ObjectivesExecutedBadge } from './ObjectivesExecutedBadge';
import {
  AttentionIndicators,
  ProjectColorDot,
  TicketAssigneeAvatar,
  TicketPriorityContextMenu
} from './TicketCardPrimitives';

export default function KanbanCard({
  ticket,
  isDragOverlay,
  showOrganizationName = false,
  onMarkRead,
  onMarkUnread
}: {
  ticket: Ticket;
  isDragOverlay?: boolean;
  showOrganizationName?: boolean;
  onMarkRead?: (ticketId: string) => void;
  onMarkUnread?: (ticketId: string) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
    disabled: isDragOverlay
  });

  if (isDragOverlay) {
    return (
      <div className="w-full rounded-md border border-dashed border-primary/40 bg-card shadow-lg">
        <KanbanCardBody ticket={ticket} showOrganizationName={showOrganizationName} />
      </div>
    );
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  const isAgentRunning = ticket.has_executing_objective === true;
  const hasUnopenedWaitingResponse = ticket.has_unopened_waiting_response === true;
  const hasUnopenedReview = ticket.is_read === false;

  const isOnUserPage = pathname === '/u' || pathname.startsWith('/u/');
  const ticketPath = isOnUserPage
    ? `/u/${ticket.id}`
    : buildTicketPath({ projectId: ticket.project_id, ticketId: ticket.id });
  const isSelected = pathname === ticketPath;

  const isUnread = ticket.is_read === false;
  const markReadLabel = isUnread ? 'Mark read' : 'Mark unread';
  const markReadDisabled = isUnread ? !onMarkRead : !onMarkUnread;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Card
          ref={setNodeRef}
          aria-label={`Open ticket: ${getDisplayTitle(ticket)}`}
          className={cn(
            'group relative cursor-grab border-gray-300/60 dark:border-gray-700/40 bg-linear-to-br from-gray-300/5 to-transparent overflow-hidden transition-all hover:shadow-md rounded-md',
            isDragging ? 'opacity-40' : '',
            isAgentRunning && 'animate-pulse border-emerald-500/40',
            isSelected &&
              'border-gray-600/60 dark:border-gray-500/70 bg-gray-100/90 dark:bg-gray-900/40',
            hasUnopenedReview &&
              'border-sky-500/40 bg-sky-50/60 bg-linear-to-br from-sky-300/18 to-transparent dark:bg-sky-950/25'
          )}
          style={style}
          onClick={() => router.push(ticketPath)}
          {...listeners}
          {...attributes}
        >
          <AttentionIndicators
            hasUnopenedWaitingResponse={hasUnopenedWaitingResponse}
            hasUnopenedReview={hasUnopenedReview}
            className="absolute right-2 top-2 z-10"
          />
          {isAgentRunning && (
            <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2s_linear_infinite] bg-linear-to-r from-transparent via-emerald-500/20 to-transparent" />
          )}
          <KanbanCardBody ticket={ticket} showOrganizationName={showOrganizationName} />
        </Card>
      </ContextMenuTrigger>
      <TicketPriorityContextMenu
        ticketId={ticket.id}
        priority={ticket.priority}
        extraItems={
          <ContextMenuItem
            onSelect={() => {
              if (isUnread) {
                onMarkRead?.(ticket.id);
              } else {
                onMarkUnread?.(ticket.id);
              }
            }}
            disabled={markReadDisabled}
          >
            {markReadLabel}
          </ContextMenuItem>
        }
      />
    </ContextMenu>
  );
}

function KanbanCardBody({
  ticket,
  showOrganizationName
}: {
  ticket: Ticket;
  showOrganizationName: boolean;
}) {
  return (
    <CardContent className="flex h-full flex-col p-0 pt-3  ">
      <div className="px-3 space-y-3">
        <div className="min-w-0">
          <h4 className="text-sm leading-snug font-medium text-fg1">{getDisplayTitle(ticket)}</h4>

          <div className="mt-4 flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <ProjectColorDot color={ticket.project_color} name={ticket.project_name} />
              {ticket.project_id ? (
                <span className="truncate text-[11px] text-fg3">{ticket.project_name}</span>
              ) : (
                <span className="text-[11px] text-fg3">Inbox</span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <TicketAssigneeAvatar assignee={ticket.assignee} />
              <ExecutionTargetBadge forHuman={ticket.for_human} className="text-xs" />
              {ticket.schedule_id ? <ScheduleBadge /> : null}
              <ObjectivesExecutedBadge
                count={ticket.objectives_executed_count}
                hasDraftObjectiveWithText={ticket.has_draft_objective_with_text}
              />
            </div>
          </div>
          {showOrganizationName && ticket.organization_name ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{ticket.organization_name}</p>
          ) : null}
        </div>
        {ticket.tags && ticket.tags.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {ticket.tags.map(tag => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-0.5 rounded px-1 py-0 text-[10px] font-medium text-muted-foreground bg-muted"
                style={
                  tag.color ? { backgroundColor: `${tag.color}22`, color: tag.color } : undefined
                }
              >
                <Tag className="h-2 w-2 shrink-0" />
                {tag.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {ticket.delegate ? (
        <div className="mt-2 flex items-center bg-orange-400/10 gap-1 border-t border-orange-400/60 px-3  text-orange-600 py-1">
          <Bot className="h-2.5 w-2.5 shrink-0 " />
          <span className="text-[10px] truncate">Created by {ticket.delegate}</span>
        </div>
      ) : (
        <div className="h-2" />
      )}
      <KanbanCardHoverFooter ticket={ticket} ticket_id={ticket.ticket_id} />
    </CardContent>
  );
}

function KanbanCardHoverFooter({
  ticket,
  ticket_id
}: {
  ticket: Ticket;
  ticket_id?: string | null;
}) {
  const stopPropagation = (event: React.MouseEvent | React.PointerEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className={cn(
        'grid grid-rows-[0fr] opacity-0 transition-all duration-150 ease-out',
        'group-hover:grid-rows-[1fr] group-hover:opacity-100',
        'focus-within:grid-rows-[1fr] focus-within:opacity-100'
      )}
      onClick={stopPropagation}
      onPointerDown={stopPropagation}
    >
      <div className="overflow-hidden">
        <div className="flex items-center gap-1.5 border-t border-border/60 bg-muted/80 px-2 py-1">
          {ticket.project_everhour_project_id ? (
            <KanbanTimerButton
              initialTaskId={ticket.everhour_task_id ?? null}
              ticketId={ticket.id}
            />
          ) : null}

          <IsHumanToggle ticketId={ticket.id} forHuman={ticket.for_human} />

          <KanbanCardTagSelector
            ticketId={ticket.id}
            projectId={ticket.project_id}
            tags={ticket.tags ?? []}
          />

          <div className="ml-auto flex items-center gap-1.5">
            <span
              className="text-[10px] tabular-nums text-muted-foreground"
              title={`Ticket ID: ${ticket_id}`}
            >
              {ticket_id}
            </span>
            <DeleteTicketButton
              ticketId={ticket.id}
              ticketLabel={getDisplayTitle(ticket)}
              className="h-6 w-6 border-0 bg-transparent text-muted-foreground hover:bg-transparent hover:text-red-500 [&_svg]:h-3.5 [&_svg]:w-3.5"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
