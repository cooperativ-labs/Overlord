import { createBrowserClient } from '@supabase/ssr';

import { getSupabaseCookieOptions, getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env';

/**
 * Returns true when Electron bearer auth is active in the renderer.
 * Default-on after rollout. Set NEXT_PUBLIC_OVLD_ELECTRON_BEARER_AUTH=0
 * for the one-release rollback path before the flag is removed.
 */
export function isElectronBearerAuthEnabled(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.electronAPI?.isElectron) &&
    process.env.NEXT_PUBLIC_OVLD_ELECTRON_BEARER_AUTH !== '0'
  );
}

/**
 * Calls the main process to get a fresh access token.
 * Used as the accessToken callback for the Electron browser Supabase client.
 * Never returns or exposes the refresh token.
 */
async function getElectronAccessToken(): Promise<string | null> {
  const result = await window.electronAPI?.auth?.getAccessToken();
  if (result?.ok && result.accessToken) {
    return result.accessToken;
  }
  return null;
}

export function createClient() {
  if (isElectronBearerAuthEnabled()) {
    // Electron bearer-auth path: no persisted session, no auto-refresh.
    // The accessToken callback is invoked per REST/PostgREST request and on
    // realtime (re)connect, so main-process token rotation is transparent to
    // the renderer. The auth namespace is intentionally disabled on this client
    // — use window.electronAPI.auth.* for session management instead.
    return createBrowserClient(getSupabaseUrl(), getSupabasePublishableKey(), {
      accessToken: getElectronAccessToken
    });
  }

  const isElectron =
    typeof window !== 'undefined' && Boolean(window.electronAPI?.auth?.getAccessToken);

  return createBrowserClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookieOptions: getSupabaseCookieOptions(),
    auth: isElectron
      ? {
          autoRefreshToken: false
        }
      : undefined
  });
}
