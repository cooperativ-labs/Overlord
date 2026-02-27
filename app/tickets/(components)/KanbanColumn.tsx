'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import KanbanCard, { type Ticket } from './KanbanCard';

type KanbanColumnModel = {
  id: string;
  title: string;
};

const MAX_MENTION_RESULTS = 8;

export default function KanbanColumn({
  column,
  tickets,
  showOrganizationName = false,
  projectId,
  fileMentionPaths = [],
  onCreateTicket,
  onMarkUnread,
  olderTicketsCount = 0,
  isCompleteColumn = false,
  showOlder = false,
  onToggleShowOlder
}: {
  column: KanbanColumnModel;
  tickets: Ticket[];
  showOrganizationName?: boolean;
  projectId?: string;
  fileMentionPaths?: string[];
  onCreateTicket: (status: string, objective: string) => Promise<void> | void;
  onMarkUnread?: (ticketId: string) => void;
  olderTicketsCount?: number;
  isCompleteColumn?: boolean;
  showOlder?: boolean;
  onToggleShowOlder?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const ticketIds = tickets.map(t => t.id);

  const [isAdding, setIsAdding] = useState(false);
  const [value, setValue] = useState('');
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [focusEditorCount, setFocusEditorCount] = useState(0);
  const [isCreating, setIsCreating] = useState(false);

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

  const mentionResults = useMemo(
    () =>
      fileMentionPaths
        .filter(filePath => filePath.toLowerCase().includes(mentionQuery.toLowerCase()))
        .slice(0, MAX_MENTION_RESULTS),
    [fileMentionPaths, mentionQuery]
  );
  const mentionMenuOpen = mentionStart !== null && mentionResults.length > 0;

  function clearMentionState() {
    setMentionStart(null);
    setMentionQuery('');
    setMentionIndex(0);
  }

  function updateMentionState(nextValue: string, cursorPosition: number) {
    if (fileMentionPaths.length === 0) {
      clearMentionState();
      return;
    }

    const beforeCursor = nextValue.slice(0, cursorPosition);
    const tokenMatch = beforeCursor.match(/(^|[\s(])@([^\s@]*)$/);
    if (!tokenMatch) {
      clearMentionState();
      return;
    }

    const query = tokenMatch[2] ?? '';
    const atSymbolPosition = cursorPosition - query.length - 1;
    setMentionStart(atSymbolPosition);
    setMentionQuery(query);
    setMentionIndex(0);
  }

  function insertMentionAtCursor(filePath: string) {
    const textArea = document.getElementById(inputId) as HTMLTextAreaElement | null;
    if (!textArea || mentionStart === null || !filePath) return;

    const cursor = textArea.selectionStart ?? value.length;
    let mentionText = `@${filePath}`;
    const suffix = value.slice(cursor);
    if (suffix.length === 0 || (!suffix.startsWith(' ') && !suffix.startsWith('\n'))) {
      mentionText += ' ';
    }

    const nextValue = `${value.slice(0, mentionStart)}${mentionText}${suffix}`;
    const nextCursor = mentionStart + mentionText.length;

    setValue(nextValue);
    clearMentionState();

    requestAnimationFrame(() => {
      textArea.focus();
      textArea.setSelectionRange(nextCursor, nextCursor);
    });
  }

  useEffect(() => {
    if (!isAdding || focusEditorCount === 0) return;
    const textArea = document.getElementById(inputId) as HTMLTextAreaElement | null;
    if (!textArea) return;
    textArea.focus();
    const cursor = textArea.value.length;
    textArea.setSelectionRange(cursor, cursor);
  }, [focusEditorCount, inputId, isAdding]);

  const handleStartAdding = () => {
    setValue('');
    clearMentionState();
    setIsAdding(true);
  };

  const handleBlur = async (currentValue: string) => {
    if (isCreating) return;
    const trimmed = currentValue.trim();
    if (trimmed) {
      setIsCreating(true);
      try {
        await onCreateTicket(column.id, trimmed);
      } finally {
        setIsCreating(false);
      }
    }
    clearMentionState();
    setIsAdding(false);
    setValue('');
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionMenuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(current => (current + 1) % mentionResults.length);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(current => (current - 1 + mentionResults.length) % mentionResults.length);
        return;
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMentionAtCursor(mentionResults[mentionIndex] ?? mentionResults[0] ?? '');
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        clearMentionState();
        return;
      }
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      clearMentionState();
      setIsAdding(false);
      setValue('');
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (isCreating) return;
      const trimmed = e.currentTarget.value.trim();
      if (!trimmed) {
        setIsAdding(false);
        setValue('');
        clearMentionState();
        return;
      }
      setIsCreating(true);
      try {
        await onCreateTicket(column.id, trimmed);
      } finally {
        setIsCreating(false);
      }
      setValue('');
      clearMentionState();
      setIsAdding(true);
      setFocusEditorCount(current => current + 1);
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
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-[calc(100vh-16rem)] overflow-y-auto pr-2"
          >
            <div className="flex flex-col gap-2">
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
                  onMarkUnread={onMarkUnread}
                />
              ))}
              {isAdding ? (
                <Card className="border-border/40 shadow-sm">
                  <CardContent className="relative p-2">
                    <Textarea
                      id={inputId}
                      autoFocus
                      disabled={isCreating}
                      placeholder="Write an objective…"
                      value={value}
                      onChange={e => {
                        setValue(e.target.value);
                        updateMentionState(
                          e.target.value,
                          e.target.selectionStart ?? e.target.value.length
                        );
                      }}
                      onClick={e => {
                        const target = e.target as HTMLTextAreaElement;
                        updateMentionState(value, target.selectionStart ?? value.length);
                      }}
                      onSelect={e => {
                        const target = e.target as HTMLTextAreaElement;
                        updateMentionState(value, target.selectionStart ?? value.length);
                      }}
                      onBlur={e => {
                        void handleBlur(e.target.value);
                      }}
                      onKeyDown={e => {
                        void handleKeyDown(e);
                      }}
                      className="min-h-[72px] resize-none border-0 p-1 text-sm shadow-none focus-visible:ring-0"
                      rows={3}
                    />
                    {mentionMenuOpen ? (
                      <div className="absolute left-2 right-2 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                        {mentionResults.map((filePath, index) => (
                          <button
                            key={filePath}
                            className={cn(
                              'block w-full rounded px-2 py-1.5 text-left text-sm',
                              index === mentionIndex
                                ? 'bg-accent text-accent-foreground'
                                : 'hover:bg-accent/60'
                            )}
                            type="button"
                            onMouseDown={event => {
                              event.preventDefault();
                              insertMentionAtCursor(filePath);
                            }}
                          >
                            @{filePath}
                          </button>
                        ))}
                      </div>
                    ) : null}
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
              {isCompleteColumn && (olderTicketsCount > 0 || showOlder) && onToggleShowOlder ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 w-full justify-center gap-1 text-xs text-muted-foreground"
                  onClick={onToggleShowOlder}
                >
                  {showOlder ? (
                    <>
                      <ChevronUp className="h-3 w-3" />
                      Hide older tickets
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" />
                      See older tickets ({olderTicketsCount})
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          </div>
        </SortableContext>
      </div>
    </div>
  );
}
