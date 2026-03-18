import { createBrowserClient } from '@supabase/ssr';

import { getSupabaseCookieOptions, getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env';

export function createClient() {
  return createBrowserClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookieOptions: getSupabaseCookieOptions()
  });
}
