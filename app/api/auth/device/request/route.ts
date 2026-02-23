import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { getPlatformUrl } from '@/lib/env';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

function generateUserCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 to avoid confusion
  const segment = (n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${segment(4)}-${segment(4)}`;
}

export async function POST() {
  const supabase = createServiceRoleClient();

  const deviceCode = randomUUID();
  const userCode = generateUserCode();
  const platformUrl = getPlatformUrl();

  const { error } = await supabase.from('device_auth_codes').insert({
    device_code: deviceCode,
    user_code: userCode
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${platformUrl}/auth/device?code=${userCode}`,
    expires_in: 900
  });
}
