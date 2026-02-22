'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import { updateTicketFieldAction } from '@/lib/actions/tickets';
import { cn } from '@/lib/utils';

type EditableField = 'title' | 'objective' | 'available_tools' | 'acceptance_criteria';

type Props = {
  ticketId: string;
  field: EditableField;
  initialValue: string;
  multiline?: boolean;
  placeholder?: string;
  /** Classes applied to the display element (view mode) */
  displayClassName?: string;
  /** Classes applied to the input/textarea (edit mode) */
  inputClassName?: string;
  /** Render saved value as markdown in view mode */
  renderMarkdown?: boolean;
};

export function InlineEditField({
  ticketId,
  field,
  initialValue,
  multiline = false,
  placeholder = 'Click to add…',
  displayClassName,
  inputClassName,
  renderMarkdown = false
}: Props) {
  const [editing, setEditing] = useState(false);
  const [savedValue, setSavedValue] = useState(initialValue);
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  const autoResize = useCallback(() => {
    if (!multiline) return;
    const el = inputRef.current as HTMLTextAreaElement | null;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [multiline]);

  useEffect(() => {
    if (editing && multiline) {
      autoResize();
    }
  }, [editing, multiline, value, autoResize]);

  function startEditing() {
    setEditing(true);
  }

  function save() {
    if (value === savedValue) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      await updateTicketFieldAction(ticketId, field, value);
      setSavedValue(value);
      setEditing(false);
    });
  }

  function cancel() {
    setValue(savedValue);
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
    if (!multiline && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  }

  const baseInputClass = cn(
    'w-full bg-background border border-border/40 rounded-md px-2 py-1',
    'focus:outline-none focus:ring-1 focus:ring-ring/40',
    'disabled:opacity-50',
    inputClassName
  );

  if (editing) {
    if (multiline) {
      return (
        <textarea
          ref={inputRef as React.Ref<HTMLTextAreaElement>}
          autoFocus
          className={cn(baseInputClass, 'resize-none text-sm leading-relaxed')}
          disabled={pending}
          value={value}
          onBlur={save}
          onChange={e => {
            setValue(e.target.value);
            autoResize();
          }}
          onKeyDown={handleKeyDown}
        />
      );
    }

    return (
      <input
        ref={inputRef as React.Ref<HTMLInputElement>}
        autoFocus
        className={baseInputClass}
        disabled={pending}
        type="text"
        value={value}
        onBlur={save}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <div
      className={cn(
        'group -mx-2 -my-1 cursor-text rounded-md px-2 py-1',
        'hover:bg-muted/50 transition-colors',
        displayClassName
      )}
      role="button"
      tabIndex={0}
      onClick={startEditing}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') startEditing();
      }}
    >
      {savedValue ? (
        renderMarkdown ? (
          <MarkdownContent compact className="pointer-events-none">
            {savedValue}
          </MarkdownContent>
        ) : (
          <span className="whitespace-pre-wrap">{savedValue}</span>
        )
      ) : (
        <span className="italic text-muted-foreground">{placeholder}</span>
      )}
    </div>
  );
}
