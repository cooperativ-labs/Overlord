'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';

import { KanbanTimerButton } from '@/components/features/everhour/KanbanTimerButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getDisplayTitle, getTicketIdentifier } from '@/lib/helpers/tickets';

export type Ticket = {
  id: string;
  title: string | null;
  objective: string | null;
  organization_id: number;
  project_id?: string | null;
  project_name?: string | null;
  project_color?: string | null;
  project_everhour_project_id?: string | null;
  everhour_task_id?: string | null;
  status: string;
  priority: string;
  assigned_agent: string | null;
  board_position: number;
  organization_name?: string | null;
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

  return (
    <Card
      ref={setNodeRef}
      className={`cursor-grab border-border/40 shadow-sm ${isDragging ? 'opacity-40' : ''}`}
      style={style}
      {...listeners}
      {...attributes}
    >
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
  const ticketIdentifier = getTicketIdentifier(ticket.id);

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
              href={`/${ticket.organization_id}/${ticket.id}`}
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
        {ticket.project_everhour_project_id ? (
          <div className="pt-0.5">
            <KanbanTimerButton
              initialTaskId={ticket.everhour_task_id ?? null}
              ticketId={ticket.id}
            />
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-xs">
          {ticket.status}
        </Badge>
        <Badge className="text-xs">{ticket.priority}</Badge>
        {ticket.assigned_agent ? (
          <Badge variant="secondary" className="text-xs">
            {ticket.assigned_agent}
          </Badge>
        ) : null}
      </div>
      <p className="mt-auto pt-2 text-[10px] leading-none text-muted-foreground">
        {ticketIdentifier}
      </p>
    </CardContent>
  );
}
