import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { createClient } from '@/supabase/utils/server';

const CLAUDE_TOKEN_URL = 'https://api.anthropic.com/api/oauth/token';
const PROVIDER = 'claude-code';

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

/**
 * GET /api/auth/claude-code/callback
 * Exchanges the OAuth authorization code for tokens and stores the access token
 * in the user_integrations table.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const errorParam = searchParams.get('error');

  if (errorParam) {
    const desc = searchParams.get('error_description') ?? errorParam;
    return NextResponse.redirect(
      `${origin}/u?integration_error=${encodeURIComponent(desc)}&provider=claude-code`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${origin}/u?integration_error=${encodeURIComponent('Missing code or state.')}&provider=claude-code`
    );
  }

  const cookieStore = await cookies();
  const storedVerifier = cookieStore.get('claude_pkce_verifier')?.value;
  const storedState = cookieStore.get('claude_oauth_state')?.value;

  cookieStore.delete('claude_pkce_verifier');
  cookieStore.delete('claude_oauth_state');

  if (!storedVerifier || !storedState || storedState !== state) {
    return NextResponse.redirect(
      `${origin}/u?integration_error=${encodeURIComponent('Invalid OAuth state. Please try again.')}&provider=claude-code`
    );
  }

  const clientId = process.env.CLAUDE_OAUTH_CLIENT_ID ?? '';
  const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL ?? origin}/api/auth/claude-code/callback`;

  try {
    const tokenResponse = await fetch(CLAUDE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: storedVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      }).toString()
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text().catch(() => '');
      throw new Error(`Token exchange failed (${tokenResponse.status}): ${body.slice(0, 200)}`);
    }

    const tokens = (await tokenResponse.json()) as TokenResponse;
    const accessToken = tokens.access_token;
    if (!accessToken) throw new Error('No access_token in response.');

    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(`${origin}/login`);
    }

    const metadata: Record<string, unknown> = {};
    if (tokens.refresh_token) metadata.refresh_token = tokens.refresh_token;
    if (tokens.expires_in) {
      metadata.expires_at = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    }

    const { error } = await supabase.from('user_integrations').upsert(
      {
        api_key: accessToken,
        metadata,
        provider: PROVIDER,
        updated_at: new Date().toISOString(),
        user_id: user.id
      },
      { onConflict: 'user_id,provider' }
    );

    if (error) throw new Error(error.message);

    return NextResponse.redirect(`${origin}/u?integration_connected=claude-code`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    return NextResponse.redirect(
      `${origin}/u?integration_error=${encodeURIComponent(message)}&provider=claude-code`
    );
  }
}
