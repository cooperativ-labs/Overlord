---
name: supabase-oauth
description: Implementing and using Supabase as an OAuth 2.1 / OIDC server for MCP authentication and third-party app authorization.
---

# supabase-oauth

## Instructions

Apply this skill when creating or modifying OAuth server functionality, MCP authentication, consent screens, token validation, or RLS policies that reference `client_id`.

### Overview

Supabase Auth acts as an **OAuth 2.1 + OpenID Connect** identity provider. It supports:
- Authorization Code flow with **mandatory PKCE**
- Refresh Token grant
- Dynamic Client Registration (for MCP clients)
- OIDC Discovery, JWKS, and UserInfo endpoints

**Not supported:** `client_credentials`, `password`, or `implicit` grants.

---

### Endpoints

| Endpoint | Cloud | Local |
|---|---|---|
| Authorization | `https://<ref>.supabase.co/auth/v1/oauth/authorize` | `http://localhost:54321/auth/v1/oauth/authorize` |
| Token | `https://<ref>.supabase.co/auth/v1/oauth/token` | `http://localhost:54321/auth/v1/oauth/token` |
| UserInfo | `https://<ref>.supabase.co/auth/v1/oauth/userinfo` | `http://localhost:54321/auth/v1/oauth/userinfo` |
| JWKS | `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` | same pattern |
| OAuth Discovery | `https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1` | same pattern |
| OIDC Discovery | `https://<ref>.supabase.co/auth/v1/.well-known/openid-configuration` | same pattern |

---

### Enabling the OAuth Server

**Dashboard:** Authentication → OAuth Server → Enable.

**Local (CLI):** Configure in `supabase/config.toml`, then restart local Supabase.

Set the **Authorization Path** (e.g., `/oauth/consent`) in the dashboard. Combined with Site URL, this is where users are redirected with an `authorization_id` query param.

---

### JWT Signing

Use **asymmetric keys** (RS256 / ES256) instead of the default HS256:
- OAuth clients validate JWTs via the public JWKS endpoint — no shared secret needed.
- **OIDC ID tokens require asymmetric signing**; HS256 will fail.

---

### Scopes

| Scope | Purpose |
|---|---|
| `openid` | Enables OIDC; includes ID token in response |
| `email` | Email and `email_verified` claims |
| `profile` | Name, picture, etc. |
| `phone` | Phone number and `phone_number_verified` |

Default scope when none specified: `email`. Custom scopes are not yet supported.

**Important:** Scopes only control what goes into ID tokens and the UserInfo response. They do **not** restrict database/API access — that's the job of RLS policies.

---

### Client Registration

**Manual (Dashboard):** Authentication → OAuth Apps → Add a new client.
- **Public** clients: mobile/SPA, no secret, `token_endpoint_auth_method: none`.
- **Confidential** clients: server-side, receives a client secret (shown once).

**Dynamic Registration:** Enable under Authentication → OAuth Server. MCP-compatible clients self-register. When enabled, enforce:
- Explicit user approval for every new client.
- Validate redirect URIs against trusted domains.
- Regularly audit registered clients.

---

### Authorization Code Flow with PKCE

1. **Generate PKCE pair:**

```ts
const codeVerifier = base64URLEncode(crypto.getRandomValues(new Uint8Array(32)));
const codeChallenge = base64URLEncode(
  new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier)))
);
```

2. **Authorization request:**

```
GET /auth/v1/oauth/authorize?
  response_type=code
  &client_id=<client-id>
  &redirect_uri=<uri>
  &state=<random>
  &code_challenge=<challenge>
  &code_challenge_method=S256
  &scope=openid+email        // optional
  &nonce=<random>             // optional, for replay protection
```

3. **User approves** on the consent page (see Consent Screen below).

4. **Token exchange** (public client example):

```bash
POST /auth/v1/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<code>
&client_id=<client-id>
&redirect_uri=<uri>
&code_verifier=<verifier>
```

Confidential clients authenticate via `client_secret_basic` (HTTP Basic) or `client_secret_post` (body params).

5. **Token response:**

```json
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 3600,
  "refresh_token": "MXff...",
  "scope": "openid email",
  "id_token": "eyJ..."
}
```

---

### Refresh Token Flow

```bash
POST /auth/v1/oauth/token

grant_type=refresh_token
&refresh_token=<token>
&client_id=<client-id>
```

Tokens may rotate — always store the new refresh token from the response.

---

### Consent Screen Implementation

This project's consent page lives at `app/oauth/consent/`. The flow:

1. User arrives at `/oauth/consent?authorization_id=<id>`.
2. If not authenticated → redirect to `/login?next=...`.
3. Call `supabase.auth.oauth.getAuthorizationDetails(authorization_id)`.
   - If the user already consented, `authDetails` contains `redirect_url` directly — redirect immediately.
   - Otherwise, display the consent UI with `client` info and `scope`.
