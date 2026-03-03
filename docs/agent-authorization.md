# Auth Contract

## Goal

Overlord supports five distinct auth paths. Each path must use the minimum required credential surface while preserving auditability and org scoping.

## Credential Types

1. `supabase_session`:
- Browser cookie/session for signed-in web users.

2. `supabase_oauth_access_token`:
- Short-lived Supabase OAuth token from Authorization Code + PKCE flow.
- Must include `client_id` claim.

3. `agent_token`:
- Long-lived bearer token in `agent_tokens`.
- Scoped to `(user_id, organization_id)`.

4. `overlord_local_secret`:
- Per-app-instance local secret for local Electron-hosted protocol routes.
- Used only when `OVERLORD_LOCAL_SECRET` is configured.

## Required Auth Paths

1. Web app user login:
- Auth method: Supabase Auth session (`signInWithPassword` / signup + callback).
- Credential used after login: `supabase_session`.
- Authorization boundary: server components/actions with `supabase.auth.getUser()`.

2. Electron login via web flow:
- Auth method: Supabase OAuth Authorization Code + PKCE.
- Exchange: `/api/auth/token` accepts only OAuth tokens with an allowlisted `client_id`.
- Output credential: persisted `agent_token` in encrypted local storage.

3. Terminal agents launched from Electron (local):
- Must remain zero-link UX: no extra login/link steps.
- Agent process receives `AGENT_TOKEN`, `OVERLORD_URL`, `TICKET_ID`, and `OVERLORD_LOCAL_SECRET` from Electron at launch.
- Protocol auth requires bearer token and (when configured) matching local secret.

4. Cloud agents via MCP (`supabase/functions/mcp/index.ts`):
- Auth method: bearer `agent_token`.
- Token validation must reject revoked or expired tokens.
- No local secret requirement for internet-facing MCP.

5. Standalone CLI login:
- Browser-mediated login flow obtains credential and stores local `agent_token`.
- Standalone CLI calls protocol routes with bearer token (and local secret only when targeting local Electron-hosted Overlord).

## Normative Rules

1. `/api/auth/token`:
- Must reject non-OAuth Supabase tokens (`client_id` missing).
- Must reject OAuth tokens from unknown clients.
- Allowed clients are configured by `SUPABASE_OAUTH_CLI_CLIENT_ID` and `SUPABASE_OAUTH_ELECTRON_CLIENT_ID`.

2. `/api/protocol/*` and `/api/protocol/permission-request`:
- Must validate `Authorization: Bearer <agent_token>`.
- Must validate `X-Overlord-Local-Secret` when `OVERLORD_LOCAL_SECRET` is set.

3. MCP token resolution:
- Must validate token exists and is active (`revoked_at IS NULL` and not expired).
- Must update `last_used_at` best-effort for audit.

4. UI token selection:
- Any UI surface that reads a launch token must scope lookup to the current user, not just organization.

## Security Notes

1. `agent_token` is organization-scoped and high-privilege; treat as secret.
2. Local secret is defense-in-depth for local-only protocol traffic.
3. OAuth scopes do not enforce DB permissions; RLS and token resolution do.
4. Future hardening candidate: short-lived session/ticket-scoped agent credentials.
