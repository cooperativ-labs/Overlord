# MCP Auth And Integration

Overlord uses Supabase OAuth access tokens for protocol and MCP authentication.

## Current auth model

- MCP and protocol routes authenticate with `Authorization: Bearer <OAuth access token>`.
- Protocol routes also require `x-organization-id` to scope the request to an organization.
- The bearer token is verified as a Supabase JWT via the Supabase JWKS endpoint. The resolved `sub` claim is cross-checked against the `members` table to confirm the user belongs to the given organization.
- Desktop and CLI read shared OAuth credentials from `~/.ovld`.
- Headless or remote shells can inject:
  - `OVERLORD_URL`
  - `OVERLORD_ACCESS_TOKEN`
  - `OVERLORD_ORGANIZATION_ID`
- Local development may additionally protect routes with `OVERLORD_LOCAL_SECRET` (checked via `x-overlord-local-secret`), but bearer auth is still OAuth.

`agent_tokens`, `AGENT_TOKEN`, `/api/auth/token`, and `/api/auth/check-token` are removed.

## Supported flows

### Desktop

- Sign in through Overlord Desktop.
- Desktop stores the shared OAuth session and refreshes it as needed.
- Launched agents receive `OVERLORD_ACCESS_TOKEN` and `OVERLORD_ORGANIZATION_ID` in their env.

### CLI

- If a shared session already exists but looks stale, run `ovld auth repair` first.
- If repair does not restore access, run `ovld auth login`.
- The CLI fetches OAuth config from `GET /api/auth/config` (returns `supabase_url`, `cli_client_id`, `cli_redirect_uri`).
- The CLI stores:
  - `access_token`
  - `access_token_expires_at`
  - `refresh_token`
  - `organization_id`
  - `platform_url`
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

The protected-resource metadata points to `<supabase_url>/auth/v1` as the authorization server and declares `openid email profile` scopes.

`DELETE /api/mcp` proxies session termination (MCP Streamable HTTP).

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
- Invalid or expired sessions should be repaired with `ovld auth repair` first, then refreshed by signing in again with Desktop or `ovld auth login` if needed.
- The auth method recorded on protocol context is always `oauth_jwt`.
