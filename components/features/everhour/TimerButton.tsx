'use client';

import { Play, StopCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useEverhourTimer } from '@/components/features/everhour/use-everhour-timer';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import type { EverhourTimer } from '@/lib/actions/everhour';

type TimerButtonProps = {
  initialTaskId: string | null;
  ticketId: string;
  variant?: 'compact' | 'default';
  className?: string;
};

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

function getElapsedFromTimer(timer: EverhourTimer): number {
  if (typeof timer.duration === 'number') return timer.duration;
  if (typeof timer.today === 'number') return timer.today;
  return 0;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Everhour request failed.';
}

export function TimerButton({
  initialTaskId,
  ticketId,
  variant = 'default',
  className
}: TimerButtonProps) {
  const [knownTaskId, setKnownTaskId] = useState<string | null>(initialTaskId);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { errorMessage: pollError, timer, refresh, startForTicket, stop } = useEverhourTimer();

  useEffect(() => {
    if (initialTaskId) {
      setKnownTaskId(previous => previous ?? initialTaskId);
    }
  }, [initialTaskId]);

  const timerTaskId = timer.task?.id ?? null;
  const isRunningThisTicket =
    timer.status === 'active' && knownTaskId !== null && timerTaskId === knownTaskId;
  const isRunningAnotherTicket = timer.status === 'active' && !isRunningThisTicket;

  useEffect(() => {
    setElapsedSeconds(getElapsedFromTimer(timer));
    if (timer.task?.id && timer.task.id === initialTaskId) {
      setKnownTaskId(timer.task.id);
    }
  }, [initialTaskId, timer]);

  useEffect(() => {
    if (!isRunningThisTicket) return;

    const tick = window.setInterval(() => {
      setElapsedSeconds(previous => previous + 1);
    }, 1000);

    return () => window.clearInterval(tick);
  }, [isRunningThisTicket]);

  const buttonText = useMemo(() => {
    if (isRunningThisTicket) return formatElapsed(elapsedSeconds);
    if (isRunningAnotherTicket) return 'Start';
    return 'Start';
  }, [elapsedSeconds, isRunningAnotherTicket, isRunningThisTicket]);

  async function handleTimerClick() {
    setButtonState('loading');
    setErrorMessage(null);

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
      setButtonState('success');
    } catch (error) {
      setButtonState('error');
      setErrorMessage(getErrorMessage(error));
    }
  }

  const isCompact = variant === 'compact';

  return (
    <div className={isCompact ? undefined : 'space-y-2'}>
      <div
        className={
          isCompact ? 'flex items-center gap-1' : 'flex items-center justify-between gap-2'
        }
      >
        <LoadingButton
          buttonState={buttonState}
          setButtonState={setButtonState}
          text={
            <span className="inline-flex items-center gap-1">
              {isRunningThisTicket ? (
                <StopCircle className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {buttonText}
            </span>
          }
          loadingText={isRunningThisTicket ? 'Stopping…' : 'Starting…'}
          successText={isRunningThisTicket ? 'Stopped' : 'Started'}
          errorText="Retry"
          reset
          size="sm"
          variant={isRunningThisTicket ? 'destructive' : 'outline'}
          className={className}
          onClick={handleTimerClick}
        />
      </div>

      {!isCompact && (errorMessage || pollError) ? (
        <p className="text-xs text-destructive">{errorMessage ?? pollError}</p>
      ) : null}
    </div>
  );
}
