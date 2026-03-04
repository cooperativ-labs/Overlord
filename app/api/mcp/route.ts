import { getPlatformUrl, getSupabaseUrl } from '@/lib/env';

/**
 * MCP proxy — customer-facing MCP endpoint.
 *
 * Proxies requests to the Supabase Edge Function while keeping the MCP URL
 * on our domain so that OAuth discovery (/.well-known/oauth-protected-resource)
 * works from the same origin.
 *
 * GET  /api/mcp — returns MCP instructions or protected resource metadata
 * POST /api/mcp — proxies MCP JSON-RPC calls to the edge function
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id'
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  // Serve Protected Resource Metadata inline when requested via subpath
  if (url.pathname.endsWith('/.well-known/oauth-protected-resource')) {
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
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      }
    );
  }

  // Proxy the GET request to the edge function for MCP instructions
  const edgeUrl = `${getSupabaseUrl()}/functions/v1/mcp`;
  const upstreamRes = await fetch(edgeUrl, {
    method: 'GET',
    headers: forwardHeaders(request)
  });

  return proxyResponse(upstreamRes);
}

export async function POST(request: Request) {
  const edgeUrl = `${getSupabaseUrl()}/functions/v1/mcp`;
  const body = await request.text();

  const upstreamRes = await fetch(edgeUrl, {
    method: 'POST',
    headers: forwardHeaders(request),
    body
  });

  return proxyResponse(upstreamRes);
}

/** Forward relevant headers to the upstream edge function. */
function forwardHeaders(request: Request): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': request.headers.get('content-type') ?? 'application/json'
  };

  const auth = request.headers.get('authorization');
  if (auth) headers['authorization'] = auth;

  const sessionId = request.headers.get('mcp-session-id');
  if (sessionId) headers['mcp-session-id'] = sessionId;

  return headers;
}

/** Relay the upstream response back to the client with CORS headers. */
async function proxyResponse(upstream: Response): Promise<Response> {
  const body = await upstream.text();
  const headers: Record<string, string> = { ...CORS_HEADERS };

  // Preserve content-type and auth challenge headers
  const ct = upstream.headers.get('content-type');
  if (ct) headers['Content-Type'] = ct;

  const wwwAuth = upstream.headers.get('www-authenticate');
  if (wwwAuth) headers['WWW-Authenticate'] = wwwAuth;

  return new Response(body, {
    status: upstream.status,
    headers
  });
}
