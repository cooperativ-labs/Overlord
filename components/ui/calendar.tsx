'use client';

import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type CalendarProps = {
  className?: string;
  mode?: 'single';
  month?: Date;
  onMonthChange?: (month: Date) => void;
  onSelect?: (date: Date | undefined) => void;
  selected?: Date;
};

const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

export function Calendar({ className, month, onMonthChange, onSelect, selected }: CalendarProps) {
  const [internalMonth, setInternalMonth] = useState<Date>(() =>
    startOfMonth(month ?? selected ?? new Date())
  );

  useEffect(() => {
    if (month) {
      setInternalMonth(startOfMonth(month));
      return;
    }

    if (selected) {
      setInternalMonth(startOfMonth(selected));
    }
  }, [month, selected]);

  const currentMonth = month ? startOfMonth(month) : internalMonth;
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  function changeMonth(nextMonth: Date) {
    if (!month) {
      setInternalMonth(startOfMonth(nextMonth));
    }
    onMonthChange?.(startOfMonth(nextMonth));
  }

  return (
    <div className={cn('p-3', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => changeMonth(subMonths(currentMonth, 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-sm font-medium">{format(currentMonth, 'MMMM yyyy')}</div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => changeMonth(addMonths(currentMonth, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
        {DAY_HEADERS.map(day => (
          <div key={day} className="pb-1">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map(day => {
          const selectedDay = selected ? isSameDay(day, selected) : false;
          const inMonth = isSameMonth(day, currentMonth);

          return (
            <button
              key={day.toISOString()}
              type="button"
              className={cn(
                'flex h-9 items-center justify-center rounded-md text-sm transition-colors',
                selectedDay && 'bg-primary font-medium text-primary-foreground',
                !selectedDay && inMonth && 'hover:bg-accent hover:text-accent-foreground',
                !inMonth && 'text-muted-foreground/40',
                !selectedDay && isToday(day) && 'border border-primary/40'
              )}
              onClick={() => onSelect?.(day)}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>
    </div>
  );
}
