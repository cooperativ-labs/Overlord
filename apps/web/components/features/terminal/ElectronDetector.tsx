'use client';

import { useEffect } from 'react';

/**
 * Sets a `data-electron` attribute on <html> when running inside Electron.
 * This enables CSS-level conditional styling via:
 *   - Tailwind: `data-[electron]:pt-10`
 *   - CSS: `html[data-electron] .my-class { ... }`
 */
export function ElectronDetector() {
  useEffect(() => {
    if (window.electronAPI) {
      document.documentElement.setAttribute('data-electron', '');
    }
  }, []);

  return null;
}
