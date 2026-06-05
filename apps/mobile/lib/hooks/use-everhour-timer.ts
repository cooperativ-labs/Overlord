import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  type EverhourTimer,
  getCurrentEverhourTimer,
  getEverhourConnectionStatus,
  startEverhourTimerForTicket,
  stopEverhourTimer
} from '@/lib/everhour';

const ACTIVE_INTERVAL_MS = 5_000;
const INACTIVE_INTERVAL_MS = 15_000;

function inactiveTimer(): EverhourTimer {
  return { status: 'inactive' };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Everhour request failed.';
}

type UseEverhourTimerResult = {
  /** `null` until the connection check resolves, then whether Everhour is connected. */
  isConnected: boolean | null;
  timer: EverhourTimer;
  errorMessage: string | null;
  isBusy: boolean;
  refresh: () => Promise<void>;
  startForTicket: () => Promise<void>;
  stop: () => Promise<void>;
};

/**
 * Polls the user's current Everhour timer and exposes start/stop controls for a
 * single ticket, mirroring the web `useEverhourTimer` hook with plain React state.
 */
export function useEverhourTimer(ticketId: string): UseEverhourTimerResult {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [timer, setTimer] = useState<EverhourTimer>(inactiveTimer);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const mountedRef = useRef(true);
  const fetchingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerStatusRef = useRef<EverhourTimer['status']>('inactive');

  const clearPoll = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const fetchTimer = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const next = await getCurrentEverhourTimer();
      if (!mountedRef.current) return;
      timerStatusRef.current = next.status;
      setTimer(next);
      setErrorMessage(null);
    } catch (error) {
      if (!mountedRef.current) return;
      setErrorMessage(getErrorMessage(error));
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  const scheduleNextPoll = useCallback(() => {
    clearPoll();
    if (AppState.currentState !== 'active') return;
    const delay = timerStatusRef.current === 'active' ? ACTIVE_INTERVAL_MS : INACTIVE_INTERVAL_MS;
    timeoutRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      if (isConnected) {
        await fetchTimer();
      }
      scheduleNextPoll();
    }, delay);
  }, [clearPoll, fetchTimer, isConnected]);

  // Resolve connection status once on mount.
  useEffect(() => {
    mountedRef.current = true;
    void (async () => {
      try {
        const connected = await getEverhourConnectionStatus();
        if (!mountedRef.current) return;
        setIsConnected(connected);
        if (connected) {
          await fetchTimer();
        }
      } catch {
        if (mountedRef.current) setIsConnected(false);
      }
    })();
    return () => {
      mountedRef.current = false;
      clearPoll();
    };
  }, [clearPoll, fetchTimer]);

  // Drive polling while connected and the app is foregrounded.
  useEffect(() => {
    if (!isConnected) {
      clearPoll();
      return;
    }
    scheduleNextPoll();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void fetchTimer();
        scheduleNextPoll();
      } else {
        clearPoll();
      }
    });
    return () => {
      subscription.remove();
      clearPoll();
    };
  }, [clearPoll, fetchTimer, isConnected, scheduleNextPoll]);

  const refresh = useCallback(async () => {
    if (!isConnected) return;
    await fetchTimer();
    scheduleNextPoll();
  }, [fetchTimer, isConnected, scheduleNextPoll]);

  const startForTicket = useCallback(async () => {
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const started = await startEverhourTimerForTicket(ticketId);
      if (!mountedRef.current) return;
      timerStatusRef.current = started.status;
      setTimer(started);
      scheduleNextPoll();
    } catch (error) {
      if (mountedRef.current) setErrorMessage(getErrorMessage(error));
      throw error;
    } finally {
      if (mountedRef.current) setIsBusy(false);
    }
  }, [scheduleNextPoll, ticketId]);

  const stop = useCallback(async () => {
    setIsBusy(true);
    setErrorMessage(null);
    // Optimistically reflect the stopped state.
    timerStatusRef.current = 'inactive';
    setTimer(inactiveTimer());
    try {
      await stopEverhourTimer();
      await fetchTimer();
      scheduleNextPoll();
    } catch (error) {
      if (mountedRef.current) setErrorMessage(getErrorMessage(error));
      await fetchTimer();
      throw error;
    } finally {
      if (mountedRef.current) setIsBusy(false);
    }
  }, [fetchTimer, scheduleNextPoll]);

  return {
    isConnected,
    timer,
    errorMessage,
    isBusy,
    refresh,
    startForTicket,
    stop
  };
}
