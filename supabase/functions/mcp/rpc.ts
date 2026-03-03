// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id'
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
