'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { MentionableTextarea } from '@/components/features/MentionableTextarea';
import { Card, CardContent } from '@/components/ui/card';

type BlankTicketCardProps = {
  inputId: string;
  status: string;
  fileMentionPaths: string[];
  onCreateTicket: (status: string, objective: string) => Promise<void> | void;
  onClose: () => void;
  onSubmitted?: () => void;
  focusTrigger?: number;
};

export default function BlankTicketCard({
  inputId,
  status,
  fileMentionPaths,
  onCreateTicket,
  onClose,
  onSubmitted,
  focusTrigger = 0
}: BlankTicketCardProps) {
  const [value, setValue] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusTrigger === 0) return;
    const textArea = inputRef.current;
    if (!textArea) return;
    textArea.focus();
    const cursor = textArea.value.length;
    textArea.setSelectionRange(cursor, cursor);
  }, [focusTrigger]);

  const handleBlur = useCallback(
    async (currentValue: string) => {
      if (isCreating) return;
      const trimmed = currentValue.trim();
      if (trimmed) {
        setIsCreating(true);
        try {
          await onCreateTicket(status, trimmed);
        } finally {
          setIsCreating(false);
        }
      }
      onClose();
      setValue('');
    },
    [isCreating, onCreateTicket, status, onClose]
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
        try {
          await onCreateTicket(status, trimmed);
        } finally {
          setIsCreating(false);
        }
        setValue('');
        onSubmitted?.();
      }
    },
    [onClose, isCreating, onCreateTicket, status, onSubmitted]
  );

  return (
    <Card className="border-border/40 shadow-sm">
      <CardContent className="relative p-2">
        <MentionableTextarea
          ref={inputRef}
          id={inputId}
          autoFocus
          disabled={isCreating}
          placeholder="Write an objective…"
          value={value}
          onValueChange={setValue}
          mentionPaths={fileMentionPaths}
          onBlur={e => {
            void handleBlur(e.target.value);
          }}
          onKeyDown={e => {
            void handleKeyDown(e);
          }}
          className="min-h-[72px] resize-none border-0 p-1 text-sm shadow-none focus-visible:ring-0"
          rows={3}
        />
      </CardContent>
    </Card>
  );
}
