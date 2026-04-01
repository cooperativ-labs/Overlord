'use client';

import { CalendarClock } from 'lucide-react';

import { cn } from '@/lib/utils';

export function ScheduleBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-violet-400/40 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:border-violet-500/30 dark:bg-violet-950/30 dark:text-violet-400',
        className
      )}
      title="This ticket has a recurring schedule"
      aria-label="Recurring schedule"
    >
      <CalendarClock className="h-2.5 w-2.5" />
      <span>Recurring</span>
    </span>
  );
}
