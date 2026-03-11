'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp } from 'lucide-react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { KanbanTimerButton } from '@/components/features/everhour/KanbanTimerButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import { updateTicketPriorityAction } from '@/lib/actions/tickets';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { getDisplayTitle } from '@/lib/helpers/tickets';
import { getOptionLabel, ticketExecutionTargetOptions } from '@/lib/options';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

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
  recent_agent?: string | null;
  status: string;
  priority: string;
  execution_target: Database['public']['Enums']['ticket_execution_target'];
  assigned_agent: string | null;
  board_position: number;
  organization_name?: string | null;
  waiting_for_response_at?: string | null;
  has_unopened_waiting_response?: boolean;
  is_read?: boolean;
  objectives_executed_count?: number;
  updated_at?: string;
};

function StatusDot({
  colorClassName,
  label,
  title
}: {
  colorClassName: string;
  label: string;
  title: string;
}) {
  return (
    <span
      className={cn('h-2.5 w-2.5 rounded-full ring-2 ring-background', colorClassName)}
      aria-label={label}
      title={title}
    />
  );
}

function ActiveAgentDisplay({ identifier }: { identifier: string | null }) {
  if (!identifier) return null;
  const agentType = getAgentTypeByIdentifier(identifier);
  return (
    <div className="min-w-0">
      {agentType ? (
        <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
          <Image
            src={agentType.icon}
            alt={`${agentType.label} icon`}
            width={12}
            height={12}
            className="h-3 w-3 shrink-0"
          />
          <span className="truncate">{agentType.label}</span>
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground/70 truncate">{identifier}</p>
      )}
    </div>
  );
}

export default function KanbanCard({
  ticket,
  isDragOverlay,
  showOrganizationName = false,
  onMarkUnread
}: {
  ticket: Ticket;
  isDragOverlay?: boolean;
  showOrganizationName?: boolean;
  onMarkUnread?: (ticketId: string) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
    disabled: isDragOverlay
  });
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

  const isAgentRunning = ticket.agent_session_state === 'attached';
  const hasUnopenedWaitingResponse = ticket.has_unopened_waiting_response === true;
  const hasUnopenedReview = ticket.is_read === false;

  const isOnUserPage = pathname === '/u' || pathname.startsWith('/u/');
  const ticketPath = isOnUserPage
    ? `/u/${ticket.id}`
    : buildTicketPath({ projectId: ticket.project_id, ticketId: ticket.id });
  const isSelected = pathname === ticketPath;

  function handleCardClick() {
    router.push(ticketPath);
  }

  function handleMarkUnreadClick() {
    if (!onMarkUnread) return;
    onMarkUnread(ticket.id);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Card
          ref={setNodeRef}
          aria-label={`Open ticket: ${getDisplayTitle(ticket)}`}
          className={cn(
            'relative cursor-grab border-border/40 shadow-sm overflow-hidden transition-all hover:shadow-md',
            isDragging ? 'opacity-40' : '',
            isAgentRunning && 'animate-pulse border-emerald-500/40',
            isSelected && 'border-gray-500/40 bg-gray-100/70 dark:bg-gray-950/25',
            hasUnopenedReview && 'border-sky-500/40 bg-sky-50/60 dark:bg-sky-950/25',
            isHighPriority && 'border-l-2 border-l-orange-500'
          )}
          style={style}
          onClick={handleCardClick}
          {...listeners}
          {...attributes}
        >
          {isHighPriority && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-4 w-0 border-l-2 border-orange-500"
            />
          )}
          {hasUnopenedWaitingResponse || hasUnopenedReview ? (
            <span className="absolute right-2 top-2 z-10 inline-flex items-center gap-1">
              {hasUnopenedWaitingResponse ? (
                <StatusDot
                  colorClassName="bg-red-500"
                  label="Agent waiting for response"
                  title="Agent is waiting for your response"
                />
              ) : null}
              {hasUnopenedReview ? (
                <StatusDot
                  colorClassName="bg-sky-500"
                  label="Moved to review and unopened"
                  title="This ticket moved to review and has not been opened yet"
                />
              ) : null}
            </span>
          ) : null}
          {isAgentRunning && (
            <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2s_linear_infinite] bg-linear-to-r from-transparent via-emerald-500/20 to-transparent" />
          )}
          <KanbanCardBody ticket={ticket} showOrganizationName={showOrganizationName} />
        </Card>
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
        <ContextMenuItem
          onSelect={() => {
            handleMarkUnreadClick();
          }}
          disabled={!onMarkUnread}
        >
          Mark card unread
        </ContextMenuItem>
      </ContextMenuContent>
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
  const isAgentRunning = ticket.agent_session_state === 'attached';
  const activeAgentIdentifier =
    ticket.running_agent ?? ticket.recent_agent ?? ticket.assigned_agent;
  const executedObjectivesCount = ticket.objectives_executed_count ?? 0;

  return (
    <CardContent className="flex h-full flex-col p-3">
      <div className="min-w-0 space-y-1">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            {ticket.project_color ? (
              <span
                className="mt-1 block h-2.5 w-2.5 shrink-0 rounded-[2px] border"
                style={{ backgroundColor: ticket.project_color, borderColor: ticket.project_color }}
                title={ticket.project_name ?? 'Project'}
              />
            ) : (
              <span
                className="mt-1 block h-2.5 w-2.5 shrink-0 rounded-[2px] border border-muted-foreground/50"
                title="No project"
              />
            )}
            <h4 className="text-sm leading-snug font-medium">{getDisplayTitle(ticket)}</h4>
          </div>
        </div>
        {showOrganizationName && ticket.organization_name ? (
          <p className="text-muted-foreground text-xs">{ticket.organization_name}</p>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-xs">
          {getOptionLabel(ticketExecutionTargetOptions, ticket.execution_target)}
        </Badge>
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
      </div>
    </CardContent>
  );
}
