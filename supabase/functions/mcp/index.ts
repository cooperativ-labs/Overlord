/// <reference lib="deno.ns" />
/**
 * Overlord MCP Server — Supabase Edge Function
 *
 * Implements the Model Context Protocol (MCP) over Streamable HTTP transport.
 * Exposes Overlord protocol operations as MCP tools so that cloud-based agents
 * (Claude Code, Codex, etc.) can interact with tickets natively.
 *
 * Protocol: JSON-RPC 2.0 / MCP Streamable HTTP
 * Auth: OAuth 2.1 JWT (primary) or legacy agent_token bearer
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from '@supabase/supabase-js';

import { handleArtifactFinalizeUpload } from './handlers/artifact-finalize-upload.ts';
import { handleArtifactGetDownloadUrl } from './handlers/artifact-get-download-url.ts';
import { handleArtifactPrepareUpload } from './handlers/artifact-prepare-upload.ts';
import { handleAsk } from './handlers/ask.ts';
import { handleAttach } from './handlers/attach.ts';
import { handleCreateTicket } from './handlers/create-ticket.ts';
import { handleCreateTicketDraft } from './handlers/create-ticket-draft.ts';
import { handleDeliver } from './handlers/deliver.ts';
import { handleReadContext } from './handlers/read-context.ts';
import { handleSaveTicketDraft } from './handlers/save-ticket-draft.ts';
import { handleUpdate } from './handlers/update.ts';
import { handleWriteContext } from './handlers/write-context.ts';
import { getUiResourceByUri, listUiResources } from './ui/resources.ts';
import { resolveToken } from './auth.ts';
import { buildCorsHeaders, rpcError, rpcResult } from './rpc.ts';
import { TOOLS } from './tools.ts';
import { validateToolInput } from './validate.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-05', '2025-06-18', '2025-03-26', '2024-11-05'];

/**
 * Build the Protected Resource Metadata document (RFC 9728).
 * This tells MCP clients where to find the authorization server.
 */
function buildProtectedResourceMetadata() {
  return {
    resource: `${SUPABASE_URL}/functions/v1/mcp`,
    authorization_servers: [`${SUPABASE_URL}/auth/v1`],
    scopes_supported: ['openid', 'email', 'profile'],
    bearer_methods_supported: ['header']
  };
}

function negotiateProtocolVersion(requested: unknown): string | null {
  if (typeof requested !== 'string') {
    return SUPPORTED_PROTOCOL_VERSIONS[0];
  }

  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const cors = buildCorsHeaders(origin);

  // Request tracing — use client-provided ID or generate one
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  cors['x-request-id'] = requestId;

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method === 'GET') {
    const url = new URL(req.url);

    // Serve Protected Resource Metadata (RFC 9728) for OAuth discovery
    if (url.pathname.endsWith('/.well-known/oauth-protected-resource')) {
      return new Response(JSON.stringify(buildProtectedResourceMetadata()), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    return new Response('Method not allowed', {
      status: 405,
      headers: { ...cors, Allow: 'POST, OPTIONS', 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: cors });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  const tokenCtx = await resolveToken(req, supabase);
  if (!tokenCtx) {
    const resourceMetadataUrl = `${SUPABASE_URL}/functions/v1/mcp/.well-known/oauth-protected-resource`;
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message:
            'Unauthorized: missing or invalid bearer token. ' +
            'IMPORTANT: Stop all work immediately. Your agent token is invalid, expired, or revoked. ' +
            'Tell the user to open Overlord Settings → Agent Tokens and retrieve an updated token for this project. ' +
            'Ask the user if they would like to proceed without submitting updates to Overlord.'
        }
      }),
      {
        status: 401,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"`
        }
      }
    );
  }

  const requestContext = {
    ...tokenCtx,
    mcpSessionId: req.headers.get('mcp-session-id')?.trim() || null
  };

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
    const protocolVersion = negotiateProtocolVersion(params?.protocolVersion);
    if (!protocolVersion) {
      return rpcError(
        id,
        -32602,
        `Unsupported protocol version: ${String(params?.protocolVersion ?? 'undefined')}`
      );
    }

    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'overlord', version: '1.0.0' }
        }
      }),
      {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': protocolVersion
        }
      }
    );
  }

  if (method === 'notifications/initialized') {
    return new Response(null, { status: 204, headers: cors });
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

  if (method === 'resources/list') {
    return rpcResult(id, { resources: listUiResources() });
  }

  if (method === 'resources/read') {
    const resourceUri = params?.uri;
    const resource = typeof resourceUri === 'string' ? getUiResourceByUri(resourceUri) : null;
    if (!resource) {
      return rpcError(id, -32602, `Unknown resource: ${resourceUri ?? 'undefined'}`);
    }

    return rpcResult(id, {
      contents: [
        {
          uri: resource.uri,
          mimeType: resource.mimeType,
          text: resource.text,
          _meta: resource._meta
        }
      ]
    });
  }

  if (method === 'tools/call') {
    const toolName: string = params?.name;
    const toolArgs: any = params?.arguments ?? {};

    // Server-side input validation against tool schema
    const validationError = validateToolInput(toolName, toolArgs);
    if (validationError) {
      return rpcResult(id, {
        content: [{ type: 'text', text: validationError }],
        isError: true
      });
    }

    try {
      let result: ReturnType<typeof import('./rpc.ts').toolOk>;

      if (toolName === 'attach') {
        result = await handleAttach(supabase, toolArgs, requestContext);
      } else if (toolName === 'create_ticket_draft') {
        result = await handleCreateTicketDraft(supabase, toolArgs, requestContext);
      } else if (toolName === 'artifact_prepare_upload') {
        result = await handleArtifactPrepareUpload(supabase, toolArgs, requestContext);
      } else if (toolName === 'artifact_finalize_upload') {
        result = await handleArtifactFinalizeUpload(supabase, toolArgs, requestContext);
      } else if (toolName === 'artifact_get_download_url') {
        result = await handleArtifactGetDownloadUrl(supabase, toolArgs, requestContext);
      } else if (toolName === 'save_ticket_draft') {
        result = await handleSaveTicketDraft(supabase, toolArgs, requestContext);
      } else if (toolName === 'update') {
        result = await handleUpdate(supabase, toolArgs, requestContext);
      } else if (toolName === 'ask') {
        result = await handleAsk(supabase, toolArgs, requestContext);
      } else if (toolName === 'read_context') {
        result = await handleReadContext(supabase, toolArgs, requestContext);
      } else if (toolName === 'write_context') {
        result = await handleWriteContext(supabase, toolArgs, requestContext);
      } else if (toolName === 'deliver') {
        result = await handleDeliver(supabase, toolArgs, requestContext);
      } else if (toolName === 'create_ticket') {
        result = await handleCreateTicket(supabase, toolArgs, requestContext);
      } else {
        return rpcError(id, -32601, `Unknown tool: ${toolName}`);
      }

      return rpcResult(id, result);
    } catch (err) {
      // Log full error with request ID for debugging, return sanitized message to client
      console.error(`[mcp] tool error (${toolName}) [${requestId}]:`, err);
      return rpcResult(id, {
        content: [
          {
            type: 'text',
            text: `An internal error occurred (ref: ${requestId}). Please try again or contact support.`
          }
        ],
        isError: true
      });
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
});
