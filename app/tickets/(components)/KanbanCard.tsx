'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

export type Ticket = {
  id: string;
  ticket_number: string | null;
  title: string;
  status: string;
  priority: string;
  assigned_agent: string | null;
  board_position: number;
};

export default function KanbanCard({
  ticket,
  isDragOverlay
}: {
  ticket: Ticket;
  isDragOverlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
    disabled: isDragOverlay
  });

  if (isDragOverlay) {
    return (
      <div className="w-full rounded-md border border-dashed border-primary/40 bg-card shadow-lg">
        <KanbanCardBody ticket={ticket} />
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
      <KanbanCardBody ticket={ticket} />
    </Card>
  );
}

function KanbanCardBody({ ticket }: { ticket: Ticket }) {
  return (
    <CardContent className="space-y-2.5 p-3">
      <h4 className="text-sm leading-snug font-medium">
        <Link
          href={`/tickets/${ticket.id}`}
          className="hover:underline"
          onClick={e => e.stopPropagation()}
        >
          {ticket.ticket_number ?? 'TICKET-????'} - {ticket.title}
        </Link>
      </h4>
      <div className="flex flex-wrap gap-1.5">
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
    </CardContent>
  );
}
