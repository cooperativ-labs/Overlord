import { createClient } from '@supabase/supabase-js';

import { getSupabaseSecretKey, getSupabaseUrl } from '@/lib/env';

/**
 * Service role client — bypasses RLS entirely.
 * Use ONLY in server-side API routes that have already authenticated the caller
 * (e.g. via bearer token). Never expose this client to the browser.
 */
export function createServiceRoleClient() {
  return createClient(getSupabaseUrl(), getSupabaseSecretKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
