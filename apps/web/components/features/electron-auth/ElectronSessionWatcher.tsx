'use client';

import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { isElectronBearerAuthEnabled } from '@/supabase/utils/client';

function buildElectronLoginPath(): string {
  const nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const params = new URLSearchParams();
  if (nextPath !== '/' && nextPath !== '/electron-login') {
    params.set('next', nextPath);
  }
  const query = params.toString();
  return query ? `/electron-login?${query}` : '/electron-login';
}

/**
 * Listens for the main-process `auth:session-expired` signal, which fires when a
 * desktop session becomes unrecoverable (the refresh token is dead/revoked).
 *
 * Without this, an expired desktop session looked normal — reads were served
 * from cache while writes silently 401'd — and a refresh could strand the user
 * in a half-rendered app with no way to sign out. Here we make expiry explicit:
 * drop cached data and route to the sign-in screen with a clear message.
 */
export function ElectronSessionWatcher() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const handledRef = useRef(false);

  useEffect(() => {
    if (!isElectronBearerAuthEnabled()) return;
    if (!window.electronAPI?.auth?.onSessionExpired) return;

    const unsubscribe = window.electronAPI.auth.onSessionExpired(() => {
      // Already on the login screen, or already handled — nothing to do.
      if (handledRef.current) return;
      if (window.location.pathname === '/electron-login') return;
      handledRef.current = true;

      queryClient.clear();
      toast.error('Your session has expired. Please sign in again.', {
        id: 'electron-session-expired',
        duration: 8000
      });
      router.replace(buildElectronLoginPath());
    });

    return unsubscribe;
  }, [queryClient, router]);

  // Re-arm once the user has navigated to the login screen, so a future
  // expiry (after they sign back in) is handled again.
  useEffect(() => {
    if (pathname === '/electron-login') {
      handledRef.current = false;
    }
  }, [pathname]);

  return null;
}
