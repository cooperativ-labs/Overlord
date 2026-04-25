'use client';

import { format, parseISO } from 'date-fns';
import { CalendarDays, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Calendar } from '@/components/ui/calendar';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { updateTicketDueDateAction } from '@/lib/actions/tickets';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import { cn } from '@/lib/utils';

const updateTicketDueDateActionWithRetry = withElectronActionRetry(updateTicketDueDateAction);

type DueDateEditorProps = {
  initialDueDatetime: string | null;
  ticketId: string;
};

function parseDueDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function buildDueDatetime(selectedDate: Date, currentDueDatetime: string | null): string {
  if (currentDueDatetime) {
    const current = parseISO(currentDueDatetime);
    const next = new Date(current);
    next.setUTCFullYear(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate()
    );
    return next.toISOString();
  }

  return new Date(
    Date.UTC(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 12, 0, 0)
  ).toISOString();
}

function formatDueDateLabel(value: string | null): string {
  const date = parseDueDate(value);
  if (!date) return 'Set due date';
  return `Due ${format(date, 'MMM d, yyyy')}`;
}

export function DueDateEditor({ initialDueDatetime, ticketId }: DueDateEditorProps) {
  const [open, setOpen] = useState(false);
  const [dueDatetime, setDueDatetime] = useState(initialDueDatetime);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() =>
    parseDueDate(initialDueDatetime)
  );
  const [saveButtonState, setSaveButtonState] = useState<ButtonLoadingState>('default');
  const [clearButtonState, setClearButtonState] = useState<ButtonLoadingState>('default');

  useEffect(() => {
    setDueDatetime(initialDueDatetime);
    setSelectedDate(parseDueDate(initialDueDatetime));
  }, [initialDueDatetime]);

  async function handleSaveDueDate() {
    if (!selectedDate) return;

    setSaveButtonState('loading');

    try {
      const nextDueDatetime = buildDueDatetime(selectedDate, dueDatetime);
      await updateTicketDueDateActionWithRetry(ticketId, nextDueDatetime);
      setDueDatetime(nextDueDatetime);
      setSaveButtonState('success');
      setOpen(false);
    } catch {
      setSaveButtonState('error');
    }
  }

  async function handleClearDueDate() {
    setClearButtonState('loading');

    try {
      await updateTicketDueDateActionWithRetry(ticketId, null);
      setDueDatetime(null);
      setSelectedDate(undefined);
      setClearButtonState('success');
      setOpen(false);
    } catch {
      setClearButtonState('error');
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted',
            dueDatetime
              ? 'border-sky-400/40 text-sky-700 dark:border-sky-500/30 dark:text-sky-300'
              : 'border-input text-muted-foreground'
          )}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          <span>{formatDueDateLabel(dueDatetime)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-medium">Next due date</h3>
          <p className="text-xs text-muted-foreground">
            Set a one-time due date without changing the recurring schedule.
          </p>
        </div>

        <Calendar selected={selectedDate} onSelect={setSelectedDate} />

        <div className="flex items-center justify-between gap-2 border-t px-3 py-3">
          <LoadingButton
            buttonState={clearButtonState}
            setButtonState={setClearButtonState}
            variant="ghost"
            size="sm"
            text={
              <>
                <X className="h-3.5 w-3.5" />
                Clear
              </>
            }
            loadingText="Clearing..."
            successText="Cleared"
            errorText="Clear failed"
            reset
            disabled={!dueDatetime}
            onClick={handleClearDueDate}
          />
          <LoadingButton
            buttonState={saveButtonState}
            setButtonState={setSaveButtonState}
            size="sm"
            text="Save due date"
            loadingText="Saving..."
            successText="Saved"
            errorText="Save failed"
            reset
            disabled={!selectedDate}
            onClick={handleSaveDueDate}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
