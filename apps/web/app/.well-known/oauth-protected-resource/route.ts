import { getPlatformUrl, getSupabaseUrl } from '@/lib/env';

/**
 * Protected Resource Metadata (RFC 9728).
 *
 * MCP clients (e.g. Claude) fetch this endpoint to discover which
 * authorization server protects the MCP resource and what scopes are needed.
 *
 * GET /.well-known/oauth-protected-resource
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, content-type, mcp-protocol-version, mcp-session-id, x-organization-id, x-request-id'
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  const supabaseUrl = getSupabaseUrl();
  const platformUrl = getPlatformUrl();

  return new Response(
    JSON.stringify({
      resource: `${platformUrl}/api/mcp`,
      authorization_servers: [`${supabaseUrl}/auth/v1`],
      scopes_supported: ['openid', 'email', 'profile'],
      bearer_methods_supported: ['header']
    }),
    {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      }
    }
  );
}
