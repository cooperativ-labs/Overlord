import { TOOLS } from '@/supabase/functions/mcp/tools';

/** Canonical public URL path for the static MCP tool catalog (no auth). */
export const MCP_TOOL_CATALOG_PATH = '/.well-known/overlord-mcp-tools.json';

/** @deprecated Use {@link MCP_TOOL_CATALOG_PATH}. Kept for redirects from the first public catalog route. */
export const MCP_TOOL_CATALOG_LEGACY_PATH = '/api/mcp/tools';

export const PUBLIC_TOOLS_CATALOG_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600';

export const PUBLIC_TOOLS_CATALOG_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type'
};

export function getAppMcpToolCatalogUrl(providedUrl?: string | null): string {
  const base = providedUrl?.trim();
  if (!base) {
    throw new Error('Missing platform URL for MCP tool catalog.');
  }
  return new URL(MCP_TOOL_CATALOG_PATH, base).toString();
}

export function buildPublicToolsCatalogBody(): string {
  return JSON.stringify({ tools: TOOLS });
}

export function buildPublicToolsCatalogResponse(): Response {
  return new Response(buildPublicToolsCatalogBody(), {
    status: 200,
    headers: {
      ...PUBLIC_TOOLS_CATALOG_CORS_HEADERS,
      'Content-Type': 'application/json',
      'Cache-Control': PUBLIC_TOOLS_CATALOG_CACHE_CONTROL
    }
  });
}
