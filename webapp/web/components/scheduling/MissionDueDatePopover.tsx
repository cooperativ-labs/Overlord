import type { WeekDayType } from '@overlord/automations/scheduling-engine';
import { CalendarDays, Loader2, Repeat, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { MissionDetailDto, ScheduleDto } from '../../../shared/contract.ts';
import {
  buildDueDatetime,
  fromDateInputValue,
  parseDueDate,
  toDateInputValue
} from '../../lib/due-datetime.ts';
import {
  useClearMissionSchedule,
  useMissionSchedule,
  usePreviewScheduleDueDatetime,
  useUpdateMission,
  useUpsertMissionSchedule
} from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import { Button } from '../ui/button.tsx';
import type { ButtonLoadingState } from '../ui/loading-button.tsx';
import { LoadingButton } from '../ui/loading-button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx';
import { Switch } from '../ui/switch.tsx';

import { RecurrenceFields } from './RecurrenceFields.tsx';
import {
  createDefaultState,
  createStateFromInitialSchedule,
  getValidationMessage,
  normalizeDaysOfMonth,
  normalizeWeeksOfMonth,
  type ScheduleState,
  stateToInput
} from './schedule-editor-helpers.ts';
import { summarizeSchedule } from './schedule-utils.ts';

function stateFromScheduleDto(schedule: ScheduleDto): ScheduleState {
  return createStateFromInitialSchedule({
    periodType: schedule.periodType,
    periodInterval: schedule.periodInterval,
    daysOfWeek: schedule.daysOfWeek as WeekDayType[],
    daysOfMonth: schedule.daysOfMonth,
    weeksOfMonth: schedule.weeksOfMonth,
    timezone: schedule.timezone,
    nextStatusKey: schedule.nextStatusKey
  });
}

function normalizeState(state: ScheduleState): ScheduleState {
  return {
    ...state,
    daysOfMonth: normalizeDaysOfMonth(state.daysOfMonth),
    weeksOfMonth: normalizeWeeksOfMonth(state.weeksOfMonth)
  };
}

function sameState(left: ScheduleState | null, right: ScheduleState | null): boolean {
  if (!left || !right) return left === right;
  return JSON.stringify(normalizeState(left)) === JSON.stringify(normalizeState(right));
}

function sameDay(left: Date | undefined, right: Date | undefined): boolean {
  if (!left || !right) return left === right;
  return toDateInputValue(left) === toDateInputValue(right);
}

function addDays(days: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

/** `Mar 4`, or `Mar 4, 2027` outside the current year — short enough for the header pill. */
function formatTriggerDate(date: Date): string {
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  }).format(date);
}

function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

const QUICK_PICKS = [
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'Next week', days: 7 }
] as const;

/**
 * One header control for "when is this due" and "does it repeat". The trigger
 * shows the next due date (plus a repeat glyph when a schedule exists); the
 * popover edits both as a single draft committed by one Save:
 *
 * - **Due** — the next due date. While Repeat is on and the date is untouched it
 *   follows the schedule's computed next occurrence; picking a date by hand
 *   overrides only that occurrence.
 * - **Repeat** — a switch that reveals the recurrence form. Turning it off
 *   removes the schedule but keeps the shown due date.
 */
