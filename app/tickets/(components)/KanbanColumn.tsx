'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';

import KanbanCard, { type Ticket } from './KanbanCard';

type KanbanColumnModel = {
  id: string;
  title: string;
};

export default function KanbanColumn({
  column,
  tickets,
  showOrganizationName = false,
  onCreateTicket
}: {
  column: KanbanColumnModel;
  tickets: Ticket[];
  showOrganizationName?: boolean;
  onCreateTicket: (status: string, objective: string) => Promise<void> | void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const ticketIds = tickets.map(t => t.id);

  const [isAdding, setIsAdding] = useState(false);
  const [value, setValue] = useState('');

  const handleStartAdding = () => {
    setValue('');
    setIsAdding(true);
  };

  const handleBlur = () => {
    const trimmed = value.trim();
    if (trimmed) {
      void onCreateTicket(column.id, trimmed);
    }
    setIsAdding(false);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setIsAdding(false);
      setValue('');
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      (e.target as HTMLTextAreaElement).blur();
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-[280px] shrink-0 flex-1 flex-col rounded-lg bg-muted/30 transition-colors ${
        isOver ? 'bg-muted/60' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h3 className="text-sm font-semibold tracking-tight">{column.title}</h3>
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="rounded-full">
            {tickets.length}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleStartAdding}
            aria-label={`Add ticket to ${column.title}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex-1 px-3 pb-3">
        <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
          <ScrollArea className="h-[calc(100vh-16rem)]">
            <div className="flex flex-col gap-2 pr-2">
              {tickets.length === 0 && !isAdding && (
                <div className="text-muted-foreground rounded-md bg-background/50 p-4 text-center text-xs">
                  No tickets
                </div>
              )}
              {tickets.map(ticket => (
                <KanbanCard
                  key={ticket.id}
                  ticket={ticket}
                  showOrganizationName={showOrganizationName}
                />
              ))}
              {isAdding ? (
                <Card className="border-border/40 shadow-sm">
                  <CardContent className="p-2">
                    <Textarea
                      autoFocus
                      placeholder="Describe the ticket…"
                      value={value}
                      onChange={e => setValue(e.target.value)}
                      onBlur={handleBlur}
                      onKeyDown={handleKeyDown}
                      className="min-h-[72px] resize-none border-0 p-1 text-sm shadow-none focus-visible:ring-0"
                      rows={3}
                    />
                  </CardContent>
                </Card>
              ) : (
                <button
                  onClick={handleStartAdding}
                  className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/20 py-2 text-xs text-muted-foreground/40 transition-colors hover:border-muted-foreground/40 hover:text-muted-foreground/70"
                >
                  <Plus className="h-3 w-3" />
                  Add ticket
                </button>
              )}
            </div>
          </ScrollArea>
        </SortableContext>
      </div>
    </div>
  );
}
