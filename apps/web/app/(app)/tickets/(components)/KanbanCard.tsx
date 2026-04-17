'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bot } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';

import { KanbanTimerButton } from '@/components/features/everhour/KanbanTimerButton';
import { ScheduleBadge } from '@/components/features/scheduling/ScheduleBadge';
import { Card, CardContent } from '@/components/ui/card';
import { ContextMenu, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import {
  getAssignedAgentIdentifier,
  type TicketAssignedAgent
} from '@/lib/helpers/ticket-assigned-agent';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { getDisplayTitle } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

import { ExecutionTargetBadge } from './ExecutionTargetBadge';
import {
  ActiveAgentDisplay,
  AttentionIndicators,
  ObjectivesExecutedBadge,
  ProjectColorDot,
  TicketPriorityContextMenu
} from './TicketCardPrimitives';

type SessionState = Database['public']['Enums']['session_state'];

export type Ticket = {
  id: string;
  title: string | null;
  objective: string | null;
  organization_id: number;
  project_id: string;
  project_name?: string | null;
  project_color?: string | null;
  project_everhour_project_id?: string | null;
  everhour_task_id?: string | null;
  agent_session_state?: SessionState | null;
  running_agent?: string | null;
  latest_objective_agent?: string | null;
  has_executing_objective?: boolean;
  status: string;
  priority: string;
  execution_target: Database['public']['Enums']['ticket_execution_target'];
  assigned_agent: TicketAssignedAgent | null;
  board_position: number;
  organization_name?: string | null;
  waiting_for_response_at?: string | null;
  has_unopened_waiting_response?: boolean;
  is_read?: boolean;
  objectives_executed_count?: number;
  updated_at?: string;
  delegate?: string | null;
  schedule_id?: number | null;
  due_datetime?: string | null;
};

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
            'relative cursor-grab border-gray-300/60 dark:border-gray-700/40 bg-linear-to-br from-gray-300/5 to-transparent overflow-hidden transition-all hover:shadow-md rounded-md',
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
  const activeAgentIdentifier =
    ticket.running_agent ??
    ticket.latest_objective_agent ??
    getAssignedAgentIdentifier(ticket.assigned_agent);

  return (
    <CardContent className="flex h-full flex-col p-0 pt-3  ">
      <div className="px-3">
        <div className="min-w-0 gap-1">
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <span className="mt-1">
                <ProjectColorDot color={ticket.project_color} name={ticket.project_name} />
              </span>
              <h4 className="text-sm leading-snug font-medium">{getDisplayTitle(ticket)}</h4>
            </div>
          </div>
          {showOrganizationName && ticket.organization_name ? (
            <p className="text-muted-foreground text-xs">{ticket.organization_name}</p>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <ExecutionTargetBadge executionTarget={ticket.execution_target} className="text-xs" />
          {ticket.schedule_id ? <ScheduleBadge /> : null}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <div className="flex min-w-0 items-center">
            {ticket.project_everhour_project_id ? (
              <KanbanTimerButton
                initialTaskId={ticket.everhour_task_id ?? null}
                ticketId={ticket.id}
              />
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <ActiveAgentDisplay identifier={activeAgentIdentifier} />
            <ObjectivesExecutedBadge count={ticket.objectives_executed_count ?? 0} />
          </div>
        </div>
      </div>
      {ticket.delegate ? (
        <div className="mt-2 flex items-center bg-orange-400/10 gap-1 border-t border-orange-400/60 px-3  text-orange-600 py-1">
          <Bot className="h-2.5 w-2.5 shrink-0 " />
          <span className="text-[10px] truncate">Created by {ticket.delegate}</span>
        </div>
      ) : (
        <div className="h-2" />
      )}
    </CardContent>
  );
}
