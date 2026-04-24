# MCP Authentication & Client Integration Guide

## Purpose

This document describes the MCP authentication model that is currently implemented in Overlord.

Use this file when you need to answer:

- Which MCP URL should clients use?
- Which surfaces use OAuth vs `AGENT_TOKEN`?
- How does `/api/auth/token` fit in?
- What does the MCP server actually accept today?

## Current Surface Matrix

Overlord intentionally uses different auth flows for different surfaces.

| Surface | Transport | Runtime auth | Notes |
| --- | --- | --- | --- |
| Web MCP clients | `{PLATFORM_URL}/api/mcp` | Supabase OAuth 2.1 / OIDC | Primary path for browser-hosted MCP clients and connector-style integrations. |
| Cloud or headless agents configured by env vars | `{PLATFORM_URL}/api/mcp` | Shared OAuth credentials, with `AGENT_TOKEN` as a temporary compatibility override | Used when the agent cannot complete an interactive browser login. |
| Electron desktop app login | Platform auth endpoints | Supabase OAuth Authorization Code + PKCE | Electron stores the shared OAuth session locally after login. |
| Terminal agents launched from Electron | Local agent command + protocol/MCP calls | Shared OAuth credentials from Desktop login | Electron pre-fills `OVERLORD_URL` and `TICKET_ID`; `AGENT_TOKEN` is compatibility-only. |
| Human CLI login | Platform auth endpoints | Depends on CLI build | The local repo CLI uses loopback PKCE. The packaged CLI uses device-code flow. Both end up storing the shared OAuth session locally. |

## MCP Endpoint Shape

The customer-facing MCP endpoint is always:

```text
{PLATFORM_URL}/api/mcp
```

This route is a platform-hosted proxy. It forwards MCP JSON-RPC requests to the Supabase Edge Function at:

```text
{SUPABASE_URL}/functions/v1/mcp
```

Clients should not be pointed directly at the Supabase Edge Function unless you are debugging infrastructure. Product-facing setup should use the platform URL.

## OAuth Discovery Metadata

The protected-resource metadata URL implemented by the app is:

```text
{PLATFORM_URL}/.well-known/oauth-protected-resource/api/mcp
```

The app also serves a legacy compatibility path at:

```text
{PLATFORM_URL}/api/mcp/.well-known/oauth-protected-resource
```

The metadata body looks like:

```json
{
  "resource": "https://ovld.ai/api/mcp",
  "authorization_servers": ["https://project.supabase.co/auth/v1"],
  "scopes_supported": ["openid", "email", "profile"],
  "bearer_methods_supported": ["header"]
}
```

Additionally, `GET /api/mcp` returns the same protected-resource metadata so MCP clients that probe the resource URL directly can discover auth without a separate `.well-known` fetch.

When the upstream MCP handler returns a bearer challenge, the platform proxy rewrites `resource_metadata="..."` so clients discover the platform-hosted metadata URL, not the raw edge-function origin.

### Authorization Server Metadata (RFC 8414) Proxy

MCP clients using the older 2025-03-26 spec look for authorization server metadata at the MCP server's own origin:

```text
{PLATFORM_URL}/.well-known/oauth-authorization-server
```

Since Overlord delegates authentication to Supabase Auth (an external authorization server), this route proxies the metadata from:

```text
{SUPABASE_URL}/.well-known/oauth-authorization-server/auth/v1
```

This ensures compatibility with both MCP spec versions:
- **2025-03-26**: Client discovers auth at the MCP server's origin
- **2025-06-18+**: Client uses protected-resource metadata to find the external authorization server

## OAuth MCP Flow

This is the recommended flow for OAuth-capable MCP clients.

1. The client connects to `{PLATFORM_URL}/api/mcp`.
2. If it needs auth metadata, it reads `/.well-known/oauth-protected-resource/api/mcp`.
3. It discovers Supabase Auth as the authorization server.
4. If needed, it dynamically registers an OAuth client.
5. It completes Supabase OAuth Authorization Code + PKCE.
6. The user approves access on `/oauth/consent`.
7. The client sends the Supabase bearer token directly to `/api/mcp`.

There is no Overlord token-exchange step in this MCP flow.

## Legacy Agent Token MCP Flow

This is the compatibility and headless-runtime path.

1. A user creates or rotates a compatibility token for a specific organization.
2. The non-interactive runtime stores that token outside Overlord's shared OAuth credential record.
3. The runtime uses it as `Authorization: Bearer <AGENT_TOKEN>` when calling `{PLATFORM_URL}/api/mcp`.

This flow is only intended for:

- Headless cloud agents configured by environment variables
- CI jobs or remote shells that cannot complete OAuth login
- Temporary rollout compatibility for older clients

## MCP Token Resolution

The MCP server accepts two bearer token types, in this order:

### 1. `agent_token`

The server looks up the raw bearer value in `agent_tokens`.

