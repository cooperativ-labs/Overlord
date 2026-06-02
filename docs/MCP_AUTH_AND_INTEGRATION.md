# MCP Auth And Integration

Overlord uses Supabase OAuth access tokens for protocol and MCP authentication.

## Current auth model

- MCP and protocol routes authenticate with `Authorization: Bearer <OAuth access token>`.
- Ticket-scoped protocol and MCP calls infer organization scope from a human-readable `ticket_id` first (for example `1:899`). Sessionless object-scoped calls infer scope from stable ids such as `projectId`, `resourceId`, `objectiveId`, or `requestId`; browse/search flows resolve the caller's full membership list and fan out. `x-organization-id` remains an explicit single-org override.
- The bearer token is verified as a Supabase JWT via the Supabase JWKS endpoint. The resolved `sub` claim is cross-checked against the `members` table to confirm the user belongs to the inferred or explicit organization.
- Desktop and CLI read shared OAuth credentials from `~/.ovld`.
- Headless or remote shells can inject:
  - `OVERLORD_URL`
  - `OVERLORD_ACCESS_TOKEN`
  - `OVERLORD_ORGANIZATION_ID` when an explicit single-org override is needed
- Local development may additionally protect routes with `OVERLORD_LOCAL_SECRET` (checked via `x-overlord-local-secret`), but bearer auth is still OAuth.

`agent_tokens`, `AGENT_TOKEN`, `/api/auth/token`, and `/api/auth/check-token` are removed.

## Supported flows

### Desktop

- Sign in through Overlord Desktop.
- Desktop stores the shared OAuth session and refreshes it as needed.
- Launched agents receive `OVERLORD_ACCESS_TOKEN`; `OVERLORD_ORGANIZATION_ID` is only needed for explicit single-org overrides.

### CLI

- If a shared session already exists but looks stale, run `ovld auth repair` first.
- If repair does not restore access, run `ovld auth login`.
- The CLI fetches OAuth config from `GET /api/auth/config` (returns `supabase_url`, `cli_client_id`, `cli_redirect_uri`).
- The CLI stores identity only:
  - `access_token`
  - `access_token_expires_at`
  - `refresh_token`
  - `platform_url`
- The CLI does not store a default organization. `ovld auth status --verbose` lists every organization the identity belongs to; pass `--organization-id <id>` only to validate/scope a specific command to one organization.
- The CLI refreshes access tokens automatically with the OAuth refresh token flow.
- Desktop-installed CLI wrappers default `OVERLORD_URL` to `https://www.ovld.ai`.
- For local dev against the web app on `http://localhost:3000`, explicitly override it before login or protocol commands:

```bash
export OVERLORD_URL=http://localhost:3000
ovld auth login
```

### Device flow

- `POST /api/auth/device/request` creates a short-lived device code and a human-readable user code.
  - Returns `device_code`, `user_code`, `verification_uri`, `expires_in` (900 s), `interval` (5 s).
- User approves at `verification_uri` (e.g. `https://www.ovld.ai/auth/device?code=XXXX-XXXX`), which completes Supabase OAuth with PKCE.
- `POST /api/auth/device/poll` accepts `{ device_code }` and returns one of:
  - `{ status: "pending" }` — not yet approved
  - `{ status: "slow_down", interval }` — polling too fast (429)
  - `{ status: "expired" }` — code expired (400)
  - `{ status: "authorized", access_token, refresh_token, access_token_expires_at, platform_url }` — success (code is atomically consumed)

## MCP endpoint

The public MCP endpoint is `POST /api/mcp`. It proxies to the Supabase Edge Function (`/functions/v1/mcp`). Auth is handled upstream by the edge function; the proxy forwards `authorization`, `x-organization-id`, `mcp-session-id`, `mcp-protocol-version`, and `x-request-id` headers.

### OAuth discovery

OAuth-capable MCP clients discover auth via protected-resource metadata:

| Path | Purpose |
|------|---------|
| `GET /.well-known/oauth-protected-resource/api/mcp` | Canonical protected-resource metadata (RFC 9728) |
| `GET /api/mcp/.well-known/oauth-protected-resource` | Legacy discovery path (backward compat) |
| `GET /.well-known/oauth-authorization-server` | Proxies Supabase's RFC 8414 metadata (backward compat for older spec clients) |

The protected-resource metadata points to `<supabase_url>/auth/v1` as the authorization server and declares `openid email profile` scopes. It also includes:

- `tool_catalog` — public JSON manifest of every MCP tool schema (no auth)
- `resource_documentation` — human-readable agent docs at `/agent-docs`

### Public tool catalog

| Path | Purpose |
|------|---------|
| `GET /.well-known/overlord-mcp-tools.json` | Canonical static tool catalog (`{ "tools": [...] }`) |
| `GET /api/mcp/tools` | Legacy path; 308 redirect to the well-known catalog |
| `POST /api/mcp` with `tools/list` | MCP-native schema discovery (no auth) |

All other MCP methods (`initialize`, `tools/call`, etc.) require a valid OAuth bearer token.

`DELETE /api/mcp` proxies session termination (MCP Streamable HTTP).

Ticket creation tools that accept `objective` also accept an ordered `objectives` array of objects:

```json
[
  { "objective": "Draft the plan", "title": "Plan" },
  { "objective": "Implement the approved plan", "autoAdvance": true }
]
```

Use `add_objectives` to append ordered objectives to an existing ticket. Index 0 is the first newly added objective to execute; later indexes queue after it. Agents should create multiple tickets for different features or goals, and use same-ticket objectives for sequential steps toward one feature or goal.

## Request examples

### Protocol route

```bash
curl -X POST "$OVERLORD_URL/api/protocol/update" \
  -H "Authorization: Bearer $OVERLORD_ACCESS_TOKEN" \
  -H "x-organization-id: $OVERLORD_ORGANIZATION_ID" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### MCP route

```bash
curl -X POST "$OVERLORD_URL/api/mcp" \
  -H "Authorization: Bearer $OVERLORD_ACCESS_TOKEN" \
  -H "x-organization-id: $OVERLORD_ORGANIZATION_ID" \
  -H "mcp-protocol-version: 2025-03-26" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

### OAuth config discovery

```bash
curl "$OVERLORD_URL/api/auth/config"
# Returns: { supabase_url, cli_client_id, electron_client_id, cli_redirect_uri, electron_redirect_uri }
```

## Operational notes

- OAuth tokens are organization-scoped at request time via `x-organization-id`. The server verifies membership in the `members` table.
- For ticket-scoped commands, prefer passing the human-readable `ticket_id`; `--organization-id` and `x-organization-id` are compatibility fallbacks for UUID ticket ids and non-ticket operations.
- If a protocol/MCP call fails because the session is invalid or expired, the agent should run `ovld auth repair` itself first. If repair does not fix it, then refresh by signing in again with Desktop or `ovld auth login` if needed.
- The auth method recorded on protocol context is always `oauth_jwt`.
