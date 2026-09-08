import { Loader2, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { DueDatePickerButton } from '@/components/scheduling/DueDatePickerButton.tsx';
import { useCreateInboxItem } from '@/lib/queries.ts';
import { cn } from '@/lib/utils';

/**
 * One-line capture at the top of the Inbox task list. Enter adds the task and
 * keeps focus so several can be typed in a row; the due date sticks between
 * adds so a batch of "tomorrow" tasks needs the picker once. Longer
 * instructions belong in the expanded row editor after capture.
 */
export function InboxQuickAdd({
  dueDatetime,
  onDueDatetimeChange,
  hint,
  focusTrigger
}: {
  dueDatetime: string | null;
  onDueDatetimeChange: (next: string | null) => void;
  /** Explains a preset due date when a group header's "+" opened the input. */
  hint: string | null;
  /** Increment to move focus into the input (e.g. after a group "+" click). */
  focusTrigger: number;
}) {
  const createInboxItem = useCreateInboxItem();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (focusTrigger > 0) inputRef.current?.focus();
  }, [focusTrigger]);

  const trimmed = text.trim();
  const canAdd = trimmed.length > 0 && !createInboxItem.isPending;

  async function submit() {
    if (!canAdd) return;
    setError(null);
    try {
      await createInboxItem.mutateAsync({
        title: trimmed,
        objectives: [trimmed],
        dueDatetime
      });
      setText('');
      inputRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to add task.');
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border border-muted-foreground/20 bg-background px-2 py-1.5 transition-shadow focus-within:shadow-sm focus-within:ring-1 focus-within:ring-ring/40'
        )}
      >
        <Plus className="h-4 w-4 shrink-0 text-muted-foreground/60" />
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            } else if (event.key === 'Escape') {
              setText('');
            }
          }}
          placeholder="Add a task… it stays private until you assign a project"
          aria-label="New task"
          disabled={createInboxItem.isPending}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
        />
        <DueDatePickerButton
          size="sm"
          emptyLabel="Due date"
          heading="Due date"
          description="Pre-set the due date for tasks you add next."
          value={dueDatetime}
          onChange={onDueDatetimeChange}
          disabled={createInboxItem.isPending}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canAdd}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createInboxItem.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Add
        </button>
      </div>
      {error ? <p className="px-1 text-xs text-red-400">{error}</p> : null}
      {!error && hint ? <p className="px-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
