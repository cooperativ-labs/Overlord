'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * In Electron, checks whether a valid agent_token is stored and redirects to
 * /electron-login if not. Has no effect in the browser.
 */
export function ElectronAuthGate() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!window.electronAPI?.auth) return;
    if (pathname === '/electron-login') return;

    window.electronAPI.auth.getStatus().then(({ isAuthenticated }) => {
      if (!isAuthenticated) {
        router.replace('/electron-login');
      }
    });
  }, [pathname, router]);

  return null;
}
