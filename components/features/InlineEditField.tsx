'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import { MentionableTextarea } from '@/components/features/MentionableTextarea';
import { useElectron } from '@/components/features/terminal/useElectron';
import { uploadImageArtifactAction } from '@/lib/actions/artifacts';
import { updateTicketFieldAction } from '@/lib/actions/tickets';
import { areStringArraysEqual } from '@/lib/helpers/array-utils';
import { convertInlineFileMentionsToMarkdown } from '@/lib/helpers/file-mentions';
import type { EditableTextareaHandle, TextareaHandle } from '@/lib/types/text-control';
import { cn } from '@/lib/utils';

type EditableField = 'title' | 'objective' | 'available_tools' | 'acceptance_criteria';
const EMPTY_MENTION_PATHS: string[] = [];

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
  /** Optional absolute directory used for local Electron file mention suggestions */
  workingDirectory?: string | null;
  variant?: 'default' | 'textarea';
  children?: React.ReactNode;
};

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
  fileMentionPaths = EMPTY_MENTION_PATHS,
  workingDirectory,
  variant = 'default',
  children
}: Props) {
  const { api, isElectron } = useElectron();
  const [editing, setEditing] = useState(false);
  const [savedValue, setSavedValue] = useState(initialValue);
  const [value, setValue] = useState(initialValue);
  const [localFileMentionPaths, setLocalFileMentionPaths] = useState<string[]>(fileMentionPaths);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const canMentionFiles = multiline && field === 'objective';
  const effectiveMentionPaths = canMentionFiles
    ? isElectron
      ? localFileMentionPaths
      : fileMentionPaths
    : [];

  const syncLocalFileMentionPaths = useCallback((nextPaths: string[]) => {
    setLocalFileMentionPaths(current =>
      areStringArraysEqual(current, nextPaths) ? current : nextPaths
    );
  }, []);

  const autoResize = useCallback(() => {
    if (!multiline) return;
    const el = inputRef.current as EditableTextareaHandle | null;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [multiline]);

  useEffect(() => {
    if (editing && multiline) {
      autoResize();
    }
  }, [editing, multiline, value, autoResize]);

  useEffect(() => {
    if (searchParams.get('focus') === field) {
      setEditing(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('focus');
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }, [field, searchParams, router]);

  useEffect(() => {
    if (editing && inputRef.current) {
      const el = inputRef.current as TextareaHandle | HTMLInputElement;
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [editing]);

  useEffect(() => {
    if (!canMentionFiles) {
      syncLocalFileMentionPaths(EMPTY_MENTION_PATHS);
      return;
    }

    if (!isElectron) {
      syncLocalFileMentionPaths(fileMentionPaths);
      return;
    }

    const directory = workingDirectory?.trim() ?? '';
    if (!directory || !api?.filesystem?.listProjectFiles) {
      syncLocalFileMentionPaths(fileMentionPaths);
      return;
    }

    let cancelled = false;
    void api.filesystem
      .listProjectFiles({ directory })
      .then(result => {
        if (cancelled) return;
        if (result.error) {
          syncLocalFileMentionPaths(fileMentionPaths);
          return;
        }
        syncLocalFileMentionPaths(result.files ?? EMPTY_MENTION_PATHS);
      })
      .catch(() => {
        if (!cancelled) {
          syncLocalFileMentionPaths(fileMentionPaths);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    api,
    canMentionFiles,
    fileMentionPaths,
    isElectron,
    syncLocalFileMentionPaths,
    workingDirectory
  ]);

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

        const textArea = inputRef.current as EditableTextareaHandle | null;
        if (textArea) {
          const start = textArea.selectionStart ?? value.length;
          const end = textArea.selectionEnd ?? start;
          const newValue = value.substring(0, start) + markdown + value.substring(end);
          setValue(newValue);

          // Wait for React to update the state before setting cursor position.
          // requestAnimationFrame is preferred over setTimeout for DOM updates
          // and doesn't require cleanup since it fires before the next paint.
          requestAnimationFrame(() => {
            textArea.selectionStart = textArea.selectionEnd = start + markdown.length;
            textArea.focus();
            autoResize();
          });
        } else {
          setValue(prev => (prev ? `${prev}\n${markdown}` : markdown));
        }
      } catch (error) {
        console.error('Failed to upload image artifact:', error);
      }
    }
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
  const isTextareaVariant = variant === 'textarea';

  if (editing) {
    if (multiline) {
      return (
        <div
          className={cn(
            'relative w-full',
            isTextareaVariant && 'ring-1 rounded-md ring-muted-foreground/40'
          )}
        >
          <div className={cn(baseInputClass, 'resize-none leading-relaxed relative')}>
            <MentionableTextarea
              ref={inputRef as React.Ref<HTMLTextAreaElement>}
              autoFocus
              className={cn('w-full focus:outline-none border-none', children && 'pr-3')}
              disabled={pending}
              value={value}
              onValueChange={setValue}
              mentionPaths={effectiveMentionPaths}
              onBlur={save}
              onChange={autoResize}
              onKeyDown={handleKeyDown}
              onDragOver={e => {
                if (field === 'objective') {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              onDrop={handleDrop}
            />
            {children ? (
              <div className="absolute top-1 right-1 z-10 py-1 border-none focus:outline-none">
                {children}
              </div>
            ) : null}
          </div>
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

  return (
    <div
      className={cn(
        'relative w-full cursor-text rounded-md transition-colors',
        displayClassName,
        isTextareaVariant
          ? [
              'px-3 py-1 bg-gray-200/40 dark:bg-gray-900/30 rounded-md',
              isEmpty
                ? 'min-h-[100px] ring-1 ring-muted-foreground/40 hover:ring-muted-foreground'
                : 'hover:ring-1 hover:ring-muted-foreground/60'
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
          <MarkdownContent
            compact
            className={cn('pointer-events-none', displayClassName, children && 'pr-3')}
          >
            {field === 'objective' ? convertInlineFileMentionsToMarkdown(savedValue) : savedValue}
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
      {children ? (
        <div className="absolute top-1 right-1 z-10 py-1 border-none focus:outline-none">
          {children}
        </div>
      ) : null}
    </div>
  );
}
