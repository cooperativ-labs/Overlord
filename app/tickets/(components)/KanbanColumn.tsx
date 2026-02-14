'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

import KanbanCard, { type Ticket } from './KanbanCard';

type KanbanColumnModel = {
  id: string;
  title: string;
};

export default function KanbanColumn({
  column,
  tickets
}: {
  column: KanbanColumnModel;
  tickets: Ticket[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const ticketIds = tickets.map(t => t.id);

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-[280px] shrink-0 flex-1 flex-col rounded-lg bg-muted/30 transition-colors ${
        isOver ? 'bg-muted/60' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h3 className="text-sm font-semibold tracking-tight">{column.title}</h3>
        <Badge variant="secondary" className="rounded-full">
          {tickets.length}
        </Badge>
      </div>
      <div className="flex-1 px-3 pb-3">
        <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
          <ScrollArea className="h-[calc(100vh-16rem)]">
            <div className="flex flex-col gap-2 pr-2">
              {tickets.length === 0 ? (
                <div className="text-muted-foreground rounded-md bg-background/50 p-4 text-center text-xs">
                  No tickets
                </div>
              ) : (
                tickets.map(ticket => <KanbanCard key={ticket.id} ticket={ticket} />)
              )}
            </div>
          </ScrollArea>
        </SortableContext>
      </div>
    </div>
  );
}
