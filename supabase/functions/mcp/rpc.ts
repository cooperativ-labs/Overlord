// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

/**
 * Allowed origins for CORS. MCP clients (CLI tools, desktop apps) send
 * requests without an Origin header, so those are allowed through.
 * Browser-based clients must match one of these patterns.
 */
const ALLOWED_ORIGINS = [
  'https://cooperativ.io',
  'https://www.cooperativ.io',
  'https://ovld.ai',
  'https://www.ovld.ai',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:54321'
];

/** Also allow any Vercel preview deployment subdomain. */
const ALLOWED_ORIGIN_PATTERNS = [/^https:\/\/.*\.vercel\.app$/];

export function getAllowedOrigin(origin: string | null): string | null {
  if (!origin) return null; // No Origin header = non-browser client (allowed)
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (ALLOWED_ORIGIN_PATTERNS.some((p) => p.test(origin))) return origin;
  return null;
}

export function buildCorsHeaders(origin: string | null): Record<string, string> {
  const allowed = getAllowedOrigin(origin);
  return {
    'Access-Control-Allow-Origin': allowed ?? '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, x-organization-id, x-request-id',
    ...(allowed ? { Vary: 'Origin' } : {})
  };
}

/**
 * @deprecated Use buildCorsHeaders(origin) for proper origin checking.
 * Kept as fallback for non-browser MCP tool requests (no Origin header).
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, x-organization-id, x-request-id'
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

export function rpcResult(id: unknown, result: unknown): Response {
  return jsonResponse({ jsonrpc: '2.0', id, result });
}

export function rpcError(id: unknown, code: number, message: string): Response {
  return jsonResponse({ jsonrpc: '2.0', id, error: { code, message } });
}

export type ToolResponse = { content: { type: string; text: string }[]; isError: boolean };

export function toolResult(text: string, isError = false): ToolResponse {
  return { content: [{ type: 'text', text }], isError };
}

export function toolOk(data: unknown): ToolResponse {
  return toolResult(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

export function toolErr(message: string): ToolResponse {
  return toolResult(message, true);
}
