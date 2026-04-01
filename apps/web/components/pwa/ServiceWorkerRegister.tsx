'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker for PWA support.
 * Only active in browser contexts, not in Electron.
 * Service worker is disabled in development and only registered in production.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    // Don't register service worker in Electron
    if (window.electronAPI) return;

    // Only register in production
    if (process.env.NODE_ENV !== 'production') return;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', {
          scope: '/',
          updateViaCache: 'none'
        })
        .catch(error => {
          console.error('Service Worker registration failed:', error);
        });
    }
  }, []);

  return null;
}
