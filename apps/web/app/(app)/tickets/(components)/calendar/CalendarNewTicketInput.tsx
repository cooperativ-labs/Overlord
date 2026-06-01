'use client';

import { useEffect, useRef, useState } from 'react';

export function CalendarNewTicketInput({
  dateKey,
  onSubmit,
  onClose
}: {
  dateKey: string;
  onSubmit: (dateKey: string, objective: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (isSubmitting) return;
      const trimmed = e.currentTarget.value.trim();
      if (!trimmed) {
        onClose();
        return;
      }
      setIsSubmitting(true);
      onSubmit(dateKey, trimmed);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (isSubmitting) return;
    const trimmed = e.target.value.trim();
    if (trimmed) {
      setIsSubmitting(true);
      onSubmit(dateKey, trimmed);
    } else {
      onClose();
    }
  };

  return (
    <div
      className="mt-0.5 rounded border border-border/60 bg-background shadow-sm"
      onClick={e => e.stopPropagation()}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={isSubmitting}
        placeholder="Write an objective…"
        rows={2}
        className="w-full resize-none rounded bg-transparent px-1.5 py-1 text-xs outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  );
}
