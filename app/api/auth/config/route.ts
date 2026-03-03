import { NextResponse } from 'next/server';

import { getSupabaseUrl } from '@/lib/env';

/**
 * Public endpoint for CLI/Electron to discover OAuth configuration.
 * Returns the Supabase project URL and CLI OAuth client ID.
 * No authentication required.
 */
export async function GET() {
  const supabaseUrl = getSupabaseUrl();
  const cliClientId = process.env.SUPABASE_OAUTH_CLI_CLIENT_ID;

  if (!cliClientId) {
    return NextResponse.json(
      { error: 'OAuth not configured. SUPABASE_OAUTH_CLI_CLIENT_ID is not set.' },
      { status: 503 }
    );
  }

  return NextResponse.json({
    supabase_url: supabaseUrl,
    cli_client_id: cliClientId
  });
}