Validation rules:

- The token must exist.
- `revoked_at` must be `NULL`.
- `expires_at` must be absent or in the future.
- `last_used_at` is updated best-effort.

Successful resolution returns:

- `authMethod: "agent_token"`
- `userId`
- `organizationId`
- `tokenId`

### 2. Supabase bearer token

If the bearer value is not an `agent_token`, the server tries to validate it as a Supabase-issued token.

Validation behavior:

- It first tries JWKS verification against Supabase Auth.
- It first attempts verification with `audience = "authenticated"`.
- If that fails, it retries without an audience constraint to support OAuth tokens whose audience is the OAuth client ID.
- If JWKS verification still fails, it falls back to `supabase.auth.getUser(token)`.
- It resolves organization membership from the `members` table.
- If `x-organization-id` is supplied, it tries to scope to that organization first.
- If no organization hint is supplied or the hint does not match a membership, it falls back to the first organization by ascending ID.

Successful resolution returns:

- `authMethod: "oauth_jwt"`
- `userId`
- `organizationId`
- `tokenId: null`

## 401 Challenge Behavior

If the MCP server cannot resolve a valid bearer token, the public `/api/mcp` proxy returns `401` with a `WWW-Authenticate` bearer challenge that includes the platform-hosted protected-resource metadata URL.

This allows OAuth-capable MCP clients to discover auth automatically from the public MCP origin.

## Supabase OAuth Requirements

The current code expects the following Supabase OAuth server settings:

- OAuth server enabled
- Dynamic client registration enabled for MCP-compatible clients
- Authorization URL path set to `/oauth/consent`

In local Supabase config this is represented as:

```toml
[auth.oauth_server]
enabled = true
authorization_url_path = "/oauth/consent"
allow_dynamic_registration = true
```

## Public Auth Configuration Endpoint

Human-facing login flows discover runtime OAuth settings from:

```text
GET {PLATFORM_URL}/api/auth/config
```

Response shape:

```json
{
  "supabase_url": "https://example.supabase.co",
  "cli_client_id": "577e4468-a806-489e-8b99-206471e7442c",
  "electron_client_id": "f9a4c58c-68c7-4a20-88f9-2a2dc3eed88e",
  "cli_redirect_uri": "http://127.0.0.1:45619/callback",
  "electron_redirect_uri": "http://127.0.0.1:45620/callback"
}
```

Notes:

- `cli_*` and `electron_*` values can be independently configured.
- Legacy single-client env vars are still supported as a fallback.
- This endpoint is for CLI and Electron login flows, not for browser MCP clients doing protected-resource discovery.

## `/api/auth/token` Exchange Contract

`POST {PLATFORM_URL}/api/auth/token`

Request:

- `Authorization: Bearer <supabase_oauth_access_token>`

Validation rules:

- The bearer token must be a Supabase OAuth token with a non-empty `client_id` claim.
- The `client_id` must match an allowlisted configured client.
- The token must resolve to a valid Supabase user.
- The user must belong to at least one organization.

Behavior:

- If an active `agent_token` already exists for `(user_id, organization_id)`, it is returned.
- Otherwise a new token is created and returned.

Response:

```json
{
  "access_token": "agent_token_xyz...",
  "platform_url": "https://your-overlord-instance.com"
}
```

This endpoint is deprecated for normal Desktop and CLI login. It remains only for rollout compatibility with older builds that still exchange OAuth sessions for agent tokens.

## Human Login Flows

### Electron desktop

Electron uses:

1. `GET /api/auth/config`
2. Supabase OAuth Authorization Code + PKCE on `/auth/v1/oauth/authorize`
3. Token exchange on `/auth/v1/oauth/token`
4. Organization lookup on `/api/auth/organizations`

Electron then stores the shared OAuth session in `~/.ovld` so Desktop launches and CLI protocol commands can use the same credentials.

### Local repo CLI

The local repo CLI currently uses the same loopback PKCE model as Electron:

1. `GET /api/auth/config`
2. Open browser to Supabase `/auth/v1/oauth/authorize`
3. Receive callback on the configured loopback redirect URI
4. Exchange on `/auth/v1/oauth/token`
5. Select an organization and store the shared OAuth session in `~/.ovld`

### Packaged CLI

The packaged CLI currently uses Overlord's device-code endpoints:

1. `POST /api/auth/device/request`
2. Human opens `verification_uri` in the browser
3. CLI polls `POST /api/auth/device/poll`
4. On approval, CLI receives OAuth access and refresh tokens

The packaged CLI therefore does not perform local loopback PKCE itself, but it stores the same OAuth-centered credential schema.

## Client Setup Guidance

### Claude custom connector

Use:

```text
{PLATFORM_URL}/api/mcp
```

Guidance:

- Prefer OAuth discovery and login through the connector flow.
- Do not tell users to paste an agent token for this path.

### Cursor

