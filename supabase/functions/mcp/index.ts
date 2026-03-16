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

const MCP_INSTRUCTIONS = `# Overlord MCP Server

This is the **Overlord MCP Server**. It exposes Overlord's ticket system as MCP tools so you can work on tickets, post updates, deliver results, and create follow-up tickets — all without leaving your agent session.

## Authentication

Every request requires a Bearer token in the \`Authorization\` header:

\`\`\`
Authorization: Bearer <TOKEN>
\`\`\`

Two authentication methods are supported:

1. **OAuth 2.1 (recommended)** — Use the standard OAuth Authorization Code + PKCE flow. The server supports OAuth discovery via Protected Resource Metadata (RFC 9728) and the Supabase OAuth Authorization Server.
2. **Agent Token (legacy)** — A long-lived token obtained via the \`/api/auth/token\` exchange.

Your token is scoped to one organization. All ticket operations must belong to that organization.

---

## How to Work on a Ticket

### Step 1 — Attach to the ticket

Call \`attach\` first. Pass the ticket's UUID (from the \`TICKET_ID\` environment variable or from the user's instructions). This returns a \`sessionKey\` you must pass to every subsequent tool call.

\`\`\`json
{
  "ticketId": "<uuid>",
  "agentIdentifier": "claude-code",
  "connectionMethod": "mcp"
}
\`\`\`

The response contains:
- \`session.sessionKey\` — required for all subsequent calls
- \`promptContext\` — a ready-to-use context block assembled from the ticket, recent activity, artifacts, shared state, and user instructions
- \`ticket\` — full ticket record (objective, acceptance criteria, available tools, status, priority)
- \`history\` — prior delivery events from previous sessions
- \`artifacts\` — previously uploaded files
- \`sharedState\` — context written by prior sessions

### Step 2 — Post progress updates

Call \`update\` after each meaningful step so the PM can see your progress.

\`\`\`json
{
  "sessionKey": "<from attach>",
  "ticketId": "<uuid>",
  "summary": "Completed initial analysis. Found three affected files.",
  "phase": "execute"
}
\`\`\`

### Step 3 — Ask a blocking question (optional)

If you need human input before continuing, call \`ask\`. The ticket moves to review and waits for a response. **Stop working after calling this.**

\`\`\`json
{
  "sessionKey": "<from attach>",
  "ticketId": "<uuid>",
  "question": "Should I also update the staging environment or only production?"
}
\`\`\`

### Step 4 — Deliver your work

When done, call \`deliver\`. This moves the ticket to review for the PM. Always call this last.

\`\`\`json
{
  "sessionKey": "<from attach>",
  "ticketId": "<uuid>",
  "summary": "Implemented the feature. Updated 3 files and added tests.",
  "artifacts": [
    { "type": "file_changes", "label": "Changed files", "content": "- src/app.ts\n- src/utils.ts" },
    { "type": "next_steps", "label": "Next steps", "content": "Deploy to production and monitor logs." }
  ]
}
\`\`\`

Artifact types: \`file_changes\` | \`next_steps\` | \`test_results\` | \`migration\` | \`decision\` | \`note\` | \`url\`

---

## How to Create a New Ticket

### Create a follow-up ticket (while working on an existing ticket)

Use \`create_ticket\` when you discover work that a human must do or that needs to be tracked separately.

\`\`\`json
{
  "sessionKey": "<from attach>",
  "ticketId": "<current ticket uuid>",
  "title": "Update production environment variables",
  "objective": "Set the NEW_FEATURE_FLAG env var to true in the production Vercel project.",
  "executionTarget": "human",
  "priority": "high"
}
\`\`\`

- \`executionTarget\`: \`agent\` (another AI agent will pick it up) or \`human\` (requires a human)
- \`priority\`: \`low\` | \`medium\` | \`high\` | \`urgent\`

---

## How to Find a Ticket

Tickets are identified by a UUID. The ticket UUID is:
1. Provided in the \`TICKET_ID\` environment variable when the agent is launched by the Overlord system
2. Provided directly by the user in their message (e.g. "work on ticket abc123-...")
3. Included in the system prompt or context the user pastes

Once you have the UUID, call \`attach\` to load the full ticket details including the objective, acceptance criteria, and all prior history.

---

## Shared Context

Use \`read_context\` and \`write_context\` to persist and retrieve information across sessions.

**Write context** — save something for the next session:
\`\`\`json
{
  "sessionKey": "<from attach>",
  "ticketId": "<uuid>",
  "key": "deployment-notes",
  "value": "Always run yarn db:migrate before deploying.",
  "tags": ["deployment", "database"]
}
\`\`\`

**Read context** — recall prior session notes:
\`\`\`json
{
  "sessionKey": "<from attach>",
  "ticketId": "<uuid>",
  "query": "deployment"
}
\`\`\`

---

## File Artifacts (Uploads)

To attach a file to a ticket:

1. Call \`artifact_prepare_upload\` → get a signed PUT URL
2. Upload your file to that URL with \`Content-Type\` header
3. Call \`artifact_finalize_upload\` to persist the artifact record

To download an existing artifact, call \`artifact_get_download_url\` with the \`artifactId\` from the attach response.

---

## Tool Reference

| Tool | When to call | Required params |
|------|-------------|-----------------|
| \`attach\` | First — before any other tool | \`ticketId\`, \`agentIdentifier\` |
| \`update\` | After each meaningful step | \`sessionKey\`, \`ticketId\`, \`summary\` |
| \`ask\` | When you need human input (then stop) | \`sessionKey\`, \`ticketId\`, \`question\` |
| \`deliver\` | Last — when work is complete | \`sessionKey\`, \`ticketId\`, \`summary\` |
| \`create_ticket\` | To create a follow-up ticket | \`sessionKey\`, \`ticketId\`, \`objective\` |
| \`read_context\` | To recall prior session notes | \`sessionKey\`, \`ticketId\` |
| \`write_context\` | To save notes for future sessions | \`sessionKey\`, \`ticketId\`, \`key\`, \`value\` |
| \`artifact_prepare_upload\` | To upload a file | \`sessionKey\`, \`ticketId\`, \`fileName\` |
| \`artifact_finalize_upload\` | After uploading a file | \`sessionKey\`, \`ticketId\`, \`storagePath\`, \`label\` |
| \`artifact_get_download_url\` | To download an existing file | \`sessionKey\`, \`ticketId\` |

---

## Standard Workflow Summary

\`\`\`
attach(ticketId)
  → read ticket objective & acceptance criteria
  → update(summary, phase="execute")  [repeat as you work]
  → [optionally ask() if blocked]
  → deliver(summary, artifacts)
\`\`\`
`;

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

    return new Response(MCP_INSTRUCTIONS, {
      status: 200,
      headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' }
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
        result = await handleAttach(supabase, toolArgs, tokenCtx);
      } else if (toolName === 'create_ticket_draft') {
        result = await handleCreateTicketDraft(supabase, toolArgs, tokenCtx);
      } else if (toolName === 'artifact_prepare_upload') {
        result = await handleArtifactPrepareUpload(supabase, toolArgs, tokenCtx);
      } else if (toolName === 'artifact_finalize_upload') {
        result = await handleArtifactFinalizeUpload(supabase, toolArgs, tokenCtx);
      } else if (toolName === 'artifact_get_download_url') {
        result = await handleArtifactGetDownloadUrl(supabase, toolArgs, tokenCtx);
      } else if (toolName === 'save_ticket_draft') {
        result = await handleSaveTicketDraft(supabase, toolArgs, tokenCtx);
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
