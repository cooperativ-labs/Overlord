'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  type EverhourTimer,
  getCurrentEverhourTimer,
  startEverhourTimerForTicket,
  stopEverhourTimer
} from '@/lib/actions/everhour';

type TimerSnapshot = {
  errorMessage: string | null;
  isLoading: boolean;
  timer: EverhourTimer;
  updatedAt: number | null;
};

const ACTIVE_INTERVAL_MS = 5_000;
const HIDDEN_INTERVAL_MS = 30_000;
const INACTIVE_INTERVAL_MS = 15_000;

const snapshot: TimerSnapshot = {
  errorMessage: null,
  isLoading: false,
  timer: { status: 'inactive' },
  updatedAt: null
};

const listeners = new Set<(next: TimerSnapshot) => void>();
let pollTimeoutId: number | null = null;
let inFlight: Promise<void> | null = null;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Everhour request failed.';
}

function emit() {
  for (const listener of listeners) {
    listener({ ...snapshot });
  }
}

function patchSnapshot(next: Partial<TimerSnapshot>) {
  Object.assign(snapshot, next);
  emit();
}

function clearPollTimeout() {
  if (pollTimeoutId !== null && typeof window !== 'undefined') {
    window.clearTimeout(pollTimeoutId);
  }
  pollTimeoutId = null;
}

function getNextPollDelay(): number {
  if (typeof document !== 'undefined' && document.hidden) {
    return HIDDEN_INTERVAL_MS;
  }
  return snapshot.timer.status === 'active' ? ACTIVE_INTERVAL_MS : INACTIVE_INTERVAL_MS;
}

function scheduleNextPoll() {
  clearPollTimeout();
  if (typeof window === 'undefined' || listeners.size === 0) {
    return;
  }

  pollTimeoutId = window.setTimeout(async () => {
    await refreshTimer();
    scheduleNextPoll();
  }, getNextPollDelay());
}

async function refreshTimer(): Promise<void> {
  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    patchSnapshot({ isLoading: true });
    try {
      const timer = await getCurrentEverhourTimer();
      patchSnapshot({
        errorMessage: null,
        timer,
        updatedAt: Date.now()
      });
    } catch (error) {
      patchSnapshot({ errorMessage: getErrorMessage(error) });
    } finally {
      patchSnapshot({ isLoading: false });
      inFlight = null;
    }
  })();

  return inFlight;
}

function handleVisibilityChange() {
  if (listeners.size === 0) {
    return;
  }
  void refreshTimer();
  scheduleNextPoll();
}

function subscribe(listener: (next: TimerSnapshot) => void): () => void {
  listeners.add(listener);
  listener({ ...snapshot });

  if (listeners.size === 1) {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    void refreshTimer();
    scheduleNextPoll();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearPollTimeout();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    }
  };
}

export function useEverhourTimer() {
  const [state, setState] = useState<TimerSnapshot>(() => ({ ...snapshot }));

  useEffect(() => subscribe(setState), []);

  const refresh = useCallback(async () => {
    await refreshTimer();
    scheduleNextPoll();
  }, []);

  const startForTicket = useCallback(async (ticketId: string) => {
    const timer = await startEverhourTimerForTicket(ticketId);
    patchSnapshot({
      errorMessage: null,
      timer,
      updatedAt: Date.now()
    });
    scheduleNextPoll();
    return timer;
  }, []);

  const stop = useCallback(async () => {
    await stopEverhourTimer();
    patchSnapshot({
      errorMessage: null,
      timer: { status: 'inactive' },
      updatedAt: Date.now()
    });
    void refreshTimer();
    scheduleNextPoll();
  }, []);

  return {
    ...state,
    refresh,
    startForTicket,
    stop
  };
}
