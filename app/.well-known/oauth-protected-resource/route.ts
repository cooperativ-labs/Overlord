import { NextResponse } from 'next/server';

import { getSupabaseUrl, getPlatformUrl } from '@/lib/env';

/**
 * Protected Resource Metadata (RFC 9728).
 *
 * MCP clients (e.g. Claude) fetch this endpoint to discover which
 * authorization server protects the MCP resource and what scopes are needed.
 *
 * GET /.well-known/oauth-protected-resource
 */
export async function GET() {
  const supabaseUrl = getSupabaseUrl();
  const platformUrl = getPlatformUrl();

  return NextResponse.json(
    {
      resource: `${platformUrl}/api/mcp`,
      authorization_servers: [`${supabaseUrl}/auth/v1`],
      scopes_supported: ['openid', 'email', 'profile'],
      bearer_methods_supported: ['header']
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600'
      }
    }
  );
}
