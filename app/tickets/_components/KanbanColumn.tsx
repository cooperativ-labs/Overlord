"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import type { BoardColumn } from "@/lib/orchestrator/types";

import KanbanCard, { type Ticket } from "./KanbanCard";

export default function KanbanColumn({
  column,
  tickets,
}: {
  column: BoardColumn;
  tickets: Ticket[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.slug });
  const ticketIds = tickets.map((t) => t.id);

  return (
    <div
      ref={setNodeRef}
      className={`kanban-column${isOver ? " kanban-column-drop-active" : ""}`}
    >
      <div className="kanban-column-header">
        <span>{column.title}</span>
        <span className="kanban-column-count">{tickets.length}</span>
      </div>
      <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
        <div className="kanban-column-body">
          {tickets.length === 0 ? (
            <div className="kanban-empty">No tickets</div>
          ) : (
            tickets.map((ticket) => <KanbanCard key={ticket.id} ticket={ticket} />)
          )}
        </div>
      </SortableContext>
    </div>
  );
}
