import type { PeriodType, WeekDayType } from '@overlord/automations/scheduling-engine';

import type { ProjectStatusDto } from '../../../shared/contract.ts';
import { Badge } from '../ui/badge.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.tsx';

import {
  LAST_DAY_OF_MONTH,
  LAST_WEEK_OF_MONTH,
  normalizeDaysOfMonth,
  normalizeWeeksOfMonth,
  type ScheduleState
} from './schedule-editor-helpers.ts';
import { getPeriodIntervalName } from './schedule-utils.ts';
import { DayToggles, MonthDayToggles, WeekOfMonthToggles } from './ScheduleToggles.tsx';

type RecurrenceFieldsProps = {
  schedule: ScheduleState;
  statuses: ProjectStatusDto[];
  /** Receives the whole next state; the caller owns dirty tracking. */
  onChange: (next: ScheduleState) => void;
};

const PERIOD_TYPES: PeriodType[] = ['d', 'w', 'm'];

/**
 * The recurrence form ("Every N weeks on Mon, Wed at 9:00 AM") without any
 * chrome or persistence, so the due-date popover can embed it under its
 * Repeat switch.
 */
export function RecurrenceFields({ schedule, statuses, onChange }: RecurrenceFieldsProps) {
  const selectedDays = new Set(schedule.daysOfWeek.map(d => d.dayNum));
  const selectedMonthDays = new Set(schedule.daysOfMonth ?? []);
  const selectedWeeks = new Set(schedule.weeksOfMonth ?? []);
  const selectedNextStatus = schedule.nextStatusKey
    ? statuses.find(status => status.key === schedule.nextStatusKey)
    : null;

  function update(partial: Partial<ScheduleState>) {
    onChange({ ...schedule, ...partial });
  }

  function toggleDay(day: WeekDayType['dayNum']) {
    const existing = schedule.daysOfWeek.find(d => d.dayNum === day);
    update({
      daysOfWeek: existing
        ? schedule.daysOfWeek.filter(d => d.dayNum !== day)
        : [...schedule.daysOfWeek, { dayNum: day, times: [schedule.time || '09:00'] }]
    });
  }

  function toggleMonthDay(day: number) {
    const current = schedule.daysOfMonth ?? [];
    const normalizedDay = day >= 29 && day <= 31 ? LAST_DAY_OF_MONTH : day;
    update({
      daysOfMonth: current.includes(normalizedDay)
        ? current.filter(d => d !== normalizedDay)
        : normalizeDaysOfMonth([...current, normalizedDay])
    });
  }

  function toggleWeekOfMonth(week: number) {
    const current = schedule.weeksOfMonth ?? [];
    const normalizedWeek = week >= 4 && week <= 5 ? LAST_WEEK_OF_MONTH : week;
    update({
      weeksOfMonth: current.includes(normalizedWeek)
        ? current.filter(w => w !== normalizedWeek)
        : normalizeWeeksOfMonth([...current, normalizedWeek])
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Label className="w-12 shrink-0 text-xs text-muted-foreground">Every</Label>
        <Input
          type="number"
          min={1}
          max={365}
          aria-label="Repeat interval"
          value={schedule.periodInterval}
          onChange={event =>
            update({
              periodInterval: Math.max(1, Math.min(365, Number(event.target.value) || 1))
            })
          }
          className="h-8 w-16 text-center text-xs"
        />
        <Select
          value={schedule.periodType}
          onValueChange={value => {
            const periodType = value as PeriodType;
            update({
              periodType,
              ...(periodType === 'm'
                ? { daysOfWeek: [], daysOfMonth: [], weeksOfMonth: [] }
                : { daysOfMonth: undefined, weeksOfMonth: undefined })
            });
          }}
        >
          <SelectTrigger className="h-8 w-auto min-w-[100px] text-xs">
            <SelectValue>
              {getPeriodIntervalName({
                periodType: schedule.periodType,
                periodInterval: schedule.periodInterval
              })}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PERIOD_TYPES.map(periodType => (
              <SelectItem key={periodType} value={periodType}>
                {getPeriodIntervalName({ periodType, periodInterval: schedule.periodInterval })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {schedule.periodType === 'w' && (
        <div className="flex items-start gap-2">
          <Label className="w-12 shrink-0 pt-1.5 text-xs text-muted-foreground">On</Label>
          <DayToggles selectedDays={selectedDays} onToggle={toggleDay} />
        </div>
      )}

      {schedule.periodType === 'm' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Label className="w-12 shrink-0 text-xs text-muted-foreground">By</Label>
            <div className="flex gap-1">
              <Badge
                variant={schedule.monthlyMode === 'dayOfMonth' ? 'default' : 'outline'}
                className="cursor-pointer select-none"
                onClick={() => update({ monthlyMode: 'dayOfMonth' })}
              >
                Day of month
              </Badge>
              <Badge
                variant={schedule.monthlyMode === 'weekOfMonth' ? 'default' : 'outline'}
                className="cursor-pointer select-none"
                onClick={() => update({ monthlyMode: 'weekOfMonth' })}
              >
                Week + day
              </Badge>
            </div>
          </div>

          {schedule.monthlyMode === 'dayOfMonth' ? (
            <div className="flex items-start gap-2">
              <Label className="w-12 shrink-0 pt-1 text-xs text-muted-foreground">Days</Label>
              <MonthDayToggles selectedDays={selectedMonthDays} onToggle={toggleMonthDay} />
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2">
                <Label className="w-12 shrink-0 pt-1.5 text-xs text-muted-foreground">Week</Label>
                <WeekOfMonthToggles selectedWeeks={selectedWeeks} onToggle={toggleWeekOfMonth} />
              </div>
              <div className="flex items-start gap-2">
                <Label className="w-12 shrink-0 pt-1.5 text-xs text-muted-foreground">On</Label>
                <DayToggles selectedDays={selectedDays} onToggle={toggleDay} />
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Label className="w-12 shrink-0 text-xs text-muted-foreground">At</Label>
        <Input
          type="time"
          aria-label="Repeat time"
          value={schedule.time}
          onChange={event => update({ time: event.target.value })}
          className="h-8 w-auto text-xs"
        />
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {schedule.timezone}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Label className="w-12 shrink-0 text-xs leading-tight text-muted-foreground">Copy to</Label>
        <Select
          value={schedule.nextStatusKey ?? '__default__'}
          onValueChange={value => update({ nextStatusKey: value === '__default__' ? null : value })}
        >
          <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label="Duplicate lands in">
            <SelectValue placeholder="Project default">
              {selectedNextStatus?.name ?? 'Project default'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">Project default</SelectItem>
            {statuses.map(status => (
              <SelectItem key={status.id} value={status.key}>
                {status.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
