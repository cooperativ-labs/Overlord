'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { MentionableTextarea } from '@/components/features/MentionableTextarea';
import { useWorkspaceFileTree } from '@/components/features/projects/useWorkspaceFileTree';
import { Card, CardContent } from '@/components/ui/card';
import type { TextareaHandle } from '@/lib/types/text-control';

type BlankTicketCardProps = {
  inputId: string;
  status: string;
  position: 'top' | 'bottom';
  expand?: boolean;
  closeOnSubmit?: boolean;
  fileMentionPaths: string[];
  workingDirectory?: string | null;
  onCreateTicket: (
    status: string,
    objective: string,
    position: 'top' | 'bottom'
  ) => Promise<void> | void;
  onCreateAndOpenTicket?: (
    status: string,
    objective: string,
    position: 'top' | 'bottom'
  ) => Promise<void> | void;
  onClose: () => void;
  onSubmitted?: () => void;
  focusTrigger?: number;
};

export default function BlankTicketCard({
  inputId,
  status,
  position,
  expand = true,
  closeOnSubmit = false,
  fileMentionPaths,
  workingDirectory = null,
  onCreateTicket,
  onCreateAndOpenTicket,
  onClose,
  onSubmitted,
  focusTrigger = 0
}: BlankTicketCardProps) {
  const [value, setValue] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { files: effectiveMentionPaths } = useWorkspaceFileTree({
    fileMentionPaths,
    workingDirectory
  });

  useEffect(() => {
    if (focusTrigger === 0) return;
    const textArea = inputRef.current as TextareaHandle | null;
    if (!textArea) return;
    textArea.focus();
    const cursor = textArea.value.length;
    textArea.setSelectionRange(cursor, cursor);
  }, [focusTrigger]);

  const handleBlur = useCallback(
    async (currentValue: string) => {
      if (isCreating) return;
      const trimmed = currentValue.trim();
      onClose();
      setValue('');
      if (trimmed) {
        setIsCreating(true);
        try {
          await onCreateTicket(status, trimmed, position);
        } finally {
          setIsCreating(false);
        }
      }
    },
    [isCreating, onCreateTicket, status, position, onClose]
  );

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        setValue('');
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (isCreating) return;
        const trimmed = e.currentTarget.value.trim();
        if (!trimmed) {
          onClose();
          setValue('');
          return;
        }
        setIsCreating(true);
        setValue('');
        try {
          if (e.metaKey && onCreateAndOpenTicket) {
            await onCreateAndOpenTicket(status, trimmed, position);
          } else {
            await onCreateTicket(status, trimmed, position);
          }
        } finally {
          setIsCreating(false);
        }
        if (closeOnSubmit) {
          onClose();
        }
        onSubmitted?.();
      }
    },
    [
      closeOnSubmit,
      onClose,
      isCreating,
      onCreateTicket,
      onCreateAndOpenTicket,
      status,
      position,
      onSubmitted
    ]
  );

  return (
    <Card
      className={
        expand
          ? 'border-border/40 overflow-visible scale-110 shadow-2xl'
          : 'border-border/40 overflow-hidden shadow-sm'
      }
    >
      <CardContent className="relative p-2">
        <MentionableTextarea
          ref={inputRef}
          id={inputId}
          autoFocus
          disabled={isCreating}
          placeholder="Write an objective…"
          value={value}
          onValueChange={setValue}
          mentionPaths={effectiveMentionPaths}
          onBlur={e => {
            void handleBlur(e.target.value);
          }}
          onKeyDown={e => {
            void handleKeyDown(e);
          }}
          className={
            expand
              ? 'min-h-[156px] resize-none border-0 p-1 text-sm shadow-none focus-visible:ring-0'
              : 'min-h-[78px] resize-none border-0 p-1 text-sm shadow-none focus-visible:ring-0'
          }
          rows={expand ? 7 : 4}
        />
        {onCreateAndOpenTicket && (
          <p className="mt-1 px-1 text-[11px] text-muted-foreground/50">⌘↵ to save &amp; open</p>
        )}
      </CardContent>
    </Card>
  );
}
