import { NextResponse } from 'next/server';

import { getPlatformUrl } from '@/lib/env';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

const POLL_INTERVAL_SECONDS = 5;

export async function POST(request: Request) {
  let body: { device_code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { device_code } = body;
  if (!device_code) {
    return NextResponse.json({ error: 'device_code is required.' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('device_auth_codes')
    .select(
      'id, expires_at, access_token, refresh_token, access_token_expires_at, approved_at, next_poll_at'
    )
    .eq('device_code', device_code)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Device code not found.' }, { status: 404 });
  }

  if (new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ status: 'expired' }, { status: 400 });
  }

  // Throttle: reject if the client is polling faster than the allowed interval
  if (data.next_poll_at && new Date(data.next_poll_at) > new Date()) {
    const retryAfter = Math.ceil((new Date(data.next_poll_at).getTime() - Date.now()) / 1000);
    return NextResponse.json(
      { status: 'slow_down', interval: POLL_INTERVAL_SECONDS },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  // Advance the throttle window before doing anything else
  await supabase
    .from('device_auth_codes')
    .update({ next_poll_at: new Date(Date.now() + POLL_INTERVAL_SECONDS * 1000).toISOString() })
    .eq('id', data.id);

  // Opportunistic cleanup: delete expired codes older than 1 hour
  void supabase
    .from('device_auth_codes')
    .delete()
    .lt('expires_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .then(() => {});

  if (!data.access_token) {
    return NextResponse.json({ status: 'pending' });
  }

  // Authorized — atomically consume the code so concurrent polls don't both receive the token.
  const { data: consumed, error: consumeError } = await supabase
    .from('device_auth_codes')
    .delete()
    .eq('id', data.id)
    .eq('access_token', data.access_token)
    .select('access_token, refresh_token, access_token_expires_at')
    .maybeSingle();

  if (consumeError || !consumed) {
    return NextResponse.json({ status: 'pending' });
  }

  return NextResponse.json({
    status: 'authorized',
    access_token: consumed.access_token,
    refresh_token: consumed.refresh_token,
    access_token_expires_at: consumed.access_token_expires_at,
    platform_url: getPlatformUrl()
  });
}
