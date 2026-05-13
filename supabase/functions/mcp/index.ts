/// <reference lib="deno.ns" />
/**
 * Overlord MCP Server — Supabase Edge Function
 *
 * Implements the Model Context Protocol (MCP) over Streamable HTTP transport.
 * Exposes Overlord protocol operations as MCP tools so that cloud-based agents
 * (Claude Code, Codex, etc.) can interact with tickets natively.
 *
 * Protocol: JSON-RPC 2.0 / MCP Streamable HTTP
 * Auth: OAuth 2.1 JWT bearer
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from '@supabase/supabase-js';

import { handleAsk } from './handlers/ask.ts';
import { handleAttach } from './handlers/attach.ts';
import { handleAttachmentFinalizeUpload } from './handlers/attachment-finalize-upload.ts';
import { handleAttachmentGetDownloadUrl } from './handlers/attachment-get-download-url.ts';
import { handleAttachmentList } from './handlers/attachment-list.ts';
import { handleAttachmentPrepareUpload } from './handlers/attachment-prepare-upload.ts';
import { handleCreateTicket } from './handlers/create-ticket.ts';
import { handleCreateTicketDraft } from './handlers/create-ticket-draft.ts';
import { handleDeliver } from './handlers/deliver.ts';
import { handleDiscoverProject } from './handlers/discover-project.ts';
import { handleDiscussObjective } from './handlers/discuss-objective.ts';
import { handleReadContext } from './handlers/read-context.ts';
import { handleRecordChangeRationales } from './handlers/record-change-rationales.ts';
import { handleRecordHookEvent } from './handlers/record-hook-event.ts';
import { handleSaveTicketDraft } from './handlers/save-ticket-draft.ts';
import { handleSearchTickets } from './handlers/search-tickets.ts';
import { handleUpdate } from './handlers/update.ts';
import { handleWriteContext } from './handlers/write-context.ts';
import { getUiResourceByUri, listUiResources } from './ui/resources.ts';
import { resolveToken } from './auth.ts';
import { negotiateProtocolVersion } from './protocol.ts';
import { buildCorsHeaders, rpcError, rpcResult } from './rpc.ts';
import { TOOLS } from './tools.ts';
import { validateToolInput } from './validate.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
function organizationIdFromTicketId(ticketId: unknown): number | null {
  if (typeof ticketId !== 'string') return null;
  const [organizationPart, , ...rest] = ticketId.trim().split(':');
  if (rest.length > 0) return null;
  const parsed = Number.parseInt(organizationPart ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function organizationIdFromRpcBody(body: any): number | null {
  if (body?.method !== 'tools/call') return null;
  const args = body?.params?.arguments ?? {};
  return (
    organizationIdFromTicketId(args.ticketId) ??
    organizationIdFromTicketId(args.ticket_id) ??
    organizationIdFromTicketId(args.parentTicketId) ??
    organizationIdFromTicketId(args.parent_ticket_id)
  );
}

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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, 'Parse error: invalid JSON.');
  }

  const tokenCtx = await resolveToken(req, supabase, organizationIdFromRpcBody(body));
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
            'IMPORTANT: Stop all work immediately. Your Overlord OAuth session is invalid, expired, or revoked. ' +
            'First run `ovld auth repair` yourself. If repair does not fix it, ask the user to sign in again with Overlord Desktop or `ovld auth login` if needed. ' +
            'Then ask whether they would like to proceed without submitting updates to Overlord.'
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

  const { id, method, params } = body;

  // ---------------------------------------------------------------------------
  // MCP Lifecycle
  // ---------------------------------------------------------------------------

  if (method === 'initialize') {
    const protocolVersion = negotiateProtocolVersion(params?.protocolVersion);

    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'overlord', version: '1.0.1' }
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
      } else if (toolName === 'list_attachments') {
        result = await handleAttachmentList(supabase, toolArgs, requestContext);
      } else if (toolName === 'prepare_attachment_upload') {
        result = await handleAttachmentPrepareUpload(supabase, toolArgs, requestContext);
      } else if (toolName === 'finalize_attachment_upload') {
        result = await handleAttachmentFinalizeUpload(supabase, toolArgs, requestContext);
      } else if (toolName === 'get_attachment_download_url') {
        result = await handleAttachmentGetDownloadUrl(supabase, toolArgs, requestContext);
      } else if (toolName === 'save_ticket_draft') {
        result = await handleSaveTicketDraft(supabase, toolArgs, requestContext);
      } else if (toolName === 'discuss_objective') {
        result = await handleDiscussObjective(supabase, toolArgs, requestContext);
      } else if (toolName === 'update') {
        result = await handleUpdate(supabase, toolArgs, requestContext);
      } else if (toolName === 'ask') {
        result = await handleAsk(supabase, toolArgs, requestContext);
      } else if (toolName === 'read_context') {
        result = await handleReadContext(supabase, toolArgs, requestContext);
      } else if (toolName === 'record_change_rationales') {
        result = await handleRecordChangeRationales(supabase, toolArgs, requestContext);
      } else if (toolName === 'record_hook_event') {
        result = await handleRecordHookEvent(supabase, toolArgs, requestContext);
      } else if (toolName === 'write_context') {
        result = await handleWriteContext(supabase, toolArgs, requestContext);
      } else if (toolName === 'deliver') {
        result = await handleDeliver(supabase, toolArgs, requestContext);
      } else if (toolName === 'create_ticket') {
        result = await handleCreateTicket(supabase, toolArgs, requestContext);
      } else if (toolName === 'discover_project') {
        result = await handleDiscoverProject(supabase, toolArgs, requestContext);
      } else if (toolName === 'search_tickets') {
        result = await handleSearchTickets(supabase, toolArgs, requestContext);
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
