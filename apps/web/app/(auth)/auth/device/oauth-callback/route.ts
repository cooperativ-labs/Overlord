import { NextResponse } from 'next/server';

import { getOAuthRuntimeConfig } from '@/lib/auth/oauth-runtime';
import { getPlatformUrl, getSupabaseUrl } from '@/lib/env';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

/**
 * Callback for the device-flow OAuth authorize redirect initiated by approveDevice().
 *
 * Redeems the authorization code using the PKCE verifier stored on the device_auth_codes
 * row, then persists the resulting CLI-scoped Supabase session so the polling CLI can
 * pick it up. Critically, these tokens are independent of the user's browser session —
 * refreshing them does not invalidate the user's web login.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return NextResponse.redirect(`${getPlatformUrl()}/auth/device?error=approval_failed`);
  }

  const [userCode, stateSecret] = state.split(':');
  if (!userCode || !stateSecret) {
    return NextResponse.redirect(`${getPlatformUrl()}/auth/device?error=approval_failed`);
  }

  const service = createServiceRoleClient();
  const { data: row } = await service
    .from('device_auth_codes')
    .select('id, user_id, pkce_verifier, oauth_state, expires_at, approved_at')
    .eq('user_code', userCode)
    .single();

  if (!row || !row.pkce_verifier || row.oauth_state !== stateSecret) {
    return NextResponse.redirect(`${getPlatformUrl()}/auth/device?error=approval_failed`);
  }

  if (new Date(row.expires_at) < new Date()) {
    return NextResponse.redirect(`${getPlatformUrl()}/auth/device?error=expired`);
  }

  if (row.approved_at) {
    return NextResponse.redirect(`${getPlatformUrl()}/auth/device?error=already_approved`);
  }

  const { deviceClientId } = getOAuthRuntimeConfig();
  if (!deviceClientId) {
    return NextResponse.redirect(`${getPlatformUrl()}/auth/device?error=oauth_not_configured`);
  }

  const redirectUri = `${getPlatformUrl()}/auth/device/oauth-callback`;
  const tokenRes = await fetch(`${getSupabaseUrl()}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: deviceClientId,
      redirect_uri: redirectUri,
      code_verifier: row.pkce_verifier
    })
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    console.error('[device-oauth] token exchange failed', {
      status: tokenRes.status,
      body: body.slice(0, 500),
      redirectUri
    });
    return NextResponse.redirect(`${getPlatformUrl()}/auth/device?error=approval_failed`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!tokens.access_token || !tokens.refresh_token) {
    return NextResponse.redirect(`${getPlatformUrl()}/auth/device?error=approval_failed`);
  }

  const accessTokenExpiresAt =
    typeof tokens.expires_in === 'number' && tokens.expires_in > 0
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

  const { error: updateError } = await service
    .from('device_auth_codes')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_token_expires_at: accessTokenExpiresAt,
      pkce_verifier: null,
      oauth_state: null,
      approved_at: new Date().toISOString()
    })
    .eq('id', row.id);

  if (updateError) {
    return NextResponse.redirect(`${getPlatformUrl()}/auth/device?error=approval_failed`);
  }

  return NextResponse.redirect(`${getPlatformUrl()}/auth/device?approved=1`);
}
