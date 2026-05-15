'use client';

import { Info } from 'lucide-react';

import { TimeEntriesPanel } from '@/components/features/everhour/TimeEntriesPanel';
import { TimerButton } from '@/components/features/everhour/TimerButton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type TimerWithTimeEntriesProps = {
  initialTaskId: string | null;
  ticketId: string;
  everhourIntegration: {
    api_key: string;
  } | null;
};

export function TimerWithTimeEntries({
  initialTaskId,
  ticketId,
  everhourIntegration
}: TimerWithTimeEntriesProps) {
  const everhourApiKey =
    typeof everhourIntegration?.api_key === 'string' ? everhourIntegration.api_key.trim() : '';
  const hasEverhourApiKey = everhourApiKey.length > 0;

  if (!hasEverhourApiKey) {
    return null;
  }

  return (
    <div className="bg-muted/30 border-b border-muted/70">
      <section className="flex items-center justify-between gap-2 px-4 py-2">
        <div>
          <h2 className="eyebrow mb-1">Time Tracking</h2>
          <p className="text-muted-foreground text-sm line-clamp-1 truncate">
            Track time on this ticket.
          </p>
        </div>
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
      </section>
    </div>
  );
}
