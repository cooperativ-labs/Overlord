import { getSupabase } from '@/lib/supabase';

/**
 * Resolve the Overlord platform base URL the mobile app should talk to for
 * protocol endpoints. Mirrors the resolution the CLI uses: explicit override
 * first, then a loopback Supabase URL (local dev), otherwise the hosted app.
 */
export function resolvePlatformUrl(): string {
  const explicitUrl = process.env.EXPO_PUBLIC_OVERLORD_URL?.trim();
  if (explicitUrl) {
    return explicitUrl.replace(/\/+$/, '');
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (supabaseUrl) {
    try {
      const parsed = new URL(supabaseUrl);
      const host = parsed.hostname;
      // Only permit the loopback addresses. Private-range IPv4 hosts (e.g. a
      // devbox reachable on the LAN) would otherwise fall back to cleartext
      // HTTP even when the Supabase URL has drifted.
      const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
      const allowInsecure = process.env.EXPO_PUBLIC_OVERLORD_ALLOW_INSECURE_LOCAL === 'true';

      if (isLoopback || allowInsecure) {
        return `http://${host}:3000`;
      }
    } catch {
      // Fall through to the hosted default.
    }
  }

  return 'https://www.ovld.ai';
}

/**
 * Resolve the current Supabase access token plus the user's primary
 * organization id. The access token is accepted as a bearer by the Overlord
 * protocol endpoints (they validate Supabase JWTs), so the mobile app can call
 * those endpoints directly.
 */
export async function resolveLaunchOAuthSession(): Promise<{
  accessToken: string;
  organizationId: number;
}> {
  const supabase = getSupabase();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  const accessToken = session?.access_token?.trim();
  const userId = session?.user?.id?.trim();

  if (!accessToken || !userId) {
    throw new Error('You must be signed in to perform this action.');
  }

  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('organization_id')
    .eq('user_id', userId)
    .order('organization_id', { ascending: true })
    .limit(1)
    .single();

  if (memberError || !member) {
    throw new Error(memberError?.message ?? 'Could not determine your organization.');
  }

  return {
    accessToken,
    organizationId: member.organization_id
  };
}
