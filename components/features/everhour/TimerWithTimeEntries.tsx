'use client';

import { Info } from 'lucide-react';

import { TimeEntriesPanel } from '@/components/features/everhour/TimeEntriesPanel';
import { TimerButton } from '@/components/features/everhour/TimerButton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type TimerWithTimeEntriesProps = {
  initialTaskId: string | null;
  ticketId: string;
};

export function TimerWithTimeEntries({ initialTaskId, ticketId }: TimerWithTimeEntriesProps) {
  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <button
            aria-label="View time entries"
            className="text-muted-foreground hover:text-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors"
            type="button"
          >
            <Info className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 max-h-[80vh] overflow-y-auto p-0">
          <TimeEntriesPanel ticketId={ticketId} />
        </PopoverContent>
      </Popover>
      <TimerButton initialTaskId={initialTaskId} ticketId={ticketId} variant="compact" />
    </div>
  );
}