export function MissionDueDatePopover({ mission }: { mission: MissionDetailDto }) {
  const hasSchedule = mission.scheduleId !== null;
  const currentDueDatetime = mission.dueDatetime;
  const currentDate = parseDueDate(currentDueDatetime);

  const scheduleQ = useMissionSchedule(mission.id, { enabled: hasSchedule });
  const updateMission = useUpdateMission(mission.id);
  const upsertSchedule = useUpsertMissionSchedule(mission.id);
  const clearSchedule = useClearMissionSchedule(mission.id);
  const { mutateAsync: previewScheduleDueDatetime, isPending: isPreviewPending } =
    usePreviewScheduleDueDatetime();

  const savedSchedule = useMemo(
    () =>
      hasSchedule && scheduleQ.data?.schedule
        ? stateFromScheduleDto(scheduleQ.data.schedule)
        : null,
    [hasSchedule, scheduleQ.data]
  );
  const scheduleLoading = hasSchedule && scheduleQ.isPending;

  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState<Date | undefined>(currentDate);
  const [dateTouched, setDateTouched] = useState(false);
  const [repeatOn, setRepeatOn] = useState(hasSchedule);
  const [draftSchedule, setDraftSchedule] = useState<ScheduleState | null>(savedSchedule);
  const [previewDueDatetime, setPreviewDueDatetime] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveButtonState, setSaveButtonState] = useState<ButtonLoadingState>('default');

  // Each open starts a fresh draft from the saved values. The schedule half
  // waits for the saved schedule to load, and is seeded only once per open so
  // a background refetch never wipes in-progress edits.
  const scheduleSeededRef = useRef(false);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      scheduleSeededRef.current = false;
      return;
    }
    setDraftDate(parseDueDate(currentDueDatetime));
    setDateTouched(false);
    setRepeatOn(hasSchedule);
    setErrorMessage(null);
    setSaveButtonState('default');
  }

  useEffect(() => {
    if (!open || scheduleSeededRef.current || scheduleLoading) return;
    scheduleSeededRef.current = true;
    setDraftSchedule(savedSchedule);
  }, [open, savedSchedule, scheduleLoading]);

  const scheduleDirty = repeatOn && !sameState(draftSchedule, savedSchedule);
  const removingSchedule = !repeatOn && hasSchedule;
  const dateDirty = dateTouched && !sameDay(draftDate, currentDate);
  const hasChanges = scheduleDirty || removingSchedule || dateDirty;
  const validationMessage = repeatOn && draftSchedule ? getValidationMessage(draftSchedule) : null;

  useEffect(() => {
    if (!open || !scheduleDirty || !draftSchedule || getValidationMessage(draftSchedule)) {
      setPreviewDueDatetime(null);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      previewScheduleDueDatetime({
        schedule: stateToInput(draftSchedule),
        itemDueDatetime: currentDueDatetime
      })
        .then(result => {
          if (!cancelled) setPreviewDueDatetime(result.dueDatetime);
        })
        .catch(() => {
          if (!cancelled) setPreviewDueDatetime(null);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [currentDueDatetime, draftSchedule, open, previewScheduleDueDatetime, scheduleDirty]);

  // Until the user picks a date by hand, a changed schedule drives the date shown.
  const followsSchedule = repeatOn && !dateTouched && scheduleDirty;
  const shownDate = followsSchedule ? (parseDueDate(previewDueDatetime) ?? draftDate) : draftDate;

  function pickDate(next: Date | undefined) {
    setDraftDate(next);
    setDateTouched(true);
    setErrorMessage(null);
    setSaveButtonState('default');
  }

  function toggleRepeat(checked: boolean) {
    setRepeatOn(checked);
    if (checked && !draftSchedule) setDraftSchedule(savedSchedule ?? createDefaultState());
    setErrorMessage(null);
    setSaveButtonState('default');
  }

  function changeSchedule(next: ScheduleState) {
    setDraftSchedule(next);
    setErrorMessage(null);
    setSaveButtonState('default');
  }

  async function handleSave() {
    if (validationMessage) {
      setErrorMessage(validationMessage);
      setSaveButtonState('error');
      return;
    }

    setSaveButtonState('loading');
    setErrorMessage(null);
    try {
      if (scheduleDirty && draftSchedule) {
        await upsertSchedule.mutateAsync(stateToInput(normalizeState(draftSchedule)));
      }
      if (removingSchedule) {
        // Clearing a schedule also clears the due date server-side.
        await clearSchedule.mutateAsync();
      }
      // A hand-picked date overrides the schedule's next occurrence; removing a
      // schedule restores whatever date the popover was showing.
      if (dateDirty || (removingSchedule && draftDate)) {
        await updateMission.mutateAsync({
          dueDatetime: draftDate
            ? buildDueDatetime({ selectedDate: draftDate, currentDueDatetime })
            : null
        });
      }
      setSaveButtonState('success');
      handleOpenChange(false);
    } catch {
      setSaveButtonState('error');
      setErrorMessage('We could not save these changes. Please try again.');
    }
  }

  const triggerSummary = savedSchedule ? summarizeSchedule(stateToInput(savedSchedule)) : null;
  const draftSummary =
    repeatOn && draftSchedule && !validationMessage
      ? summarizeSchedule(stateToInput(draftSchedule))
      : null;
  const triggerLabel = currentDate ? formatTriggerDate(currentDate) : 'Due date';
  const triggerTitle = [
    currentDate ? `Due ${formatLongDate(currentDate)}` : 'No due date',
    triggerSummary ? `Repeats: ${triggerSummary}` : null
  ]
    .filter(Boolean)
    .join(' · ');

  let dateHint: string | null = null;
  if (repeatOn && followsSchedule) {
    dateHint = isPreviewPending ? 'Calculating from the schedule…' : 'Set by the repeat schedule.';
  } else if (repeatOn && dateTouched) {
    dateHint = 'Overrides the next occurrence only; the schedule continues after it.';
  } else if (repeatOn) {
    dateHint = 'Next occurrence. Pick a date to override it once.';
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={triggerTitle}
            title={triggerTitle}
            className={cn(
              'inline-flex h-7 max-w-[160px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium tabular-nums transition-colors hover:bg-accent',
              currentDate || hasSchedule
                ? 'border-sky-400/40 text-sky-700 dark:border-sky-500/30 dark:text-sky-300'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          />
        }
      >
        <CalendarDays className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{triggerLabel}</span>
        {hasSchedule ? (
          <Repeat className="h-3 w-3 shrink-0 text-violet-600 dark:text-violet-400" />
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <section className="flex flex-col gap-2 px-4 pt-3 pb-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{repeatOn ? 'Next due' : 'Due'}</h3>
            {shownDate ? (
              <span className="text-xs text-muted-foreground">{formatLongDate(shownDate)}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              aria-label="Due date"
              value={shownDate ? toDateInputValue(shownDate) : ''}
              onChange={event =>
                pickDate(event.target.value ? fromDateInputValue(event.target.value) : undefined)
              }
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8"
              aria-label="Clear due date"
              title="Clear due date"
              disabled={!shownDate}
              onClick={() => pickDate(undefined)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex gap-1">
            {QUICK_PICKS.map(pick => {
              const date = addDays(pick.days);
              return (
                <button
                  key={pick.label}
                  type="button"
                  onClick={() => pickDate(date)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px] transition-colors hover:bg-muted',
                    sameDay(shownDate, date)
                      ? 'border-primary bg-primary text-primary-foreground hover:bg-primary'
                      : 'border-input text-muted-foreground'
                  )}
                >
                  {pick.label}
                </button>
              );
            })}
          </div>
          {dateHint ? <p className="text-[11px] text-muted-foreground">{dateHint}</p> : null}
        </section>

        <section className="flex flex-col gap-3 border-t px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <Repeat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">Repeat</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {repeatOn
                    ? (draftSummary ?? 'Finish choosing when it repeats')
                    : 'Duplicate this mission on a schedule'}
                </span>
              </span>
            </span>
            <Switch
              checked={repeatOn}
              disabled={scheduleLoading}
              onCheckedChange={toggleRepeat}
              aria-label="Repeat"
            />
          </div>

          {scheduleLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : repeatOn && draftSchedule ? (
            <RecurrenceFields
              schedule={draftSchedule}
              statuses={mission.statuses}
              onChange={changeSchedule}
            />
          ) : null}

          {removingSchedule ? (
            <p className="text-[11px] text-muted-foreground">
              Saving removes the schedule. The due date above is kept.
            </p>
          ) : null}
        </section>

        <footer className="flex items-center gap-2 border-t px-4 py-3">
          {errorMessage ? (
            <p className="min-w-0 flex-1 text-[11px] text-destructive">{errorMessage}</p>
          ) : (
            <span className="flex-1" />
          )}
          <Button type="button" variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton
            buttonState={hasChanges || saveButtonState !== 'default' ? saveButtonState : 'disabled'}
            setButtonState={setSaveButtonState}
            size="sm"
            text="Save"
            loadingText="Saving..."
            successText="Saved"
            errorText="Save failed"
            reset
            onClick={handleSave}
          />
        </footer>
      </PopoverContent>
    </Popover>
  );
}
