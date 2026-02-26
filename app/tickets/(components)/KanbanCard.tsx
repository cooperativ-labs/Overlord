'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PanelRightIcon } from 'lucide-react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';

import { KanbanTimerButton } from '@/components/features/everhour/KanbanTimerButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { getDisplayTitle } from '@/lib/helpers/tickets';
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
  review_entered_at?: string | null;
  has_unopened_review?: boolean;
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

export default function KanbanCard({
  ticket,
  isDragOverlay,
  showOrganizationName = false
}: {
  ticket: Ticket;
  isDragOverlay?: boolean;
  showOrganizationName?: boolean;
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

  const isAgentRunning = ticket.agent_session_state === 'attached';
  const hasUnopenedWaitingResponse = ticket.has_unopened_waiting_response === true;
  const hasUnopenedReview = ticket.has_unopened_review === true;

  const isOnUserPage = pathname === '/u' || pathname.startsWith('/u/');
  const ticketPath = isOnUserPage
    ? `/u/${ticket.id}`
    : buildTicketPath({ projectId: ticket.project_id, ticketId: ticket.id });
  const isSelected = pathname === ticketPath;

  function handleCardClick() {
    router.push(ticketPath);
  }

  return (
    <Card
      ref={setNodeRef}
      aria-label={`Open ticket: ${getDisplayTitle(ticket)}`}
      className={cn(
        'relative cursor-grab border-border/40 shadow-sm overflow-hidden transition-all hover:shadow-md',
        isDragging ? 'opacity-40' : '',
        isAgentRunning && 'animate-pulse border-emerald-500/40',
        isSelected && 'border-gray-500/40 bg-gray-100/70 dark:bg-gray-950/25',
        hasUnopenedReview && 'border-sky-500/40 bg-sky-50/60 dark:bg-sky-950/25'
      )}
      style={style}
      onClick={handleCardClick}
      {...listeners}
      {...attributes}
    >
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
  const activeAgentType = getAgentTypeByIdentifier(activeAgentIdentifier);

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
        <Badge className="text-xs">{ticket.priority}</Badge>
        <Badge variant="outline" className="text-xs capitalize">
          {ticket.execution_target}
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
        {activeAgentIdentifier ? (
          <div className="min-w-0">
            {activeAgentType ? (
              <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                <Image
                  src={activeAgentType.icon}
                  alt={`${activeAgentType.label} icon`}
                  width={12}
                  height={12}
                  className="h-3 w-3 shrink-0"
                />
                <span className="truncate">{activeAgentType.label}</span>
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground/70 truncate">
                {activeAgentIdentifier}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </CardContent>
  );
}
