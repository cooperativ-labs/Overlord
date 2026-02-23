import { NextResponse } from 'next/server';

import { getPlatformUrl } from '@/lib/env';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

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
    .select('id, expires_at, access_token, approved_at')
    .eq('device_code', device_code)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Device code not found.' }, { status: 404 });
  }

  if (new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ status: 'expired' }, { status: 400 });
  }

  if (!data.access_token) {
    return NextResponse.json({ status: 'pending' });
  }

  // Authorized — return token and clean up the code
  const accessToken = data.access_token;
  await supabase.from('device_auth_codes').delete().eq('id', data.id);

  return NextResponse.json({
    status: 'authorized',
    access_token: accessToken,
    platform_url: getPlatformUrl()
  });
}
