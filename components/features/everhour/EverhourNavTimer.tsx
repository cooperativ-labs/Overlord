'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@/components/ui/popover';
import type { EverhourTimer } from '@/lib/actions/everhour';
import { cn } from '@/lib/utils';

import { TimeEntriesPanel } from './TimeEntriesPanel';
import { useEverhourTimer } from './use-everhour-timer';

function getElapsedFromTimer(timer: EverhourTimer): number {
  if (typeof timer.duration === 'number') return timer.duration;
  if (typeof timer.today === 'number') return timer.today;
  return 0;
}

function formatElapsed(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Everhour request failed.';
}

export function deriveTicketIdFromPath(pathname: string) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === 'projects' && typeof segments[2] === 'string') {
    return segments[2];
  }
  if (segments[0] === 'u' && typeof segments[1] === 'string') {
    return segments[1];
  }
  return null;
}

export function shouldShowNavTimerTimeEntriesContext({
  ticketId,
  everhourTaskId
}: {
  ticketId: string | null;
  everhourTaskId: string | null;
}) {
  return Boolean(ticketId || everhourTaskId);
}

export function EverhourNavTimer() {
  const pathname = usePathname();
  const ticketId = useMemo(() => deriveTicketIdFromPath(pathname ?? ''), [pathname]);
  const { timer, errorMessage: pollError, startForTicket, stop } = useEverhourTimer();
  const [elapsedSeconds, setElapsedSeconds] = useState(() => getElapsedFromTimer(timer));
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);

  const isRunning = timer.status === 'active';
  const everhourTaskId = timer.task?.id ?? null;
  const hasTicketContext = Boolean(ticketId);

  useEffect(() => {
    setElapsedSeconds(getElapsedFromTimer(timer));
  }, [timer]);

  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setElapsedSeconds(previous => previous + 1);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isRunning]);

  const title = timer.task?.name ?? 'No timer running';
  const badge = isRunning ? formatElapsed(elapsedSeconds) : null;
  const description = isRunning
    ? `Elapsed ${formatElapsed(elapsedSeconds)}`
    : 'No timer is running right now.';

  const actionLabel = isRunning ? 'Stop timer' : 'Start timer';
  const isStartDisabled = !isRunning && !hasTicketContext;
  const isButtonDisabled = isActionPending || isStartDisabled;
  const shouldShowTimeEntries = shouldShowNavTimerTimeEntriesContext({
    everhourTaskId,
    ticketId
  });

  const handleAction = useCallback(async () => {
    setActionError(null);
    setIsActionPending(true);

    try {
      if (isRunning) {
        await stop();
      } else if (ticketId) {
        await startForTicket(ticketId);
      }
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setIsActionPending(false);
    }
  }, [isRunning, ticketId, startForTicket, stop]);

  return (
    <Popover>
      <div className="flex justify-end">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={isRunning ? `Everhour timer: ${title}` : 'Open Everhour timer controls'}
            className={cn(
              'flex shrink-0 items-center justify-center rounded-full border transition-[width,background-color,box-shadow,border] duration-200 ease-in-out',
              isRunning
                ? 'min-w-[70px] gap-2 border-red-500/40 bg-red-500/15 text-red-600   px-1 py-2 text-xs font-semibold  '
                : 'border-0 bg-transparent'
            )}
          >
            <span className="pointer-events-none text-[11px]" aria-live="polite">
              {badge}
            </span>
            {!isRunning ? <span className="sr-only"> No active timer</span> : null}
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="max-h-[70vh] w-[26rem] overflow-y-auto">
        <PopoverHeader>
          <PopoverTitle className="truncate text-base">{title}</PopoverTitle>
          <PopoverDescription className="truncate text-sm">{description}</PopoverDescription>
        </PopoverHeader>
        <div className="mt-4 flex flex-col gap-3">
          {shouldShowTimeEntries ? (
            <TimeEntriesPanel ticketId={ticketId} everhourTaskId={everhourTaskId} />
          ) : null}
          <Button
            variant={isRunning ? 'destructive' : 'outline'}
            className="w-full"
            size="sm"
            disabled={isButtonDisabled}
            onClick={handleAction}
          >
            {isActionPending ? 'Working…' : actionLabel}
          </Button>
          {!isRunning && !hasTicketContext ? (
            <p className="text-xs text-muted-foreground">
              Open a ticket in the side panel to start an Everhour timer.
            </p>
          ) : null}
          {actionError || pollError ? (
            <p className="text-xs text-destructive">{actionError ?? pollError}</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
