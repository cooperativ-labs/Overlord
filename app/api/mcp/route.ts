import { getSupabaseUrl } from '@/lib/env';
import {
  getAppMcpResourceMetadataUrl,
  rewriteBearerResourceMetadata
} from '@/lib/mcp/oauth-metadata';

/**
 * MCP proxy — customer-facing MCP endpoint.
 *
 * Proxies requests to the Supabase Edge Function while keeping the MCP URL
 * on our domain. The protected-resource metadata lives on a sibling catch-all
 * route so OAuth-capable clients can discover auth from the public MCP URL.
 *
 * GET  /api/mcp — returns MCP instructions or protected resource metadata
 * POST /api/mcp — proxies MCP JSON-RPC calls to the edge function
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, content-type, mcp-protocol-version, mcp-session-id, x-organization-id, x-request-id'
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(_request: Request) {
  return new Response('Method not allowed', {
    status: 405,
    headers: {
      ...CORS_HEADERS,
      Allow: 'POST, OPTIONS',
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
}

export async function POST(request: Request) {
  const edgeUrl = `${getSupabaseUrl()}/functions/v1/mcp`;
  const body = await request.text();

  const upstreamRes = await fetch(edgeUrl, {
    method: 'POST',
    headers: forwardHeaders(request),
    body
  });

  return proxyResponse(upstreamRes, request);
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

  const protocolVersion = request.headers.get('mcp-protocol-version');
  if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion;

  const organizationId = request.headers.get('x-organization-id');
  if (organizationId) headers['x-organization-id'] = organizationId;

  const requestId = request.headers.get('x-request-id');
  if (requestId) headers['x-request-id'] = requestId;

  return headers;
}

/** Relay the upstream response back to the client with CORS headers. */
async function proxyResponse(upstream: Response, request: Request): Promise<Response> {
  const body = await upstream.text();
  const headers: Record<string, string> = { ...CORS_HEADERS };

  // Preserve content-type and auth challenge headers
  const ct = upstream.headers.get('content-type');
  if (ct) headers['Content-Type'] = ct;

  const protocolVersion = upstream.headers.get('mcp-protocol-version');
  if (protocolVersion) headers['MCP-Protocol-Version'] = protocolVersion;

  const wwwAuth = upstream.headers.get('www-authenticate');
  if (wwwAuth) {
    headers['WWW-Authenticate'] = rewriteBearerResourceMetadata(
      wwwAuth,
      getAppMcpResourceMetadataUrl(new URL(request.url).origin)
    );
  }

  return new Response(body, {
    status: upstream.status,
    headers
  });
}
