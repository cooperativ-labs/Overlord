import { getSupabaseUrl } from '@/lib/env';
import {
  buildAppMcpProtectedResourceMetadata,
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
 * GET  /api/mcp — returns protected-resource metadata for OAuth discovery
 * POST /api/mcp — proxies MCP JSON-RPC calls to the edge function
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, content-type, mcp-protocol-version, mcp-session-id, x-organization-id, x-request-id',
  'Access-Control-Expose-Headers':
    'www-authenticate, mcp-protocol-version, mcp-session-id, x-request-id'
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/mcp — OAuth discovery helper.
 *
 * Claude Connectors and other MCP clients may send GET to the MCP endpoint
 * before POST. Instead of returning 405, we return the protected-resource
 * metadata (RFC 9728) so clients can discover authentication requirements
 * directly from the resource URL.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const metadata = buildAppMcpProtectedResourceMetadata(origin);

  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600'
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

/**
 * DELETE /api/mcp — session termination (MCP Streamable HTTP).
 *
 * Proxies DELETE requests to the upstream edge function. Claude and other
 * MCP clients send DELETE to close sessions gracefully.
 */
export async function DELETE(request: Request) {
  const edgeUrl = `${getSupabaseUrl()}/functions/v1/mcp`;

  const upstreamRes = await fetch(edgeUrl, {
    method: 'DELETE',
    headers: forwardHeaders(request)
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

  const sessionId = upstream.headers.get('mcp-session-id');
  if (sessionId) headers['mcp-session-id'] = sessionId;

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
