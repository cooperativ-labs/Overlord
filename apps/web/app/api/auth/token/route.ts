import { NextResponse } from 'next/server';

import { getOAuthRuntimeConfig } from '@/lib/auth/oauth-runtime';
import { getPlatformUrl } from '@/lib/env';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

type JwtPayload = {
  client_id?: unknown;
};

function getJwtClientId(jwt: string): string | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')
    ) as JwtPayload;
    if (typeof payload.client_id !== 'string') return null;
    const normalized = payload.client_id.trim();
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

/**
 * Exchanges a valid Supabase JWT (obtained via OAuth PKCE flow) for a long-lived agent_token
 * that can be used with the Overlord protocol API.
 *
 * POST /api/auth/token
 * Authorization: Bearer <supabase-access-token>
 *
 * Response: { access_token: string, platform_url: string }
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing bearer token.' }, { status: 401 });
  }

  const supabaseJwt = authHeader.replace('Bearer ', '').trim();
  const clientId = getJwtClientId(supabaseJwt);
  if (!clientId) {
    return NextResponse.json(
      { error: 'OAuth token required (missing client_id claim).' },
      { status: 401 }
    );
  }

  const { allowedClientIds } = getOAuthRuntimeConfig();

  if (allowedClientIds.length === 0) {
    return NextResponse.json(
      {
        error:
          'OAuth token exchange is not configured. Set SUPABASE_OAUTH_CLI_CLIENT_ID and/or SUPABASE_OAUTH_ELECTRON_CLIENT_ID (or legacy SUPABASE_OAUTH_CLIENT_ID).'
      },
      { status: 503 }
    );
  }

  if (!allowedClientIds.includes(clientId)) {
    return NextResponse.json(
      { error: 'OAuth client is not allowed to exchange for an Overlord agent token.' },
      { status: 403 }
    );
  }

  const supabase = createServiceRoleClient();

  // Verify the Supabase JWT by fetching the associated user
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser(supabaseJwt);

  if (userError || !user) {
    return NextResponse.json({ error: 'Invalid or expired token.' }, { status: 401 });
  }

  // Look up the user's organization via the members table
  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('organization_id')
    .eq('user_id', user.id)
    .order('organization_id', { ascending: true })
    .limit(1)
    .single();

  if (memberError || !member) {
    return NextResponse.json(
      { error: 'No organization found. Please complete onboarding first.' },
      { status: 403 }
    );
  }

  const organizationId = member.organization_id;

  // Return an existing active token if one exists, so re-logins don't proliferate tokens
  const { data: existingToken } = await supabase
    .from('agent_tokens')
    .select('token')
    .eq('user_id', user.id)
    .eq('organization_id', organizationId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingToken) {
    return NextResponse.json({
      access_token: existingToken.token,
      platform_url: getPlatformUrl()
    });
  }

  // Create a new agent token
  const { data: newToken, error: tokenError } = await supabase
    .from('agent_tokens')
    .insert({
      user_id: user.id,
      organization_id: organizationId,
      name: 'CLI Token'
    })
    .select('token')
    .single();

  if (tokenError || !newToken) {
    return NextResponse.json({ error: 'Failed to create token.' }, { status: 500 });
  }

  return NextResponse.json({
    access_token: newToken.token,
    platform_url: getPlatformUrl()
  });
}
