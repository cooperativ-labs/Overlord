'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import { uploadImageArtifactAction } from '@/lib/actions/artifacts';
import { updateTicketFieldAction } from '@/lib/actions/tickets';
import { cn } from '@/lib/utils';

type EditableField = 'title' | 'objective' | 'available_tools' | 'acceptance_criteria';

type Props = {
  ticketId: string;
  organizationId?: number;
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
  /** Optional list of project file paths used for @mention suggestions in multiline mode */
  fileMentionPaths?: string[];
  /**
   * 'textarea' — when empty in view mode, renders with a subtle border and min-height
   * so it looks like a clickable textarea rather than invisible text.
   */
  variant?: 'default' | 'textarea';
};

const MAX_MENTION_RESULTS = 8;

function convertFileMentionsToMarkdown(value: string): string {
  return value.replace(
    /(^|[\s(])@([A-Za-z0-9._/\\-]+)/g,
    (match, prefix: string, filePath: string) => {
      if (!filePath.includes('/') && !filePath.includes('.')) return match;
      return `${prefix}[@${filePath}](mention:${encodeURIComponent(filePath)})`;
    }
  );
}

export function InlineEditField({
  ticketId,
  organizationId,
  field,
  initialValue,
  multiline = false,
  placeholder = 'Click to add…',
  displayClassName,
  inputClassName,
  renderMarkdown = false,
  fileMentionPaths = [],
  variant = 'default'
}: Props) {
  const [editing, setEditing] = useState(false);
  const [savedValue, setSavedValue] = useState(initialValue);
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);

  const canMentionFiles = multiline && field === 'objective' && fileMentionPaths.length > 0;
  const mentionResults = canMentionFiles
    ? fileMentionPaths
        .filter(filePath => filePath.toLowerCase().includes(mentionQuery.toLowerCase()))
        .slice(0, MAX_MENTION_RESULTS)
    : [];
  const mentionMenuOpen = mentionStart !== null && mentionResults.length > 0;

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

  async function handleDrop(e: React.DragEvent) {
    if (field !== 'objective') return;

    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));

    if (imageFiles.length === 0) return;

    e.preventDefault();
    e.stopPropagation();

    for (const file of imageFiles) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const result = await uploadImageArtifactAction(ticketId, organizationId ?? 0, formData);
        const markdown = `[${result.label}](artifact:${result.uri})`;

        const textArea = inputRef.current as HTMLTextAreaElement | null;
        if (textArea) {
          const start = textArea.selectionStart;
          const end = textArea.selectionEnd;
          const newValue = value.substring(0, start) + markdown + value.substring(end);
          setValue(newValue);

          // Need to wait for React to update the state before setting cursor position
          setTimeout(() => {
            textArea.selectionStart = textArea.selectionEnd = start + markdown.length;
            textArea.focus();
            autoResize();
          }, 0);
        } else {
          setValue(prev => (prev ? `${prev}\n${markdown}` : markdown));
        }
      } catch (error) {
        console.error('Failed to upload image artifact:', error);
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
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
      cancel();
    }
    if (!multiline && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  }

  function clearMentionState() {
    setMentionStart(null);
    setMentionQuery('');
    setMentionIndex(0);
  }

  function updateMentionState(nextValue: string, cursorPosition: number) {
    if (!canMentionFiles) {
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
    const textArea = inputRef.current as HTMLTextAreaElement | null;
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
      autoResize();
    });
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
        <div className="relative">
          <textarea
            ref={inputRef as React.Ref<HTMLTextAreaElement>}
            autoFocus
            className={cn(baseInputClass, 'resize-none leading-relaxed')}
            disabled={pending}
            value={value}
            onBlur={save}
            onChange={e => {
              setValue(e.target.value);
              updateMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length);
              autoResize();
            }}
            onClick={e => {
              const target = e.target as HTMLTextAreaElement;
              updateMentionState(value, target.selectionStart ?? value.length);
            }}
            onKeyDown={handleKeyDown}
            onDragOver={e => {
              if (field === 'objective') {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onDrop={handleDrop}
          />
          {mentionMenuOpen ? (
            <div className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
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
        </div>
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

  const isEmpty = !savedValue;
  const isTextareaVariant = variant === 'textarea';

  return (
    <div
      className={cn(
        'cursor-text rounded-md transition-colors',
        displayClassName,
        isTextareaVariant
          ? [
              'px-2 py-1',
              isEmpty
                ? 'min-h-[200px] hover:ring-1 hover:ring-muted-foreground/60'
                : 'hover:ring-1 hover:ring-muted-foreground/60  '
            ]
          : ['-mx-2 -my-1 px-2 py-1', 'hover:bg-muted/50']
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
          <MarkdownContent compact className={cn('pointer-events-none', displayClassName)}>
            {field === 'objective' ? convertFileMentionsToMarkdown(savedValue) : savedValue}
          </MarkdownContent>
        ) : (
          <span className="whitespace-pre-wrap">{savedValue}</span>
        )
      ) : (
        <span
          className={cn(
            'text-muted-foreground',
            isTextareaVariant ? (displayClassName ? displayClassName : 'text-base') : 'italic'
          )}
        >
          {placeholder}
        </span>
      )}
    </div>
  );
}
