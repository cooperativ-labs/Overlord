import {
  buildAppMcpProtectedResourceMetadata,
  MCP_RESOURCE_METADATA_LEGACY_PATH
} from '@/lib/mcp/oauth-metadata';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, content-type, mcp-protocol-version, mcp-session-id, x-organization-id, x-request-id',
  'Access-Control-Expose-Headers':
    'www-authenticate, mcp-protocol-version, mcp-session-id, x-request-id'
};

function isProtectedResourceMetadataPath(path: string[]): boolean {
  return `/${path.join('/')}` === MCP_RESOURCE_METADATA_LEGACY_PATH.replace('/api/mcp', '');
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;

  if (!isProtectedResourceMetadataPath(path)) {
    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  }

  const { origin } = new URL(request.url);

  return new Response(JSON.stringify(buildAppMcpProtectedResourceMetadata(origin)), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}
