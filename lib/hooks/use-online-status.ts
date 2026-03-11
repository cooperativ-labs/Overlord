'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const PING_INTERVAL_MS = 15_000; // Check every 15 seconds when offline
const PING_TIMEOUT_MS = 5_000; // 5 second timeout for connectivity checks

/**
 * Performs a lightweight connectivity check by fetching /api/health.
 * Returns true if the network appears reachable.
 */
async function checkConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

    const response = await fetch('/api/health', {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Monitors the network connectivity status of the application.
 *
 * Uses `navigator.onLine` as the initial value and listens to `online`/`offline`
 * window events for real-time updates. When offline, periodically pings a known
 * endpoint to detect when connectivity is restored.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPing = useCallback(() => {
    if (pingIntervalRef.current !== null) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  const startPing = useCallback(() => {
    stopPing();
    pingIntervalRef.current = setInterval(async () => {
      const connected = await checkConnectivity();
      if (connected) {
        setIsOnline(true);
        stopPing();
      }
    }, PING_INTERVAL_MS);
  }, [stopPing]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      stopPing();
    };

    const handleOffline = () => {
      setIsOnline(false);
      startPing();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // If we start offline, begin pinging immediately
    if (!navigator.onLine) {
      startPing();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      stopPing();
    };
  }, [startPing, stopPing]);

  const retry = useCallback(async () => {
    const connected = await checkConnectivity();
    setIsOnline(connected);
    if (!connected) {
      startPing();
    } else {
      stopPing();
    }
    return connected;
  }, [startPing, stopPing]);

  return { isOnline, retry };
}
