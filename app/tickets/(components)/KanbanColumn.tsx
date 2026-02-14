'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { BoardColumn } from '@/lib/orchestrator/types';

import KanbanCard, { type Ticket } from './KanbanCard';

export default function KanbanColumn({
  column,
  tickets
}: {
  column: BoardColumn;
  tickets: Ticket[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.slug });
  const ticketIds = tickets.map(t => t.id);

  return (
    <Card
      ref={setNodeRef}
      className={`min-h-[20rem] min-w-[18rem] ${isOver ? 'ring-2 ring-primary/40' : ''}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{column.title}</CardTitle>
          <Badge variant="outline">{tickets.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
          <ScrollArea className="h-[28rem] pr-2">
            <div className="grid gap-2">
              {tickets.length === 0 ? (
                <div className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                  No tickets
                </div>
              ) : (
                tickets.map(ticket => <KanbanCard key={ticket.id} ticket={ticket} />)
              )}
            </div>
          </ScrollArea>
        </SortableContext>
      </CardContent>
    </Card>
  );
}
