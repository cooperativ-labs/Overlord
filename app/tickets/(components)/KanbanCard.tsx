'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';

import { KanbanTimerButton } from '@/components/features/everhour/KanbanTimerButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
  status: string;
  priority: string;
  execution_target: Database['public']['Enums']['ticket_execution_target'];
  assigned_agent: string | null;
  board_position: number;
  organization_name?: string | null;
  waiting_for_response_at?: string | null;
  has_unopened_waiting_response?: boolean;
};

export default function KanbanCard({
  ticket,
  isDragOverlay,
  showOrganizationName = false
}: {
  ticket: Ticket;
  isDragOverlay?: boolean;
  showOrganizationName?: boolean;
}) {
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

  return (
    <Card
      ref={setNodeRef}
      className={cn(
        'relative cursor-grab border-border/40 shadow-sm overflow-hidden',
        isDragging ? 'opacity-40' : '',
        isAgentRunning && 'border-primary/30'
      )}
      style={style}
      {...listeners}
      {...attributes}
    >
      {hasUnopenedWaitingResponse ? (
        <span
          className="absolute right-2 top-2 z-10 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-background"
          aria-label="Agent waiting for response"
          title="Agent is waiting for your response"
        />
      ) : null}
      {isAgentRunning && (
        <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2s_linear_infinite] bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />
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

  return (
    <CardContent className="flex h-full flex-col p-3">
      <div className="min-w-0 space-y-1">
        <div className="flex items-start gap-2">
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
          <h4 className="text-sm leading-snug font-medium">
            <Link
              href={buildTicketPath({
                organizationId: ticket.organization_id,
                projectId: ticket.project_id,
                ticketId: ticket.id
              })}
              className="hover:underline"
              onClick={e => e.stopPropagation()}
            >
              {getDisplayTitle(ticket)}
            </Link>
          </h4>
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
        {isAgentRunning && (ticket.running_agent ?? ticket.assigned_agent) ? (
          <p className="text-[10px] text-muted-foreground/70 truncate">
            {ticket.running_agent ?? ticket.assigned_agent}
          </p>
        ) : null}
      </div>
    </CardContent>
  );
}
