'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { createClient } from '@/supabase/utils/client';

// ---------------------------------------------------------------------------
// Why this component exists
// ---------------------------------------------------------------------------
// Supabase's @supabase/ssr auto-refresh calls /auth/v1/token, which is the
// standard GoTrue refresh endpoint. But the Electron app authenticates via
// Supabase's OAuth provider flow (/auth/v1/oauth/token), and the refresh
// tokens it issues are NOT accepted by the standard endpoint — they require
// /auth/v1/oauth/token with a client_id parameter.
//
// Without intervention the browser session silently expires every jwt_expiry
// interval (default 3600 s / 1 hour) because every auto-refresh attempt fails.
//
// This component solves the problem in two ways:
//   1. Proactive refresh — a timer fires ~5 min before the access token
//      expires and calls the Electron main process, which hits the correct
//      OAuth endpoint. The new tokens are fed back into the Supabase client
//      via setSession(), keeping the session alive indefinitely.
//   2. Recovery on SIGNED_OUT — if the proactive timer didn't fire (e.g. the
//      machine was asleep), the Supabase client will fire SIGNED_OUT when it
//      discovers the expired token. We intercept this event and attempt the
//      same IPC refresh before falling back to the login screen.
// ---------------------------------------------------------------------------

/** Decode the `exp` claim from a JWT without pulling in a library. */
function getJwtExpiry(accessToken: string): number | null {
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Refresh the Supabase session via the Electron main process, which calls the
 * correct OAuth token endpoint. Returns the new session or null on failure.
 */
async function refreshViaIpc(): Promise<{
  access_token: string;
  refresh_token: string;
} | null> {
  const result = await window.electronAPI?.auth.refreshSession();
  if (result?.ok && result.session) return result.session;
  return null;
}

/** How far before expiry (in ms) we proactively refresh. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes
/** Minimum delay for the timer (prevents tight loops on very short-lived tokens). */
const MIN_DELAY_MS = 10_000; // 10 seconds
/** Minimum interval between OAuth session checks (prevents hammering on rapid focus changes). */
const OAUTH_SESSION_CHECK_INTERVAL_MS = 60_000; // 1 minute

export function ElectronAuthGate() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!window.electronAPI?.auth) return;
    if (pathname === '/electron-login') return;

    const client = createClient();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    // -----------------------------------------------------------------------
    // Proactive refresh timer
    // -----------------------------------------------------------------------
    // Schedules a setTimeout that fires ~5 min before the access token's exp.
    // On success it calls setSession() to install the fresh tokens in cookie
    // storage and reschedules itself for the new token's lifetime.
    // -----------------------------------------------------------------------
    const scheduleProactiveRefresh = (accessToken: string) => {
      if (refreshTimer) clearTimeout(refreshTimer);

      const exp = getJwtExpiry(accessToken);
      if (!exp) return;

      const expiresAtMs = exp * 1000;
      const delay = Math.max(expiresAtMs - Date.now() - REFRESH_MARGIN_MS, MIN_DELAY_MS);

      refreshTimer = setTimeout(async () => {
        const session = await refreshViaIpc();
        if (session) {
          await client.auth.setSession(session);
          // setSession triggers TOKEN_REFRESHED which saves the refresh token
          // to disk via the listener below — no need to duplicate that here.
          scheduleProactiveRefresh(session.access_token);
        }
        // If refresh failed, the token will expire and SIGNED_OUT will fire,
        // which is handled by the onAuthStateChange listener below.
      }, delay);
    };

    // -----------------------------------------------------------------------
    // Auth state listener
    // -----------------------------------------------------------------------
    const { data } = client.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        // The standard auto-refresh failed (expected for OAuth tokens).
        // Attempt recovery via the OAuth endpoint before redirecting.
        const refreshed = await refreshViaIpc();
        if (refreshed) {
          await client.auth.setSession(refreshed);
          scheduleProactiveRefresh(refreshed.access_token);
          return; // Session restored — stay on current page.
        }
        router.replace('/electron-login');
        return;
      }

      // Persist the latest refresh token to disk so the main process can use
      // it for future refreshes (including across app restarts).
      if (event === 'TOKEN_REFRESHED' && session?.refresh_token) {
        window.electronAPI?.auth.saveRefreshToken(session.refresh_token);
      }

      // Kick off the proactive timer whenever we get a fresh access token.
      if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session?.access_token) {
        scheduleProactiveRefresh(session.access_token);
      }
    });

    // -----------------------------------------------------------------------
    // Session restoration on mount
    // -----------------------------------------------------------------------
    // Checks whether a session already exists in cookie storage. If not,
    // attempts to restore from the refresh token stored on disk by the main
    // process (using the correct OAuth endpoint).
    // -----------------------------------------------------------------------
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
          // No browser session — restore via the OAuth refresh endpoint.
          const refreshed = await refreshViaIpc();
          if (refreshed) {
            await client.auth.setSession(refreshed);
            scheduleProactiveRefresh(refreshed.access_token);
          } else {
            router.replace('/electron-login');
          }
        } else {
          // Session exists in cookies — start the proactive refresh timer
          // so we renew before it expires.
          scheduleProactiveRefresh(currentSession.session.access_token);
        }
      } catch (err) {
        // Network error — don't redirect, user may be temporarily offline.
        console.warn('Session check failed:', err);
      }
    };

    restoreSession();

    // -----------------------------------------------------------------------
    // OAuth session health check on window focus
    // -----------------------------------------------------------------------
    // When the window regains focus, verify a shared OAuth refresh token is
    // still available and refresh the session if the stored state is missing.
    // -----------------------------------------------------------------------
    let lastOAuthSessionCheck = 0;

    const handleFocus = async () => {
      if (!window.electronAPI?.auth?.checkOAuthSession) return;

      const now = Date.now();
      if (now - lastOAuthSessionCheck < OAUTH_SESSION_CHECK_INTERVAL_MS) return;
      lastOAuthSessionCheck = now;

      const { valid } = await window.electronAPI.auth.checkOAuthSession();
      if (valid) return;

      const result = await window.electronAPI.auth.refreshOAuthSession();
      if (!result.ok) {
        console.warn('OAuth session refresh failed on focus:', result.error);
      }
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      data?.subscription?.unsubscribe();
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener('focus', handleFocus);
    };
  }, [pathname, router]);

  return null;
}
