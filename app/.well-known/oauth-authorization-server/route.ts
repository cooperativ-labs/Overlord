import { getSupabaseUrl } from '@/lib/env';

/**
 * OAuth Authorization Server Metadata (RFC 8414).
 *
 * Claude Connectors (and other MCP clients implementing the 2025-03-26 spec)
 * look for authorization server metadata at the MCP server's own origin:
 *
 *   GET /.well-known/oauth-authorization-server
 *
 * Since Overlord delegates authentication to Supabase Auth (an external
 * authorization server), this route proxies Supabase's metadata document so
 * that clients using the older spec path can still discover it.
 *
 * Clients using the 2025-06-18+ spec discover the authorization server via
 * the protected-resource metadata at /.well-known/oauth-protected-resource
 * and then fetch the auth server metadata from the Supabase origin directly.
 * This route provides backward-compat for both paths.
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, content-type, mcp-protocol-version, mcp-session-id'
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  const supabaseUrl = getSupabaseUrl();

  // Supabase serves RFC 8414 metadata at this path-aware URL
  const metadataUrl = `${supabaseUrl}/.well-known/oauth-authorization-server/auth/v1`;

  try {
    const upstream = await fetch(metadataUrl, {
      headers: { Accept: 'application/json' },
      // Cache in-flight for 1 hour at the edge
      next: { revalidate: 3600 }
    });

    if (!upstream.ok) {
      console.error(
        `[oauth-authz-server] upstream returned ${upstream.status} from ${metadataUrl}`
      );
      return new Response('Authorization server metadata unavailable', {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    const metadata = await upstream.json();

    return new Response(JSON.stringify(metadata), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    console.error('[oauth-authz-server] failed to fetch upstream metadata:', error);
    return new Response('Authorization server metadata unavailable', {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}
