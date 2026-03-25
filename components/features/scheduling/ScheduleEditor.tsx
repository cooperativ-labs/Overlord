'use client';

import { CalendarClock, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  clearTicketScheduleAction,
  getTicketScheduleAction,
  upsertTicketScheduleAction
} from '@/lib/actions/ticket-schedules';
import type { DayNumber, PeriodType, WeekDayType } from '@/lib/schedulingEngine/helpers/types';
import type { ScheduleInput } from '@/lib/schemas/schedule';
import { cn } from '@/lib/utils';

import {
  getDayLabel,
  getDefaultSchedule,
  getOrdinalLabel,
  summarizeSchedule
} from './schedule-utils';

export type ScheduleEditorInitialSchedule = {
  daysOfMonth?: number[];
  daysOfWeek: WeekDayType[];
  periodInterval: number;
  periodType: PeriodType;
  timezone: string;
  weeksOfMonth?: number[];
};

type ScheduleEditorProps = {
  ticketId: string;
  hasSchedule: boolean;
  initialSchedule?: ScheduleEditorInitialSchedule | null;
  onScheduleChange?: (hasSchedule: boolean) => void;
};

type ScheduleState = {
  periodType: PeriodType;
  periodInterval: number;
  daysOfWeek: WeekDayType[];
  daysOfMonth?: number[];
  weeksOfMonth?: number[];
  timezone: string;
  time: string;
  monthlyMode: 'dayOfMonth' | 'weekOfMonth';
};

function createStateFromInitialSchedule(
  initialSchedule: ScheduleEditorInitialSchedule
): ScheduleState {
  const daysOfWeek = initialSchedule.daysOfWeek ?? [];
  const daysOfMonth = initialSchedule.daysOfMonth ?? [];
  const weeksOfMonth = initialSchedule.weeksOfMonth ?? [];

  return {
    periodType: initialSchedule.periodType,
    periodInterval: initialSchedule.periodInterval,
    daysOfWeek,
    daysOfMonth: daysOfMonth.length > 0 ? daysOfMonth : undefined,
    weeksOfMonth: weeksOfMonth.length > 0 ? weeksOfMonth : undefined,
    timezone: initialSchedule.timezone,
    time: extractTimeFromDaysOfWeek(daysOfWeek),
    monthlyMode: weeksOfMonth.length > 0 ? 'weekOfMonth' : 'dayOfMonth'
  };
}

function createDefaultState(): ScheduleState {
  const defaults = getDefaultSchedule();

  return {
    periodType: defaults.periodType,
    periodInterval: defaults.periodInterval,
    daysOfWeek: defaults.daysOfWeek,
    daysOfMonth: undefined,
    weeksOfMonth: undefined,
    timezone: defaults.timezone,
    time: '09:00',
    monthlyMode: 'dayOfMonth'
  };
}

function stateToInput(state: ScheduleState): ScheduleInput {
  const input: ScheduleInput = {
    periodType: state.periodType,
    periodInterval: state.periodInterval,
    timezone: state.timezone
  };

  if (state.periodType === 'd') {
    input.daysOfWeek = [{ dayNum: 1, times: [state.time || '09:00'] }];
  } else if (state.periodType === 'w') {
    input.daysOfWeek = state.daysOfWeek.map(d => ({
      dayNum: d.dayNum,
      times: [state.time || '09:00']
    }));
  } else if (state.periodType === 'm') {
    if (state.monthlyMode === 'dayOfMonth') {
      input.daysOfMonth = state.daysOfMonth;
    } else {
      input.weeksOfMonth = state.weeksOfMonth;
      input.daysOfWeek = state.daysOfWeek.map(d => ({
        dayNum: d.dayNum,
        times: [state.time || '09:00']
      }));
    }
  }

  return input;
}

function extractTimeFromDaysOfWeek(daysOfWeek: WeekDayType[]): string {
  for (const day of daysOfWeek) {
    if (day.times?.length > 0) return day.times[0];
  }
  return '09:00';
}

// --- Day toggle buttons for daily/weekly ---

function DayToggles({
  selectedDays,
  onToggle
}: {
  selectedDays: Set<number>;
  onToggle: (day: DayNumber) => void;
}) {
  const days: DayNumber[] = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun
  return (
    <div className="flex gap-1">
      {days.map(day => (
        <button
          key={day}
          type="button"
          onClick={() => onToggle(day)}
          className={cn(
            'flex h-7 w-8 items-center justify-center rounded-md border text-xs font-medium transition-colors',
            selectedDays.has(day)
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-input bg-background hover:bg-muted'
          )}
        >
          {getDayLabel(day)}
        </button>
      ))}
    </div>
  );
}

