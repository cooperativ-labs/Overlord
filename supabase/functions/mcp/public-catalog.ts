import { TOOLS } from './tools.ts';

/** MCP JSON-RPC methods that may run without a bearer token (schemas only). */
export function isPublicMcpRpcMethod(method: unknown): boolean {
  return method === 'tools/list';
}

/** Whether this GET request should return the public tool catalog (no auth). */
export function isPublicToolsCatalogRequest(url: URL): boolean {
  if (url.searchParams.get('resource') === 'tools') return true;

  const segments = url.pathname.split('/').filter(Boolean);
  return segments.at(-1) === 'tools';
}

export function buildPublicToolsCatalogBody(): string {
  return JSON.stringify({ tools: TOOLS });
}

export const PUBLIC_TOOLS_CATALOG_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600';
