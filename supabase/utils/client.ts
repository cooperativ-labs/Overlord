import { createBrowserClient } from '@supabase/ssr';

import { getSupabaseCookieOptions, getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env';

export function createClient() {
  const isElectron =
    typeof window !== 'undefined' && Boolean(window.electronAPI?.auth?.refreshSession);

  return createBrowserClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookieOptions: getSupabaseCookieOptions(),
    auth: isElectron
      ? {
          autoRefreshToken: false
        }
      : undefined
  });
}