4. On approve → `supabase.auth.oauth.approveAuthorization(authorization_id)` → redirect to `data.redirect_url`.
5. On deny → `supabase.auth.oauth.denyAuthorization(authorization_id)` → redirect to `data.redirect_url`.

**SDK methods:**
- `supabase.auth.oauth.getAuthorizationDetails(id)` — fetch client + scope info
- `supabase.auth.oauth.approveAuthorization(id)` — approve and get redirect
- `supabase.auth.oauth.denyAuthorization(id)` — deny and get redirect
- `supabase.auth.oauth.getUserGrants()` — list user's authorized apps
- `supabase.auth.oauth.revokeGrant(clientId)` — revoke a client's access

Legacy path `/auth/authorize` redirects to `/oauth/consent`.

---

### MCP Authentication

MCP clients authenticate against Supabase Auth's OAuth 2.1 server. The flow:

1. **Discovery** — MCP client fetches `/.well-known/oauth-authorization-server/auth/v1`.
2. **Registration** — Client either uses pre-registered credentials or dynamically registers.
3. **Authorization** — Standard PKCE flow; user approves on consent page.
4. **Token Exchange** — Standard token endpoint call.
5. **Authenticated Requests** — MCP server sends `Authorization: Bearer <access_token>`.

Enable **Dynamic Client Registration** in the dashboard to let MCP clients self-register.

---

### Access Token Structure

```json
{
  "aud": "authenticated",
  "sub": "user-uuid",
  "role": "authenticated",
  "client_id": "9a8b7c6d-...",
  "email": "user@example.com",
  "iss": "https://<ref>.supabase.co/auth/v1",
  "iat": 1735815600,
  "exp": 1735819200
}
```

The `client_id` claim distinguishes OAuth-issued tokens from direct session tokens (where `client_id` is `null`).

---

### Token Validation (External Services)

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL('https://<ref>.supabase.co/auth/v1/.well-known/jwks.json')
);

const { payload } = await jwtVerify(token, JWKS, {
  issuer: 'https://<ref>.supabase.co/auth/v1',
  audience: 'authenticated',
});
```

Validate: signature, `iss`, `aud`, `exp`, and `client_id`.

---

### RLS Policies with `client_id`

Use `auth.jwt() ->> 'client_id'` in Postgres policies:

```sql
-- Full access for a specific OAuth client
CREATE POLICY "mobile_app_access" ON my_table
  FOR ALL USING ((auth.jwt() ->> 'client_id') = 'mobile-app-client-id');

-- Read-only for multiple clients
CREATE POLICY "analytics_read" ON my_table
  FOR SELECT USING ((auth.jwt() ->> 'client_id') IN ('client-a', 'client-b'));

-- Direct sessions only (block all OAuth clients)
CREATE POLICY "direct_only" ON my_table
  FOR ALL USING ((auth.jwt() ->> 'client_id') IS NULL);

-- Any OAuth client (block direct sessions)
CREATE POLICY "oauth_only" ON my_table
  FOR ALL USING ((auth.jwt() ->> 'client_id') IS NOT NULL);
```

Use `AS RESTRICTIVE` to layer constraints on top of permissive policies.

**Testing RLS:**
```sql
SET request.jwt.claims = '{"sub":"user-uuid","client_id":"test-client-id"}';
SELECT * FROM my_table WHERE user_id = 'user-uuid';
```

---

### Custom Access Token Hooks

Use hooks to customize OAuth-issued tokens:
- Add a specific `aud` claim for third-party API validation.
- Inject client-specific permissions based on `client_id`.
- Check `authentication_method = 'oauth_provider/authorization_code'` to detect OAuth flow.

---

### Redirect URI Rules

- **HTTPS required** in production.
- **Exact match only** — no wildcards or patterns.
- **Separate clients per environment** (dev, staging, prod).
- Include full path with protocol, domain, path, and port.

---

## Examples

### Adding a new OAuth client for an MCP server

1. Go to Authentication → OAuth Apps → Add new client.
2. Set type to **Public** (for CLI/desktop MCP clients) or **Confidential** (for server-side).
3. Set redirect URI to the MCP client's callback URL.
4. Copy the `client_id` (and secret if confidential).
5. Enable Dynamic Client Registration if MCP clients need to self-register.

### Adding an RLS policy that restricts OAuth client access

```sql
-- Allow the "agent-tools" client read-only access to tasks
CREATE POLICY "agent_tools_read_tasks" ON tasks
  FOR SELECT
  USING (
    auth.uid() = user_id
    AND (auth.jwt() ->> 'client_id') = 'agent-tools-client-id'
  );
```

### Revoking a user's OAuth grant

```ts
const supabase = await createClient();
await supabase.auth.oauth.revokeGrant('client-id-to-revoke');
```

This invalidates all refresh tokens for that client.

<!-- version: 1.0.0 -->
