'use server';

import { redirect } from 'next/navigation';
import crypto from 'node:crypto';

import { getOAuthRuntimeConfig } from '@/lib/auth/oauth-runtime';
import { getPlatformUrl, getSupabaseUrl } from '@/lib/env';
import { createClient } from '@/supabase/utils/server';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildPkce(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export async function approveDevice(userCode: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/auth/device?code=${encodeURIComponent(userCode)}`);
  }

  const service = createServiceRoleClient();

  const { data: deviceCode, error: findError } = await service
    .from('device_auth_codes')
    .select('id, expires_at, approved_at')
    .eq('user_code', userCode)
    .single();

  if (findError || !deviceCode) {
    redirect('/auth/device?error=not_found');
  }

  if (new Date(deviceCode.expires_at) < new Date()) {
    redirect('/auth/device?error=expired');
  }

  if (deviceCode.approved_at) {
    redirect('/auth/device?error=already_approved');
  }

  const { data: orgData } = await service
    .from('members')
    .select('organization_id')
    .eq('user_id', user.id)
    .order('organization_id', { ascending: true })
    .limit(1)
    .single();

  if (!orgData) {
    redirect('/auth/device?error=no_organization');
  }

  const { cliClientId } = getOAuthRuntimeConfig();
  if (!cliClientId) {
    redirect('/auth/device?error=oauth_not_configured');
  }

  // Generate PKCE and persist the verifier server-side; the callback route will
  // redeem the code → (access, refresh) pair and write it onto the device code row.
  // This gives the CLI an *independent* Supabase session rather than copying the
  // browser session's refresh_token (which Supabase rotates on use and would log
  // the browser out on the first CLI refresh).
  const { verifier, challenge } = buildPkce();
  const stateSecret = base64UrlEncode(crypto.randomBytes(16));
  const state = `${userCode}:${stateSecret}`;

  const { error: stateError } = await service
    .from('device_auth_codes')
    .update({
      user_id: user.id,
      pkce_verifier: verifier,
      oauth_state: stateSecret
    })
    .eq('id', deviceCode.id);

  if (stateError) {
    redirect('/auth/device?error=approval_failed');
  }

  const supabaseUrl = getSupabaseUrl();
  const redirectUri = `${getPlatformUrl()}/auth/device/oauth-callback`;
  const authorizeUrl = new URL(`${supabaseUrl}/auth/v1/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', cliClientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('scope', 'openid email profile offline_access');

  redirect(authorizeUrl.toString());
}
