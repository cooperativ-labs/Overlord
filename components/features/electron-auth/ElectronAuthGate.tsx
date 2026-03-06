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

    // Listen to auth state changes first, before triggering any refresh,
    // so we don't miss TOKEN_REFRESHED events.
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        router.replace('/electron-login');
      }
      // Supabase issues a NEW refresh_token on every refresh — save it so
      // the next app restart can restore the session without re-logging in.
      if (event === 'TOKEN_REFRESHED' && session?.refresh_token) {
        window.electronAPI?.auth.saveRefreshToken(session.refresh_token);
      }
    });

    const restoreSession = async () => {
      if (!window.electronAPI?.auth) return;

      const status = await window.electronAPI.auth.getStatus();
      if (!status.isAuthenticated) {
        router.replace('/electron-login');
        return;
      }

      try {
        const { data: currentSession } = await client.auth.getSession();

        if (!currentSession?.session) {
          // No session in browser — restore from the stored refresh token.
          if (status.supabaseRefreshToken) {
            const { error } = await client.auth.refreshSession({
              refresh_token: status.supabaseRefreshToken
            });
            if (error) {
              // Refresh token is invalid or expired — force re-login.
              router.replace('/electron-login');
            }
            // On success, onAuthStateChange fires TOKEN_REFRESHED and saves the new token.
          } else {
            router.replace('/electron-login');
          }
        } else {
          // Session exists — let @supabase/ssr handle auto-refresh via its built-in timer.
          // The TOKEN_REFRESHED listener above will persist any new refresh tokens.
        }
      } catch (err) {
        // Network error — don't redirect, user may be temporarily offline.
        console.warn('Session check failed:', err);
      }
    };

    restoreSession();

    return () => {
      data?.subscription?.unsubscribe();
    };
  }, [pathname, router]);

  return null;
}