Use an MCP config that points at:

```json
{
  "mcpServers": {
    "overlord": {
      "url": "https://your-overlord-instance.com/api/mcp"
    }
  }
}
```

Guidance:

- Cursor should use the public MCP URL.
- The intended path is OAuth-capable MCP auth, not direct edge-function access.

### Codex CLI headless compatibility

Use this only for headless or cloud Codex runtimes that cannot complete OAuth login:

```toml
[mcp_servers.overlord]
url = "https://your-overlord-instance.com/api/mcp"
bearer_token_env_var = "AGENT_TOKEN"
```

Environment variables:

```text
OVERLORD_MCP_URL=https://your-overlord-instance.com/api/mcp
AGENT_TOKEN=<agent-token>
```

Guidance:

- Prefer `ovld auth login` or Overlord Desktop shared credentials for local Codex use.
- This is a compatibility path for non-interactive runtimes.
- The token variable is `AGENT_TOKEN`, not `OVERLORD_AGENT_TOKEN`.

### Headless cloud agents compatibility

For non-interactive runtimes, use:

```text
OVERLORD_MCP_URL=https://your-overlord-instance.com/api/mcp
AGENT_TOKEN=<agent-token>
```

Send:

```http
Authorization: Bearer <AGENT_TOKEN>
```

If the runtime supports org selection and the user belongs to multiple organizations, it may also send:

```http
x-organization-id: <organization-id>
```

## Example Requests

### MCP with OAuth bearer token

```bash
curl -X POST https://your-overlord-instance.com/api/mcp \
  -H "Authorization: Bearer <SUPABASE_OAUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

### MCP with agent token

```bash
curl -X POST https://your-overlord-instance.com/api/mcp \
  -H "Authorization: Bearer <AGENT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

### Exchange Supabase OAuth token for Overlord agent token

```bash
curl -X POST https://your-overlord-instance.com/api/auth/token \
  -H "Authorization: Bearer <SUPABASE_OAUTH_TOKEN>"
```

## Environment Variables

| Variable | Purpose | Used by |
| --- | --- | --- |
| `OVERLORD_URL` | Platform base URL | Electron, CLI, protocol routes |
| `OVERLORD_MCP_URL` | Public MCP URL | Headless/cloud agent setup snippets |
| `AGENT_TOKEN` | Legacy compatibility bearer token | Headless/cloud agents, CI, remote shell overrides |
| `TICKET_ID` | Ticket context for launched local agents | Electron-launched terminal agents |
| `SUPABASE_OAUTH_CLI_CLIENT_ID` | CLI OAuth client config | `/api/auth/config`, OAuth refresh |
| `SUPABASE_OAUTH_ELECTRON_CLIENT_ID` | Electron OAuth client config | `/api/auth/config`, OAuth refresh |

## Troubleshooting

### `401 Unauthorized`

Check:

- The request includes `Authorization: Bearer ...`
- The bearer token is either a valid `agent_token` or a valid Supabase bearer token
- The token is not revoked or expired
- The user still belongs to an organization

### `OAuth token required (missing client_id claim).`

This comes from `/api/auth/token`.

It means:

- You tried to exchange a non-OAuth Supabase token, or
- You supplied an invalid bearer token, or
- The JWT payload does not contain a usable `client_id`

### OAuth-capable MCP client cannot discover auth

Check:

- The client is using `{PLATFORM_URL}/api/mcp`
- The platform serves `/.well-known/oauth-protected-resource/api/mcp`
- The platform serves `/.well-known/oauth-authorization-server` (proxied from Supabase)
- `GET /api/mcp` returns protected-resource metadata (not 405)
- The `WWW-Authenticate` challenge contains `resource_metadata="..."`
- Supabase OAuth server and dynamic registration are enabled
- Supabase Auth is using asymmetric JWT signing keys (RS256/ES256) for JWKS compatibility

### Wrong organization in MCP requests

If the user belongs to multiple organizations, send:

```http
x-organization-id: <organization-id>
```

Otherwise the MCP auth layer falls back to the first membership by ascending organization ID.

## Source Files

- `lib/mcp/oauth-metadata.ts`
- `app/api/mcp/route.ts`
- `app/api/mcp/[...path]/route.ts`
- `app/.well-known/oauth-authorization-server/route.ts`
- `app/.well-known/oauth-protected-resource/route.ts`
- `app/.well-known/oauth-protected-resource/[...path]/route.ts`
- `supabase/functions/mcp/auth.ts`
- `app/api/auth/config/route.ts`
- `app/api/auth/token/route.ts`
- `app/api/auth/device/request/route.ts`
- `app/api/auth/device/poll/route.ts`
- `electron/ipc/auth.ts`
- `bin/_cli/auth.mjs`
- `packages/overlord-cli/bin/_cli/auth.mjs`
- `components/modals/settings/AgentsAndMcpPage.tsx`
