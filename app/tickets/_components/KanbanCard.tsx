'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';

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
      <div className="kanban-card-overlay">
        <CardContent ticket={ticket} />
      </div>
    );
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <div
      ref={setNodeRef}
      className={`kanban-card${isDragging ? ' dragging' : ''}`}
      style={style}
      {...listeners}
      {...attributes}
    >
      <CardContent ticket={ticket} />
    </div>
  );
}

function CardContent({ ticket }: { ticket: Ticket }) {
  return (
    <>
      <h4 className="kanban-card-title">
        <Link href={`/tickets/${ticket.id}`} onClick={e => e.stopPropagation()}>
          {ticket.ticket_number ?? 'TICKET-????'} - {ticket.title}
        </Link>
      </h4>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <span className="badge">{ticket.status}</span>
        <span className="badge">{ticket.priority}</span>
        {ticket.assigned_agent ? <span className="badge">{ticket.assigned_agent}</span> : null}
      </div>
    </>
  );
}
