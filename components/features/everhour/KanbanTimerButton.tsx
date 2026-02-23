'use client';

import { Play, StopCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useEverhourTimer } from '@/components/features/everhour/use-everhour-timer';
import type { EverhourTimer } from '@/lib/actions/everhour';

type KanbanTimerButtonProps = {
  initialTaskId: string | null;
  ticketId: string;
  className?: string;
};

function getElapsedFromTimer(timer: EverhourTimer): number {
  if (typeof timer.duration === 'number') return timer.duration;
  if (typeof timer.today === 'number') return timer.today;
  return 0;
}

function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function KanbanTimerButton({ initialTaskId, ticketId, className }: KanbanTimerButtonProps) {
  const [knownTaskId, setKnownTaskId] = useState<string | null>(initialTaskId);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const { timer, refresh, startForTicket, stop } = useEverhourTimer();

  useEffect(() => {
    if (initialTaskId) {
      setKnownTaskId(previous => previous ?? initialTaskId);
    }
  }, [initialTaskId]);

  const timerTaskId = timer.task?.id ?? null;
  const isRunningThisTicket =
    timer.status === 'active' && knownTaskId !== null && timerTaskId === knownTaskId;

  useEffect(() => {
    setElapsedSeconds(getElapsedFromTimer(timer));
    if (timer.task?.id && timer.task.id === initialTaskId) {
      setKnownTaskId(timer.task.id);
    }
  }, [initialTaskId, timer]);

  useEffect(() => {
    if (!isRunningThisTicket) return;
    const tick = window.setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    return () => window.clearInterval(tick);
  }, [isRunningThisTicket]);

  const tooltip = useMemo(() => {
    if (isRunningThisTicket) return `Stop timer (${formatElapsed(elapsedSeconds)})`;
    return 'Start Everhour timer';
  }, [elapsedSeconds, isRunningThisTicket]);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (isLoading) return;

    setIsLoading(true);
    try {
      if (isRunningThisTicket) {
        await stop();
        await refresh();
      } else {
        const startedTimer = await startForTicket(ticketId);
        if (startedTimer.task?.id) {
          setKnownTaskId(startedTimer.task.id);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <button
      aria-label={tooltip}
      className={`flex shrink-0 items-center justify-center gap-1 rounded-full border transition-colors disabled:opacity-50 ${
        isRunningThisTicket
          ? 'border-red-500/60 bg-red-500 text-white hover:bg-red-600 h-5 px-2'
          : 'h-5 w-5 border-border bg-muted/50 text-muted-foreground hover:border-emerald-500/60 hover:bg-emerald-500/15 hover:text-emerald-600'
      } ${className ?? ''}`}
      onClick={handleClick}
      title={tooltip}
      type="button"
    >
      {isLoading ? (
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : isRunningThisTicket ? (
        <>
          <StopCircle className="h-3 w-3" />
          <span className="font-mono text-[10px]">{formatElapsed(elapsedSeconds)}</span>
        </>
      ) : (
        <Play className="ml-0.5 h-3 w-3" />
      )}
    </button>
  );
}
