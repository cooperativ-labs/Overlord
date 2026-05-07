'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useTransition
} from 'react';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import { MentionableTextarea } from '@/components/features/MentionableTextarea';
import { useWorkspaceFileTree } from '@/components/features/projects/useWorkspaceFileTree';
import { useUpdateTicketFieldsMutation } from '@/lib/client-data/tickets/mutations';
import { convertInlineFileMentionsToMarkdown } from '@/lib/helpers/file-mentions';
import type { EditableTextareaHandle, TextareaHandle } from '@/lib/types/text-control';
import { cn } from '@/lib/utils';

export type InlineEditFieldHandle = {
  triggerAtMention: () => void;
};

type EditableField = 'title' | 'objective' | 'available_tools' | 'acceptance_criteria';
const EMPTY_MENTION_PATHS: string[] = [];

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
  /** Optional list of project file paths used for @mention suggestions in multiline mode */
  fileMentionPaths?: string[];
  /** Optional absolute directory used for local Electron file mention suggestions */
  workingDirectory?: string | null;
  variant?: 'default' | 'textarea';
  /** Remove the component's own border/bg so a parent container can provide the visual boundary */
  seamless?: boolean;
  children?: React.ReactNode;
};

export const InlineEditField = forwardRef<InlineEditFieldHandle, Props>(function InlineEditField(
  {
    ticketId,
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
    seamless = false,
    children
  }: Props,
  ref
) {
  const [editing, setEditing] = useState(false);
  const [savedValue, setSavedValue] = useState(initialValue);
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const pendingAtMentionRef = useRef(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const updateFieldsMutation = useUpdateTicketFieldsMutation();
  const canMentionFiles = multiline && field === 'objective';

  useImperativeHandle(ref, () => ({
    triggerAtMention() {
      pendingAtMentionRef.current = true;
      setEditing(true);
    }
  }));

  useEffect(() => {
    if (!editing || !pendingAtMentionRef.current) return;
    pendingAtMentionRef.current = false;
    requestAnimationFrame(() => {
      const el = inputRef.current as HTMLTextAreaElement | null;
      if (!el) return;
      const cursor = el.selectionStart ?? el.value.length;
      const currentVal = el.value;
      const needsSpace =
        cursor > 0 && currentVal[cursor - 1] !== ' ' && currentVal[cursor - 1] !== '\n';
      const insert = needsSpace ? ' @' : '@';
      setValue(currentVal.slice(0, cursor) + insert + currentVal.slice(cursor));
      const newCursor = cursor + insert.length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(newCursor, newCursor);
      });
    });
  }, [editing]);

  const { files: workspaceFiles } = useWorkspaceFileTree({
    fileMentionPaths,
    workingDirectory,
    enabled: canMentionFiles
  });
  const effectiveMentionPaths = canMentionFiles ? workspaceFiles : [];

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
    if (editing) return;
    setSavedValue(initialValue);
    setValue(initialValue);
  }, [editing, initialValue]);

  function startEditing() {
    setEditing(true);
  }

  function save() {
    if (value === savedValue) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      await updateFieldsMutation.mutateAsync({ ticketId, patch: { [field]: value } });
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

  const isTextareaVariant = variant === 'textarea';
  const baseInputClass = cn(
    seamless && isTextareaVariant
      ? 'w-full bg-transparent px-3 py-2'
      : 'w-full bg-background border border-border/40 rounded-md px-2 py-1',
    'focus:outline-none',
    !seamless && 'focus:ring-1 focus:ring-ring/40',
    'disabled:opacity-50',
    inputClassName
  );

  if (editing) {
    if (multiline) {
      return (
        <div
          className={cn(
            'relative w-full',
            isTextareaVariant && !seamless && 'ring-1 rounded-md ring-muted-foreground/40'
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
        isTextareaVariant && seamless
          ? ['px-3 py-2', isEmpty && 'min-h-[100px]']
          : isTextareaVariant
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
});
