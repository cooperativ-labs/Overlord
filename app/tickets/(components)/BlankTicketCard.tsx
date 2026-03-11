'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { MentionableTextarea } from '@/components/features/MentionableTextarea';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Card, CardContent } from '@/components/ui/card';

const EMPTY_PATHS: string[] = [];

type BlankTicketCardProps = {
  inputId: string;
  status: string;
  fileMentionPaths: string[];
  workingDirectory?: string | null;
  onCreateTicket: (status: string, objective: string) => Promise<void> | void;
  onClose: () => void;
  onSubmitted?: () => void;
  focusTrigger?: number;
};

export default function BlankTicketCard({
  inputId,
  status,
  fileMentionPaths,
  workingDirectory = null,
  onCreateTicket,
  onClose,
  onSubmitted,
  focusTrigger = 0
}: BlankTicketCardProps) {
  const [value, setValue] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [localFileMentionPaths, setLocalFileMentionPaths] = useState<string[]>(fileMentionPaths);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { api, isElectron } = useElectron();

  useEffect(() => {
    if (focusTrigger === 0) return;
    const textArea = inputRef.current;
    if (!textArea) return;
    textArea.focus();
    const cursor = textArea.value.length;
    textArea.setSelectionRange(cursor, cursor);
  }, [focusTrigger]);

  // In Electron, fetch file mention paths locally via IPC
  useEffect(() => {
    if (!isElectron || !api?.filesystem?.listProjectFiles) {
      setLocalFileMentionPaths(fileMentionPaths);
      return;
    }

    const directory = workingDirectory?.trim() ?? '';
    if (!directory) {
      setLocalFileMentionPaths(fileMentionPaths);
      return;
    }

    let cancelled = false;
    void api.filesystem
      .listProjectFiles({ directory })
      .then(result => {
        if (cancelled) return;
        setLocalFileMentionPaths(result.error ? fileMentionPaths : (result.files ?? EMPTY_PATHS));
      })
      .catch(() => {
        if (!cancelled) setLocalFileMentionPaths(fileMentionPaths);
      });

    return () => {
      cancelled = true;
    };
  }, [api, isElectron, workingDirectory, fileMentionPaths]);

  const effectiveMentionPaths = isElectron ? localFileMentionPaths : fileMentionPaths;

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
          mentionPaths={effectiveMentionPaths}
          onBlur={e => {
            void handleBlur(e.target.value);
          }}
          onKeyDown={e => {
            void handleKeyDown(e);
          }}
          className="min-h-[120px] resize-none border-0 p-1 text-sm shadow-none focus-visible:ring-0"
          rows={5}
        />
      </CardContent>
    </Card>
  );
}
