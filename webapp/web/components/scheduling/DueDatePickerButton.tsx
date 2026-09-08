import { CalendarDays, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  buildDueDatetime,
  formatDueDateLabel,
  formatOrdinalDayOfMonth,
  fromDateInputValue,
  parseDueDate,
  toDateInputValue
} from '../../lib/due-datetime.ts';
import { cn } from '../../lib/utils.ts';
import type { ButtonLoadingState } from '../ui/loading-button.tsx';
import { LoadingButton } from '../ui/loading-button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx';

type DueDatePickerButtonProps = {
  /** Current due datetime as stored (ISO-8601) or `null` when unset. */
  value: string | null;
  /**
   * Commit a new due datetime, or `null` to clear it. May be async; the popover
   * keeps its Save / Clear button in a loading state until the promise settles
   * and stays open when it rejects so the choice is not silently lost.
   */
  onChange: (next: string | null) => void | Promise<void>;
  disabled?: boolean;
  /**
   * `sm` matches the h-8 footer toolbars on Inbox cards and the new-mission
   * modal. `badge` renders the trigger as the same compact ordinal-day pill the
   * mission list row uses (`MissionDueDateBadge`), with just a calendar glyph
   * while unset, so a task row can carry an editable due date without a full
   * button.
   */
  size?: 'sm' | 'default' | 'badge';
  /** Label shown on the trigger while no due date is set. */
  emptyLabel?: string;
  heading?: string;
  description?: string;
};

/**
 * Shared due-date control: a trigger button that opens a date picker with Save
 * and Clear actions. Purely controlled — the caller owns persistence, so the
 * same button serves saved missions, Inbox captures, and not-yet-created work.
 */
export function DueDatePickerButton({
  value,
  onChange,
  disabled = false,
  size = 'default',
  emptyLabel = 'Set due date',
  heading = 'Next due date',
  description = 'Set a one-time due date without changing the recurring schedule.'
}: DueDatePickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => parseDueDate(value));
  const [saveButtonState, setSaveButtonState] = useState<ButtonLoadingState>('default');
  const [clearButtonState, setClearButtonState] = useState<ButtonLoadingState>('default');

  useEffect(() => {
    setSelectedDate(parseDueDate(value));
  }, [value]);

  async function handleSaveDueDate() {
    if (!selectedDate) return;

    setSaveButtonState('loading');

    try {
      await onChange(buildDueDatetime({ selectedDate, currentDueDatetime: value }));
      setSaveButtonState('success');
      setOpen(false);
    } catch {
      setSaveButtonState('error');
    }
  }

  async function handleClearDueDate() {
    setClearButtonState('loading');

    try {
      await onChange(null);
      setSelectedDate(undefined);
      setClearButtonState('success');
      setOpen(false);
    } catch {
      setClearButtonState('error');
    }
  }

  const label = formatDueDateLabel(value, emptyLabel);
  const badgeDate = size === 'badge' ? parseDueDate(value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            aria-label={label}
            title={label}
            onClick={event => event.stopPropagation()}
            className={cn(
              'inline-flex items-center rounded-md border font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60',
              size === 'sm' && 'h-8 gap-1.5 px-2 text-xs',
              size === 'default' && 'gap-1.5 px-2.5 py-1.5 text-xs',
              size === 'badge' && 'h-5 shrink-0 gap-1 rounded-full px-1.5 text-[9px] tabular-nums',
              value
                ? 'border-sky-400/40 text-sky-700 dark:border-sky-500/30 dark:text-sky-300'
                : 'border-input text-muted-foreground',
              // An unset badge stays out of the way until the row is hovered or focused.
              size === 'badge' &&
                !value &&
                'border-dashed opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100'
            )}
          />
        }
      >
        {size === 'badge' ? (
          badgeDate ? (
            <span>{formatOrdinalDayOfMonth(badgeDate)}</span>
          ) : (
            <CalendarDays className="h-3 w-3 shrink-0" />
          )
        ) : (
          <>
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-[140px] truncate">{label}</span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-medium">{heading}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>

        <div className="p-4">
          <input
            type="date"
            aria-label="Due date"
            value={selectedDate ? toDateInputValue(selectedDate) : ''}
            onChange={event => {
              setSelectedDate(
                event.target.value ? fromDateInputValue(event.target.value) : undefined
              );
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

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
            disabled={!value}
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
