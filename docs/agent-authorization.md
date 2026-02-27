# Agent Authorization Model

## Overview

Agents in Overlord act on behalf of a human user. Every agent action must be traceable back to the user who invoked it so that RLS policies, storage access, and audit trails reflect real human authorization.

## Current Implementation

### 1. Agent Tokens (`agent_tokens` table)

Each user can generate an **agent token** — a long-lived bearer credential stored in the `agent_tokens` table:

| Column            | Purpose                                      |
|-------------------|----------------------------------------------|
| `id`              | Primary key (UUID)                           |
| `token`           | The bearer token value (unique, auto-generated) |
| `user_id`         | FK to `auth.users` — the human who owns this token |
| `organization_id` | FK to `organizations` — scoped to one org    |
| `name`            | Label (e.g. "CLI Token")                     |
| `last_used_at`    | Updated on each use for auditing             |

Tokens are created/rotated via `rotateAgentTokenAction` in `lib/actions/agent-tokens.ts`.

### 2. Local (Electron / CLI) Agents

The Electron desktop app uses a **device authorization code flow** (`device_auth_codes` table):

1. The CLI requests a device code via `POST /api/auth/device/request`.
2. The user opens the approval URL in the web UI and approves the code (`app/auth/device/page.tsx`).
3. Once approved, the CLI polls `POST /api/auth/device/poll` and receives the `agent_token`.
4. All subsequent CLI requests include `Authorization: Bearer <agent_token>`.

This confirms the agent has permission to act for the user **locally**. The token resolves to `(user_id, organization_id)` at every API boundary.

### 3. Cloud-Based Agents (MCP Edge Function)

Cloud agents (Claude Code, Codex, etc.) connect to the MCP edge function at `supabase/functions/mcp/index.ts`:

1. The agent sends `Authorization: Bearer <agent_token>` with every request.
2. The `resolveToken(req, supabase)` function in `supabase/functions/mcp/auth.ts`:
   - Extracts the bearer token from the `Authorization` header.
   - Looks up the token in `agent_tokens` using the **service role** client (bypasses RLS).
   - Returns a `TokenContext { userId, organizationId, tokenId, tokenValue }`.
   - Updates `last_used_at` for audit purposes.
3. All downstream operations use this `TokenContext` to enforce access.

### 4. Overlord Protocol (REST API)

Agents using the Overlord protocol (`/api/protocol/attach`, `/api/protocol/update`, etc.) also authenticate via the agent token. The protocol endpoints:

1. Validate `Authorization: Bearer <agent_token>`.
2. Resolve the token to `(user_id, organization_id)`.
3. Create an `agent_session` record linking the agent to a specific ticket.
4. All subsequent operations within that session are scoped to the invoking user's permissions.

## How Agents Are Authorized for Storage

With the new `artifacts` storage bucket, agents access files through the same token-based auth:

- **Upload**: The server action (`uploadTicketDocumentAction`) runs under the user's Supabase session (for web UI) or the agent token context (for MCP/protocol). The RLS policy on `storage.objects` checks `has_org_role(org_id, ARRAY['AGENT', 'MANAGER', 'ADMIN'])`.
- **Read**: RLS checks `is_org_member(org_id)`.
- **Delete**: RLS checks `has_org_role(org_id, ARRAY['MANAGER', 'ADMIN'])`.

## How It Should Work (Recommended Enhancements)

### Current Gaps

1. **MCP token-to-Supabase-session bridge**: The MCP edge function currently uses the **service role** client to look up agent tokens, then performs operations with service-role privileges. This means RLS policies on `storage.objects` are bypassed when agents upload through MCP.

2. **No per-ticket scoping in tokens**: Agent tokens grant access to the entire organization. A compromised token could affect all tickets, not just the one the agent was assigned to.

### Recommended Improvements

1. **Impersonated Supabase client for MCP**: After resolving the agent token, the MCP function should create a Supabase client scoped to the invoking user (using `auth.admin.getUserById` + custom JWT claims or a short-lived user session). This ensures all downstream operations respect the same RLS policies that a human user would face.

2. **Session-scoped tokens**: Consider issuing short-lived, ticket-scoped tokens when an agent attaches to a session. This limits blast radius if a token is leaked.

3. **Audit logging**: Every file upload/delete by an agent should record the `agent_session_id` in the artifact metadata for traceability. The `uploaded_by` column on `artifacts` already tracks which user (or agent acting as user) performed the upload.

4. **Storage path enforcement**: The storage path convention `/<org_id>/<project_id>/<ticket_id>/...` combined with RLS helpers (`storage_org_id`, `storage_ticket_id`) ensures agents can only write files to paths matching their authorized organization and ticket.
