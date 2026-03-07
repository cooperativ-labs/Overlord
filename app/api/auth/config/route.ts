import { NextResponse } from 'next/server';

import { getOAuthRuntimeConfig } from '@/lib/auth/oauth-runtime';
import { getSupabaseUrl } from '@/lib/env';

/**
 * Public endpoint for CLI/Electron to discover OAuth configuration.
 * Returns the Supabase project URL and OAuth client config.
 * No authentication required.
 */
export async function GET() {
  const supabaseUrl = getSupabaseUrl();
  const { cliClientId, electronClientId, cliRedirectUri, electronRedirectUri } =
    getOAuthRuntimeConfig();

  if (!cliClientId && !electronClientId) {
    return NextResponse.json(
      {
        error:
          'OAuth not configured. Set SUPABASE_OAUTH_CLI_CLIENT_ID and/or SUPABASE_OAUTH_ELECTRON_CLIENT_ID (or legacy SUPABASE_OAUTH_CLIENT_ID).'
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    supabase_url: supabaseUrl,
    cli_client_id: cliClientId ?? null,
    electron_client_id: electronClientId ?? null,
    cli_redirect_uri: cliRedirectUri ?? null,
    electron_redirect_uri: electronRedirectUri ?? null
  });
}
