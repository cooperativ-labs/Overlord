'use client';

import type { DayNumber } from '@/lib/schedulingEngine/helpers/types';
import { cn } from '@/lib/utils';

import { LAST_DAY_OF_MONTH, LAST_WEEK_OF_MONTH } from './schedule-editor-helpers';
import { getDayLabel, getOrdinalLabel } from './schedule-utils';

// --- Day toggle buttons for daily/weekly ---

export function DayToggles({
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

export function MonthDayToggles({
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
    [LAST_DAY_OF_MONTH]
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
              {day === LAST_DAY_OF_MONTH ? 'Last' : day}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// --- Week of month selector ---

export function WeekOfMonthToggles({
  selectedWeeks,
  onToggle
}: {
  selectedWeeks: Set<number>;
  onToggle: (week: number) => void;
}) {
  const weeks = [1, 2, 3, LAST_WEEK_OF_MONTH];
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
