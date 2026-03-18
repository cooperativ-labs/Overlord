'use client';

import { useEffect, useRef, useState } from 'react';

const PING_INTERVAL_MS = 15_000; // Check every 15 seconds
const PING_TIMEOUT_MS = 5_000; // 5 second timeout for connectivity checks
const FAILURE_THRESHOLD = 2; // Avoid showing the offline screen on a single transient failure

async function getProbeUrl(): Promise<string> {
  if (typeof window === 'undefined') {
    return '/api/auth/config';
  }

  const baseUrl = await window.electronAPI?.app
    ?.getPlatformUrl()
    .catch(() => window.location.origin);

  return new URL('/api/auth/config', baseUrl ?? window.location.origin).toString();
}

/**
 * Performs a lightweight connectivity check against the active platform origin.
 * Returns true if the network appears reachable.
 */
async function checkConnectivity(probeUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

    const response = await fetch(probeUrl, {
      method: 'GET',
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
 * window events for hints from the browser. It also periodically checks whether
 * the current Overlord platform origin is reachable so Electron can surface a
 * better offline state than `navigator.onLine` alone provides.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const failureCountRef = useRef(0);
  const probeUrlRef = useRef('/api/auth/config');

  useEffect(() => {
    let cancelled = false;

    const runCheck = async () => {
      const connected = await checkConnectivity(probeUrlRef.current);
      if (cancelled) return connected;

      if (connected) {
        failureCountRef.current = 0;
        setIsOnline(true);
        return true;
      }

      failureCountRef.current += 1;
      if (!navigator.onLine || failureCountRef.current >= FAILURE_THRESHOLD) {
        setIsOnline(false);
      }

      return false;
    };

    const handleOnline = () => {
      void runCheck();
    };

    const handleOffline = () => {
      failureCountRef.current = FAILURE_THRESHOLD;
      setIsOnline(false);
    };

    void getProbeUrl().then(url => {
      if (!cancelled) {
        probeUrlRef.current = url;
        void runCheck();
      }
    });

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const pingInterval = window.setInterval(() => {
      void runCheck();
    }, PING_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.clearInterval(pingInterval);
    };
  }, []);

  const retry = async () => {
    const connected = await checkConnectivity(probeUrlRef.current);
    failureCountRef.current = connected ? 0 : FAILURE_THRESHOLD;
    setIsOnline(connected);
    return connected;
  };

  return { isOnline, retry };
}
