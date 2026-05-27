import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { getPlatformUrl } from '@/lib/env';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

// Issuance rate limit: max codes that may be created per IP within the window.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MINUTES = 10;

function generateUserCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 to avoid confusion
  const segment = (n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${segment(4)}-${segment(4)}`;
}

/**
 * Extract the best-available client IP from Next.js request headers.
 * On Vercel, x-forwarded-for is set by the edge and is trustworthy.
 * We take only the first value in case the header contains a chain.
 */
function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip');
}

export async function POST(request: Request) {
  const supabase = createServiceRoleClient();

  const clientIp = getClientIp(request);

  // --- Issuance rate limiting ---
  // Count codes created by this IP in the past RATE_LIMIT_WINDOW_MINUTES minutes.
  // Codes with no IP (legacy rows) are excluded from the count so old data
  // does not spuriously block new requests.
  if (clientIp) {
    const windowStart = new Date(
      Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
    ).toISOString();

    const { count, error: countError } = await supabase
      .from('device_auth_codes')
      .select('id', { count: 'exact', head: true })
      .eq('requester_ip', clientIp)
      .gte('created_at', windowStart);

    if (!countError && count !== null && count >= RATE_LIMIT_MAX) {
      return NextResponse.json(
        { error: 'Too many device code requests. Please wait before trying again.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(RATE_LIMIT_WINDOW_MINUTES * 60),
            'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
            'X-RateLimit-Window': `${RATE_LIMIT_WINDOW_MINUTES}m`
          }
        }
      );
    }
  }

  // --- Issue the device code ---
  const deviceCode = randomUUID();
  const userCode = generateUserCode();
  const platformUrl = getPlatformUrl();

  const { error } = await supabase.from('device_auth_codes').insert({
    device_code: deviceCode,
    user_code: userCode,
    requester_ip: clientIp ?? null
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Opportunistic cleanup: delete unapproved codes that expired more than 1 hour ago.
  // This keeps device_auth_codes lean without requiring a scheduled job.
  void supabase
    .from('device_auth_codes')
    .delete()
    .is('approved_at', null)
    .lt('expires_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .then(() => {});

  return NextResponse.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${platformUrl}/auth/device?code=${userCode}`,
    expires_in: 900,
    interval: 5
  });
}
