'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CheckCheck, ChevronDown, Loader2, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import BlankTicketCard from './BlankTicketCard';
import KanbanCard, { type Ticket } from './KanbanCard';

const EMPTY_FILE_MENTION_PATHS: string[] = [];

type KanbanColumnModel = {
  id: string;
  title: string;
};

export default function KanbanColumn({
  column,
  tickets,
  showOrganizationName = false,
  projectId,
  fileMentionPaths = EMPTY_FILE_MENTION_PATHS,
  workingDirectory = null,
  onCreateTicket,
  onMarkUnread,
  onMarkAllRead,
  isCompleteColumn = false,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore
}: {
  column: KanbanColumnModel;
  tickets: Ticket[];
  showOrganizationName?: boolean;
  projectId?: string;
  fileMentionPaths?: string[];
  workingDirectory?: string | null;
  onCreateTicket: (
    status: string,
    objective: string,
    position: 'top' | 'bottom'
  ) => Promise<void> | void;
  onMarkUnread?: (ticketId: string) => void;
  onMarkAllRead?: () => void;
  isCompleteColumn?: boolean;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const ticketIds = tickets.map(t => t.id);

  const [addPosition, setAddPosition] = useState<'top' | 'bottom' | null>(null);
  const [focusEditorCount, setFocusEditorCount] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollKey = `kanban-col-scroll:${projectId ?? 'all'}:${column.id}`;
  const inputId = `kanban-column-input-${column.id}`;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = sessionStorage.getItem(scrollKey);
    if (saved) el.scrollTop = parseInt(saved, 10);
  }, [scrollKey]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) sessionStorage.setItem(scrollKey, String(el.scrollTop));
  }, [scrollKey]);

  const handleStartAddingTop = () => setAddPosition('top');
  const handleStartAddingBottom = () => setAddPosition('bottom');

  const handleCloseBlankCard = useCallback(() => setAddPosition(null), []);

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
          {onMarkAllRead && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={onMarkAllRead}
                    aria-label={`Mark all tickets in ${column.title} as read`}
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Mark all in column as read</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleStartAddingTop}
            aria-label={`Add ticket to ${column.title}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex-1 px-3 ">
        <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-[calc(100vh-16rem)] overflow-y-auto pr-2"
          >
            <div className="flex flex-col gap-2">
              {addPosition === 'top' && (
                <BlankTicketCard
                  inputId={inputId}
                  status={column.id}
                  position="top"
                  fileMentionPaths={fileMentionPaths}
                  workingDirectory={workingDirectory}
                  onCreateTicket={onCreateTicket}
                  onClose={handleCloseBlankCard}
                  onSubmitted={() => setFocusEditorCount(c => c + 1)}
                  focusTrigger={focusEditorCount}
                />
              )}
              {tickets.length === 0 && !addPosition && (
                <div className="text-muted-foreground rounded-md bg-background/50 p-4 text-center text-xs">
                  No tickets
                </div>
              )}
              {tickets.map(ticket => (
                <KanbanCard
                  key={ticket.id}
                  ticket={ticket}
                  showOrganizationName={showOrganizationName}
                  onMarkUnread={onMarkUnread}
                />
              ))}
              {addPosition === 'bottom' && (
                <BlankTicketCard
                  inputId={inputId}
                  status={column.id}
                  position="bottom"
                  fileMentionPaths={fileMentionPaths}
                  workingDirectory={workingDirectory}
                  onCreateTicket={onCreateTicket}
                  onClose={handleCloseBlankCard}
                  onSubmitted={() => setFocusEditorCount(c => c + 1)}
                  focusTrigger={focusEditorCount}
                />
              )}
              {!addPosition && (
                <button
                  onClick={handleStartAddingBottom}
                  className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/20 py-2 text-xs text-muted-foreground/40 transition-colors hover:border-muted-foreground/40 hover:text-muted-foreground/70"
                >
                  <Plus className="h-3 w-3" />
                  Add ticket
                </button>
              )}
              {(hasMore || isLoadingMore) && onLoadMore ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 w-full justify-center gap-1 text-xs text-muted-foreground"
                  onClick={onLoadMore}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading…
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" />
                      Load more
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          </div>
        </SortableContext>
        <div className="h-6" />
      </div>
    </div>
  );
}