// --- Day of month toggles for monthly ---

function MonthDayToggles({
  selectedDays,
  onToggle
}: {
  selectedDays: Set<number>;
  onToggle: (day: number) => void;
}) {
  const rows = [
    [1, 2, 3, 4, 5, 6, 7],
    [8, 9, 10, 11, 12, 13, 14],
    [15, 16, 17, 18, 19, 20, 21],
    [22, 23, 24, 25, 26, 27, 28],
    [29, 30, 31, 32]
  ];

  return (
    <div className="flex flex-col gap-1">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1">
          {row.map(day => (
            <button
              key={day}
              type="button"
              onClick={() => onToggle(day)}
              className={cn(
                'flex h-6 min-w-7 items-center justify-center rounded border text-[10px] font-medium transition-colors',
                selectedDays.has(day)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background hover:bg-muted'
              )}
            >
              {day === 32 ? 'Last' : day}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// --- Week of month selector ---

function WeekOfMonthToggles({
  selectedWeeks,
  onToggle
}: {
  selectedWeeks: Set<number>;
  onToggle: (week: number) => void;
}) {
  const weeks = [1, 2, 3, 4, 5];
  return (
    <div className="flex gap-1">
      {weeks.map(week => (
        <button
          key={week}
          type="button"
          onClick={() => onToggle(week)}
          className={cn(
            'flex h-7 items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors',
            selectedWeeks.has(week)
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-input bg-background hover:bg-muted'
          )}
        >
          {getOrdinalLabel(week)}
        </button>
      ))}
    </div>
  );
}

// --- Main component ---

export function ScheduleEditor({
  ticketId,
  hasSchedule,
  initialSchedule = null,
  onScheduleChange
}: ScheduleEditorProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearButtonState, setClearButtonState] = useState<ButtonLoadingState>('default');
  const [loaded, setLoaded] = useState(() => Boolean(initialSchedule));
  const [schedule, setSchedule] = useState<ScheduleState | null>(() =>
    initialSchedule ? createStateFromInitialSchedule(initialSchedule) : null
  );
  const scheduleRef = useRef<ScheduleState | null>(null);
  const initialHashRef = useRef<string>(
    initialSchedule ? JSON.stringify(createStateFromInitialSchedule(initialSchedule)) : ''
  );
  const [optimisticHasSchedule, setOptimisticHasSchedule] = useState(hasSchedule);

  // Sync prop changes
  useEffect(() => {
    setOptimisticHasSchedule(hasSchedule);
  }, [hasSchedule]);

  useEffect(() => {
    if (!initialSchedule) return;

    const nextState = createStateFromInitialSchedule(initialSchedule);
    setSchedule(nextState);
    scheduleRef.current = nextState;
    initialHashRef.current = JSON.stringify(nextState);
    setLoaded(true);
  }, [initialSchedule]);

  const hashState = useCallback((state: ScheduleState | null): string => {
    if (!state) return '';
    return JSON.stringify(state);
  }, []);

  // Load schedule when popover opens
  useEffect(() => {
    if (!open || loaded) return;

    let cancelled = false;
    setLoading(true);

    getTicketScheduleAction(ticketId)
      .then(result => {
        if (cancelled) return;

        if (result.schedule) {
          const state = createStateFromInitialSchedule({
            periodType: (result.schedule.periodType as PeriodType) || 'd',
            periodInterval: result.schedule.periodInterval ?? 1,
            daysOfWeek: Array.isArray(result.schedule.daysOfWeek)
              ? (result.schedule.daysOfWeek as WeekDayType[])
              : [],
            daysOfMonth: Array.isArray(result.schedule.daysOfMonth)
              ? result.schedule.daysOfMonth
              : undefined,
            weeksOfMonth: Array.isArray(result.schedule.weeksOfMonth)
              ? result.schedule.weeksOfMonth
              : undefined,
            timezone: result.schedule.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
          });
          setSchedule(state);
          scheduleRef.current = state;
          initialHashRef.current = JSON.stringify(state);
        } else {
          const state = createDefaultState();
          setSchedule(state);
          scheduleRef.current = state;
          initialHashRef.current = JSON.stringify(state);
        }

        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Fall back to defaults
        const state = createDefaultState();
        setSchedule(state);
        scheduleRef.current = state;
        initialHashRef.current = JSON.stringify(state);
        setLoaded(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, loaded, ticketId]);

  // Save on popover close
  const handleOpenChange = useCallback(
    async (nextOpen: boolean) => {
      if (!nextOpen && schedule && loaded) {
        const currentHash = hashState(schedule);
        if (currentHash !== initialHashRef.current) {
          const input = stateToInput(schedule);
          const isValid = validateState(schedule);
          if (isValid) {
            setSaving(true);
            setOptimisticHasSchedule(true);
            onScheduleChange?.(true);
            try {
              await upsertTicketScheduleAction(ticketId, input);
              initialHashRef.current = currentHash;
            } catch {
              // Revert optimistic update on failure
              setOptimisticHasSchedule(hasSchedule);
              onScheduleChange?.(hasSchedule);
            } finally {
              setSaving(false);
            }
          }
        }
      }
      setOpen(nextOpen);
      if (!nextOpen) {
        // Reset loaded state so it re-fetches next time
        setLoaded(false);
      }
    },
    [schedule, loaded, hashState, ticketId, hasSchedule, onScheduleChange]
  );

  function validateState(state: ScheduleState): boolean {
    if (state.periodType === 'd') {
      return true;
    }
    if (state.periodType === 'w') {
      return state.daysOfWeek.length > 0;
    }
    if (state.periodType === 'm') {
      if (state.monthlyMode === 'dayOfMonth') {
        return (state.daysOfMonth?.length ?? 0) > 0;
      }
      return (state.weeksOfMonth?.length ?? 0) > 0 && state.daysOfWeek.length > 0;
    }
    return false;
  }

  function updateSchedule(partial: Partial<ScheduleState>) {
    setSchedule(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...partial };
      scheduleRef.current = next;
      return next;
    });
  }

  function toggleDay(day: DayNumber) {
    setSchedule(prev => {
      if (!prev) return prev;
      const existing = prev.daysOfWeek.find(d => d.dayNum === day);
      const next = existing
        ? { ...prev, daysOfWeek: prev.daysOfWeek.filter(d => d.dayNum !== day) }
        : {
            ...prev,
            daysOfWeek: [...prev.daysOfWeek, { dayNum: day, times: [prev.time || '09:00'] }]
          };
      scheduleRef.current = next;
      return next;
    });
  }

  function toggleMonthDay(day: number) {
    setSchedule(prev => {
      if (!prev) return prev;
      const current = prev.daysOfMonth ?? [];
      const next = current.includes(day)
        ? { ...prev, daysOfMonth: current.filter(d => d !== day) }
        : { ...prev, daysOfMonth: [...current, day] };
      scheduleRef.current = next;
      return next;
    });
  }

  function toggleWeekOfMonth(week: number) {
    setSchedule(prev => {
      if (!prev) return prev;
      const current = prev.weeksOfMonth ?? [];
      const next = current.includes(week)
        ? { ...prev, weeksOfMonth: current.filter(w => w !== week) }
        : { ...prev, weeksOfMonth: [...current, week] };
      scheduleRef.current = next;
      return next;
    });
  }

  async function handleClearSchedule() {
    setClearButtonState('loading');
    setSaving(true);
    setOptimisticHasSchedule(false);
    onScheduleChange?.(false);
    try {
      await clearTicketScheduleAction(ticketId);
      setClearButtonState('success');
      initialHashRef.current = '';
      setSchedule(null);
      setLoaded(false);
      setOpen(false);
    } catch {
      setClearButtonState('error');
      setOptimisticHasSchedule(hasSchedule);
      onScheduleChange?.(hasSchedule);
    } finally {
      setSaving(false);
    }
  }

  const selectedDays = new Set(schedule?.daysOfWeek.map(d => d.dayNum) ?? []);
  const selectedMonthDays = new Set(schedule?.daysOfMonth ?? []);
  const selectedWeeks = new Set(schedule?.weeksOfMonth ?? []);

  const summaryText = schedule
    ? summarizeSchedule({
        periodType: schedule.periodType,
        periodInterval: schedule.periodInterval,
        daysOfWeek: schedule.daysOfWeek,
        daysOfMonth: schedule.daysOfMonth,
        weeksOfMonth: schedule.weeksOfMonth
      })
    : null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted',
            optimisticHasSchedule
              ? 'border-violet-400/40 text-violet-600 dark:border-violet-500/30 dark:text-violet-400'
              : 'border-input text-muted-foreground'
          )}
        >
          <CalendarClock className="h-3.5 w-3.5" />
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : optimisticHasSchedule && summaryText ? (
            <span className="max-w-[200px] truncate">{summaryText}</span>
          ) : (
            <span>Add schedule</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[360px] p-0"
        onPointerDownOutside={e => {
          // Prevent closing when interacting with select dropdowns
          const target = e.target as HTMLElement;
          if (target.closest('[data-slot="select-content"]')) {
            e.preventDefault();
          }
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : schedule ? (
          <div className="flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-medium">Schedule</h3>
              {optimisticHasSchedule && (
                <LoadingButton
                  buttonState={clearButtonState}
                  setButtonState={setClearButtonState}
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                  text={
                    <>
                      <Trash2 className="h-3 w-3" />
                      Remove
                    </>
                  }
                  loadingText={
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Removing...
                    </>
                  }
                  successText="Removed"
                  errorText="Remove failed"
                  reset
                  onClick={handleClearSchedule}
                />
              )}
            </div>

            <div className="flex flex-col gap-4 p-4">
              {/* Period type + interval */}
              <div className="flex items-center gap-2">
                <Label className="shrink-0 text-xs text-muted-foreground">Every</Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={schedule.periodInterval}
                  onChange={e =>
                    updateSchedule({
                      periodInterval: Math.max(1, Math.min(365, Number(e.target.value) || 1))
                    })
                  }
                  className="h-8 w-16 text-center text-xs"
                />
                <Select
                  value={schedule.periodType}
                  onValueChange={v => {
                    const periodType = v as PeriodType;
                    updateSchedule({
                      periodType,
                      // Reset selections when changing period type
                      ...(periodType === 'm'
                        ? { daysOfWeek: [], daysOfMonth: [], weeksOfMonth: [] }
                        : { daysOfMonth: undefined, weeksOfMonth: undefined })
                    });
                  }}
                >
                  <SelectTrigger className="h-8 w-auto min-w-[100px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="d">
                      {schedule.periodInterval === 1 ? 'day' : 'days'}
                    </SelectItem>
                    <SelectItem value="w">
                      {schedule.periodInterval === 1 ? 'week' : 'weeks'}
                    </SelectItem>
                    <SelectItem value="m">
                      {schedule.periodInterval === 1 ? 'month' : 'months'}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Day selection - daily/weekly */}
              {schedule.periodType === 'w' && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">On</Label>
                  <DayToggles selectedDays={selectedDays} onToggle={toggleDay} />
                </div>
              )}

              {/* Monthly configuration */}
              {schedule.periodType === 'm' && (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-1">
                    <Badge
                      variant={schedule.monthlyMode === 'dayOfMonth' ? 'default' : 'outline'}
                      className="cursor-pointer select-none"
                      onClick={() => updateSchedule({ monthlyMode: 'dayOfMonth' })}
                    >
                      Day of month
                    </Badge>
                    <Badge
                      variant={schedule.monthlyMode === 'weekOfMonth' ? 'default' : 'outline'}
                      className="cursor-pointer select-none"
                      onClick={() => updateSchedule({ monthlyMode: 'weekOfMonth' })}
                    >
                      Week + day
                    </Badge>
                  </div>

                  {schedule.monthlyMode === 'dayOfMonth' ? (
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">Days</Label>
                      <MonthDayToggles selectedDays={selectedMonthDays} onToggle={toggleMonthDay} />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs text-muted-foreground">Weeks</Label>
                        <WeekOfMonthToggles
                          selectedWeeks={selectedWeeks}
                          onToggle={toggleWeekOfMonth}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs text-muted-foreground">On</Label>
                        <DayToggles selectedDays={selectedDays} onToggle={toggleDay} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Time */}
              <div className="flex items-center gap-2">
                <Label className="shrink-0 text-xs text-muted-foreground">At</Label>
                <Input
                  type="time"
                  value={schedule.time}
                  onChange={e => updateSchedule({ time: e.target.value })}
                  className="h-8 w-auto text-xs"
                />
              </div>

              {/* Timezone */}
              <div className="flex items-center gap-2">
                <Label className="shrink-0 text-xs text-muted-foreground">Timezone</Label>
                <span className="truncate text-xs text-muted-foreground">{schedule.timezone}</span>
              </div>
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
