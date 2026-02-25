/// <reference lib="deno.ns" />
/**
 * Overlord MCP Server — Supabase Edge Function
 *
 * Implements the Model Context Protocol (MCP) over Streamable HTTP transport.
 * Exposes Overlord protocol operations as MCP tools so that cloud-based agents
 * (Claude Code, Codex, etc.) can interact with tickets natively.
 *
 * Protocol: JSON-RPC 2.0 / MCP 2024-11-05
 * Auth: Bearer token (same agent_tokens table as /api/protocol routes)
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from '@supabase/supabase-js';

import { resolveToken } from './auth.ts';
import { handleAttach } from './handlers/attach.ts';
import { handleAsk } from './handlers/ask.ts';
import { handleCreateTicket } from './handlers/create-ticket.ts';
import { handleDeliver } from './handlers/deliver.ts';
import { handleReadContext } from './handlers/read-context.ts';
import { handleUpdate } from './handlers/update.ts';
import { handleWriteContext } from './handlers/write-context.ts';
import { CORS_HEADERS, rpcError, rpcResult } from './rpc.ts';
import { TOOLS } from './tools.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  const tokenCtx = await resolveToken(req, supabase);
  if (!tokenCtx) {
    return rpcError(null, -32600, 'Unauthorized: missing or invalid bearer token.');
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, 'Parse error: invalid JSON.');
  }

  const { id, method, params } = body;

  // ---------------------------------------------------------------------------
  // MCP Lifecycle
  // ---------------------------------------------------------------------------

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'overlord', version: '1.0.0' }
    });
  }

  if (method === 'notifications/initialized') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (method === 'ping') {
    return rpcResult(id, {});
  }

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------

  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    const toolName: string = params?.name;
    const toolArgs: any = params?.arguments ?? {};

    try {
      let result: ReturnType<typeof import('./rpc.ts').toolOk>;

      if (toolName === 'attach') {
        result = await handleAttach(supabase, toolArgs, tokenCtx);
      } else if (toolName === 'update') {
        result = await handleUpdate(supabase, toolArgs, tokenCtx);
      } else if (toolName === 'ask') {
        result = await handleAsk(supabase, toolArgs, tokenCtx);
      } else if (toolName === 'read_context') {
        result = await handleReadContext(supabase, toolArgs, tokenCtx);
      } else if (toolName === 'write_context') {
        result = await handleWriteContext(supabase, toolArgs, tokenCtx);
      } else if (toolName === 'deliver') {
        result = await handleDeliver(supabase, toolArgs, tokenCtx);
      } else if (toolName === 'create_ticket') {
        result = await handleCreateTicket(supabase, toolArgs, tokenCtx);
      } else {
        return rpcError(id, -32601, `Unknown tool: ${toolName}`);
      }

      return rpcResult(id, result);
    } catch (err) {
      console.error(`[mcp] tool error (${toolName}):`, err);
      const msg = err instanceof Error ? err.message : String(err);
      return rpcResult(id, { content: [{ type: 'text', text: `Internal error: ${msg}` }], isError: true });
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
});
