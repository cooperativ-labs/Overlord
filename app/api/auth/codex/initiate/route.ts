import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { generatePKCE, generateState } from '@/lib/agent-connectors/oauth-pkce';
import { createClient } from '@/supabase/utils/server';

const CODEX_AUTH_URL = 'https://auth.openai.com/authorize';
const CODEX_SCOPE = 'openid email profile';
const COOKIE_MAX_AGE = 300; // 5 minutes

/**
 * GET /api/auth/codex/initiate
 * Generates PKCE values, stores them in short-lived cookies, and redirects the user
 * to OpenAI's OAuth authorization endpoint.
 *
 * Requires env vars:
 *   CODEX_OAUTH_CLIENT_ID   — OAuth client ID registered with OpenAI
 *   NEXT_PUBLIC_SITE_URL    — Used to build the redirect_uri
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);

  const clientId = process.env.CODEX_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(
      `${origin}/u?integration_error=${encodeURIComponent('Codex OAuth is not configured on this server.')}&provider=codex`
    );
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = generateState();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const redirectUri = `${siteUrl}/api/auth/codex/callback`;

  const params = new URLSearchParams({
    audience: 'https://api.openai.com/v1',
    client_id: clientId,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: CODEX_SCOPE,
    state
  });

  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production'
  };

  cookieStore.set('codex_pkce_verifier', codeVerifier, cookieOptions);
  cookieStore.set('codex_oauth_state', state, cookieOptions);

  return NextResponse.redirect(`${CODEX_AUTH_URL}?${params.toString()}`);
}
