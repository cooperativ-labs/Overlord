# MCP Auth And Integration

Overlord now uses Supabase OAuth access tokens for protocol and MCP authentication.

## Current auth model

- MCP clients authenticate with `Authorization: Bearer <OAuth access token>`.
- Web protocol routes authenticate with the same bearer token and require `x-organization-id`.
- Desktop and CLI normally read shared OAuth credentials from `~/.ovld`.
- Headless or remote shells can inject:
  - `OVERLORD_URL`
  - `OVERLORD_ACCESS_TOKEN`
  - `OVERLORD_ORGANIZATION_ID`

`agent_tokens`, `AGENT_TOKEN`, `/api/auth/token`, and `/api/auth/check-token` are removed.

## Supported flows

### Desktop

- Sign in through Overlord Desktop.
- Desktop stores the shared OAuth session and refreshes it as needed.
- Launched agents receive `OVERLORD_ACCESS_TOKEN` and `OVERLORD_ORGANIZATION_ID` in their env.

### CLI

- Run `ovld auth login`.
- The CLI stores:
  - `access_token`
  - `access_token_expires_at`
  - `refresh_token`
  - `organization_id`
  - `platform_url`
- The CLI refreshes access tokens automatically with the OAuth refresh token flow.

### Device flow

- `POST /api/auth/device/request` creates a short-lived approval code.
- Browser approval redirects through Supabase OAuth with PKCE.
- `POST /api/auth/device/poll` returns OAuth `access_token` and `refresh_token`.

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
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

## Operational notes

- OAuth tokens are organization-scoped at request time via `x-organization-id`.
- Invalid or expired sessions should be repaired by signing in again with Desktop or `ovld auth login`.
- Local development may still use the local runtime secret for localhost-only protection, but bearer auth is still OAuth.
