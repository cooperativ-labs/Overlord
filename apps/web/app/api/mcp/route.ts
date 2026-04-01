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
 * GET  /api/mcp — returns 405 for SSE-capable transport probes, otherwise
 *                 serves protected-resource metadata for legacy discovery
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
 * GET /api/mcp — transport-aware helper.
 *
 * Streamable HTTP clients may open GET requests with `Accept: text/event-stream`
 * to probe for an SSE transport. We do not offer SSE on the public proxy route,
 * so those requests must receive 405. For plain JSON GETs, keep serving the
 * protected-resource metadata as a compatibility fallback.
 */
export async function GET(request: Request) {
  if (shouldRejectGetAsUnsupportedStream(request.headers.get('accept'))) {
    return new Response('Method not allowed', {
      status: 405,
      headers: {
        ...CORS_HEADERS,
        Allow: 'POST, DELETE, OPTIONS',
        'Content-Type': 'text/plain; charset=utf-8'
      }
    });
  }

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

export function responseStatusDisallowsBody(status: number): boolean {
  return status === 204 || status === 205 || status === 304;
}

export function shouldRejectGetAsUnsupportedStream(acceptHeader: string | null): boolean {
  if (!acceptHeader) return false;

  return acceptHeader
    .split(',')
    .map(part => part.trim().toLowerCase())
    .some(part => part.startsWith('text/event-stream'));
}

/** Forward relevant headers to the upstream edge function. */
export function forwardHeaders(request: Request): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': request.headers.get('content-type') ?? 'application/json'
  };

  const accept = request.headers.get('accept');
  if (accept) headers['accept'] = accept;

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
  const disallowBody = responseStatusDisallowsBody(upstream.status);
  const headers: Record<string, string> = { ...CORS_HEADERS };

  // Preserve content-type and auth challenge headers
  if (!disallowBody) {
    const ct = upstream.headers.get('content-type');
    if (ct) headers['Content-Type'] = ct;
  }

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

  return new Response(disallowBody ? null : body, {
    status: upstream.status,
    headers
  });
}
