import { NextResponse } from 'next/server';

import { createServiceRoleClient } from '@/supabase/utils/service-role';

/**
 * Lightweight agent-token health check.
 *
 * GET /api/auth/check-token
 * Authorization: Bearer <agent-token>
 *
 * Returns 200 `{ ok: true }` if the token is valid, or 401 otherwise.
 * Used by the Electron app to detect revoked/expired tokens on window focus
 * so it can silently re-exchange for a fresh one.
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
