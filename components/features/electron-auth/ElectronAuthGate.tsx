'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { createClient } from '@/supabase/utils/client';

/**
 * In Electron, checks whether a valid agent_token is stored and redirects to
 * /electron-login if not. Also ensures the Supabase session stays fresh by
 * listening to auth state changes and refreshing the session proactively.
 * Has no effect in the browser.
 */
export function ElectronAuthGate() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!window.electronAPI?.auth) return;
    if (pathname === '/electron-login') return;

    const client = createClient();

    const restoreAndRefreshSession = async () => {
      if (!window.electronAPI?.auth) return;

      const status = await window.electronAPI.auth.getStatus();
      if (!status.isAuthenticated) {
        router.replace('/electron-login');
        return;
      }

      try {
        // Check if we currently have a valid session
        const { data: currentSession } = await client.auth.getSession();

        if (!currentSession?.session) {
          // No session in browser — restore it from the stored refresh token
          if (status.supabaseRefreshToken) {
            const { data, error } = await client.auth.refreshSession({
              refresh_token: status.supabaseRefreshToken
            });
            if (error || !data?.session) {
              // Refresh token is invalid or expired — force re-login
              router.replace('/electron-login');
            }
          } else {
            // No refresh token stored — force re-login
            router.replace('/electron-login');
          }
        } else {
          // Session exists but may be expiring soon — proactively refresh
          const expiresAt = currentSession.session.expires_at ?? 0;
          const secondsUntilExpiry = expiresAt - Math.floor(Date.now() / 1000);
          if (secondsUntilExpiry < 300) {
            // Less than 5 minutes remaining — refresh now
            await client.auth.refreshSession();
          }
        }
      } catch (err) {
        // Network error — don't redirect, user might be temporarily offline
        console.warn('Session check failed:', err);
      }
    };

    // Restore/verify session immediately on mount (covers app restart case)
    restoreAndRefreshSession();

    // Periodically keep the session fresh while the app is running
    const interval = setInterval(restoreAndRefreshSession, 4 * 60 * 1000);

    // Redirect immediately when Supabase detects a sign-out
    const { data } = client.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        router.replace('/electron-login');
      }
    });

    return () => {
      clearInterval(interval);
      data?.subscription?.unsubscribe();
    };
  }, [pathname, router]);

  return null;
}
