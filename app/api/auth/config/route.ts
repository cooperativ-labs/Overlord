import { NextResponse } from 'next/server';

import { getSupabaseUrl } from '@/lib/env';

/**
 * Public endpoint for CLI/Electron to discover OAuth configuration.
 * Returns the Supabase project URL and OAuth client config.
 * No authentication required.
 */
export async function GET() {
  const supabaseUrl = getSupabaseUrl();
  const cliClientId = process.env.SUPABASE_OAUTH_CLI_CLIENT_ID;
  const electronClientId = process.env.SUPABASE_OAUTH_ELECTRON_CLIENT_ID;
  const cliRedirectUri = process.env.SUPABASE_OAUTH_CLI_REDIRECT_URI;
  const electronRedirectUri = process.env.SUPABASE_OAUTH_ELECTRON_REDIRECT_URI;

  if (!cliClientId && !electronClientId) {
    return NextResponse.json(
      {
        error:
          'OAuth not configured. Set SUPABASE_OAUTH_CLI_CLIENT_ID and/or SUPABASE_OAUTH_ELECTRON_CLIENT_ID.'
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
