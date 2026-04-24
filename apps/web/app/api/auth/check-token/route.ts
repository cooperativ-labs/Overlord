import { NextResponse } from 'next/server';

import { createServiceRoleClient } from '@/supabase/utils/service-role';

/**
 * Deprecated compatibility health check for legacy agent tokens.
 *
 * GET /api/auth/check-token
 * Authorization: Bearer <agent-token>
 *
 * Returns 200 `{ ok: true }` if the token is valid, or 401 otherwise.
 * Desktop no longer uses this endpoint for normal OAuth session refresh.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('agent_tokens')
    .select('id, revoked_at, expires_at')
    .eq('token', token)
    .single();

  if (!data || data.revoked_at || (data.expires_at && new Date(data.expires_at) < new Date())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
