# Overlord authorization

Part of the Overlord contract. [CONTRACT.md](CONTRACT.md) defines its scope, precedence and change protocol.

## Component Registry

### 7. Auth Layer

**Stable identifier**: `auth`
**Reference specs**: [`auth/docs/07-user-token-authentication.md`](../auth/docs/07-user-token-authentication.md), [`auth/docs/08-role-based-access-control.md`](../auth/docs/08-role-based-access-control.md)

Owns:

- Token creation, rotation, revocation, tombstoning of revoked credentials, and hash storage
- Role assignment CRUD
- Permission check interface
- Audit log attribution fields
- Better Auth implementation tables (`user`, `session`, `account`, `verification`, `apikey`) — these are auth-internal and must not be read directly by other components
- Self-service account deletion trigger (`user.deleteUser`), delegating the cascade to a backend-supplied callback
- Account-connection ownership and credential envelopes: AES-256-GCM envelopes whose additional authenticated data binds the owner profile, organization, provider, and connection id, with the key and key id from server configuration; PKCE verifiers and OAuth `state` are stored encrypted and hashed respectively. Chat routes authorize by owner identity plus live workspace/project RBAC for every referenced project; no new role permission is added
- Account-connection key ring and credential formats: current key `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY` plus reserved per-provider fallback ids `everhour-env` and `github-user-env` over the existing environment keys; `credential_format` `connection-v1`, `everhour-user-key-v1`, `github-user-oauth-v1`; legacy envelopes adopted verbatim and re-sealed lazily under the current key; a missing fallback key answers `unavailable` without erasing
- Sign-up/sign-in email verification: an optional `sendVerificationEmail` callback (`CreateAuthOptions.sendVerificationEmail`) delegates delivery to a backend-supplied sender, mirroring the `onDeleteUser` delegation pattern. When provided, Better Auth also enables `emailAndPassword.requireEmailVerification` so unverified accounts cannot sign in. When omitted (the default, e.g. Local/offline editions with no configured email provider), verification stays fully disabled and behavior is unchanged. The backend's concrete sender (`backend/email-verification.ts`) uses Resend, configured via the `RESEND_API_KEY` env var and the `notifications.cooperativ.io` sending domain
- Numeric one-time codes (OTP): an optional `sendEmailOTP` callback (`CreateAuthOptions.sendEmailOTP`) enables Better Auth's `emailOTP` plugin (6-digit codes, 1-hour expiry), the same caller-supplied-callback pattern as `sendVerificationEmail`. When enabled, the sign-up verification email carries **both** the existing magic link **and** a real 6-digit code minted via `auth.api.createVerificationOTP` and passed to `sendVerificationEmail` as `otp` — replacing the previous behavior of showing the raw (untypable) verification link token in the code block. The plugin also exposes `/api/auth/email-otp/*` server endpoints (notably `verify-email`, `check-verification-otp`, `send-verification-otp`, `sign-in/email-otp`, `forget-password`/`reset-password`) and the corresponding `authClient.emailOtp.*` client methods for typed-code sign-in and password reset. When `sendEmailOTP` is omitted, the plugin is left off and no OTP endpoints exist. The backend sender is `emailOTPSenderFromEnv()` in `backend/email-verification.ts` (Resend-backed)
- Hosted MCP OAuth consent and token issuance: OAuth approval creates a scoped `USER_TOKEN` with the `mission_lifecycle` preset after an authenticated browser session approves the request. Authorization codes are short-lived, single-use, PKCE-protected, and exchanged for bearer access tokens; refresh tokens are not issued (the token endpoint supports only the `authorization_code` grant). A code that expires unexchanged, or whose exchange fails its client/PKCE/resource checks, revokes the `USER_TOKEN` it would have delivered, so no orphaned active token outlives its authorization code.

Does NOT own:

- User identity schema (co-owned with Database Layer via schema contract)
- Application business logic gating (callers act on the result of a permission check)

### Native GitHub sign-in recovery

Native clients start `GET /api/auth/desktop/github`, receive a browser-owned
GitHub authorization redirect, and finish at `GET /api/auth/desktop/callback`.
Success returns `overlord://auth/callback?ticket=...`; the opaque, single-use
60-second ticket is exchanged at `POST /api/auth/desktop/exchange` for a bearer
session. Failures return the same native callback with `error=access_denied`,
`state_mismatch`, or `sign_in_failed`, without a ticket. Clients validate the
callback scheme, host and path and display bounded, local error text.

The REST adapter may share the initial validated GitHub callback response for
up to 60 seconds with an identical retry bearing both the original signed
Better Auth state cookie and a random HttpOnly native-flow cookie. Recovery is
bounded and process-local; it must not re-exchange a provider code, bypass state
validation, or return a response to a different browser or changed callback.
The native-flow cookie expires after ten minutes. Missing/expired recovery
requires a fresh sign-in. `/api/auth/error` returns native errors only for a
recognized native browser flow; other callers get a useful status page, never
an unconditional redirect to the backend root. These responses are not cached.
Recovery diagnostics log only hashed correlation identifiers and lifecycle events.

## Interaction Surfaces

### MCP Server → Auth (Hosted Agent Auth Surface)

- **Transport**: HTTP bearer credentials on `GET/POST /mcp`
- **Discovery**: `GET /.well-known/oauth-protected-resource` and
  `GET /.well-known/oauth-protected-resource/mcp` advertise the MCP resource URL
  and authorization-server metadata locations
- **Authorization server**: OAuth-aware clients use dynamic registration (`POST /oauth/register`), browser approval (`GET /oauth/authorize` redirecting to the web approval page), authorization-code + PKCE token exchange (`POST /oauth/token`), and token revocation (`POST /oauth/revoke`). The web app may serve same-domain `.well-known` metadata and proxy `/mcp` plus `/oauth/*` traffic to the backend when deployed separately from the backend.
- **OAuth resource binding**: when an OAuth client supplies the RFC 8707
  `resource` parameter, approval and token exchange bind it to the canonical
  hosted `/mcp` resource; a mismatched resource is an OAuth `invalid_target`
  error. This prevents an authorization code minted for Overlord from being
  replayed against a different resource.
- **Rule**: MCP handlers must resolve the caller through the Auth Layer before
  listing or invoking tools. A request that is missing or fails authentication
  returns an OAuth-compatible `WWW-Authenticate: Bearer` challenge.
- **Workspace binding**: MCP authenticates a profile/credential but does not select an ambient workspace. Project and mission resources derive their workspace; account-wide tools aggregate authorized memberships; writes require explicit project identity where no parent resource supplies scope.

### Auth → Database (Identity Bridge)

- **Transport**: Better Auth's configured database adapter for auth tables; direct service-layer/database adapter queries for identity bridging. The auth domain query helpers (`queryOne`/`queryAll`/`execute`) run against the async `DatabaseClient` (preferred) or, for tests/legacy callers, a raw `better-sqlite3` handle or a bare `PostgresQueryExecutor`; the webapp routes both editions through the `DatabaseClient`
- **Auth tables owned**: `user`, `session`, `account`, `verification`, `apikey` — auth-internal; no other component accesses them directly
- **Identity bridge**: Auth Layer reads `profiles` (via `profiles.id = Better Auth user.id`) to resolve an authenticated identity. It resolves `workspace_users` and role assignments only for an explicitly named workspace, a named resource's workspace, or each membership in an account-wide operation; it never reads a workspace header or cookie as request scope.
- **Role resolution**: Auth Layer reads `role_assignments` for the resource-derived or explicitly selected workspace user to build the authorization subject
- **Rule**: Auth Layer must not write to core domain tables (missions, projects, etc.) itself
- **Exception**: the `deleteUser` `beforeDelete` hook invokes a backend-supplied `onDeleteUser(userId)` callback (`backend/account-deletion.ts`, injected via `CreateAuthOptions`) to hard-purge the `ON DELETE RESTRICT` children of `profiles` and `workspace_users` — `workspace_users`, `user_tokens`, `user_images`, `role_assignments`, `workspace_user_execution_targets`, `project_user_preferences` — before the auth `user` row is hard-deleted, which in turn hard-cascades `session`, `account`, `profiles`, and `user_execution_target_preferences`. `RESTRICT` blocks on row existence regardless of `deleted_at`, so this must be a hard purge, not a tombstone; each purge still emits an `entity_changes` row. The write happens inside the caller-supplied callback, not in Auth Layer code, mirroring the Service → Automations delegation pattern (caller-supplied persistence callbacks)
- **Email delivery**: sign-up/sign-in verification emails are sent through a backend-supplied `sendVerificationEmail(params)` callback (`backend/email-verification.ts`, injected via `CreateAuthOptions`), the same caller-supplied-callback pattern as `onDeleteUser`. Auth Layer invokes the callback with Better Auth's `{ user, url, token }` plus a minted 6-digit `otp` (when the `emailOTP` plugin is enabled via `sendEmailOTP`); it does not know about or depend on the concrete provider (Resend, configured via `RESEND_API_KEY` and the `notifications.cooperativ.io` domain). The verification email shows the `otp` in its code block and uses `token` only to build the clickable link — the raw `token` is never displayed as a typed code
- **One-time codes (OTP)**: when `sendEmailOTP` is injected, the `emailOTP` plugin is registered and writes codes to the auth-internal `verification` table (identifier `email-verification-otp-<email>` etc.). It adds `/api/auth/email-otp/*` endpoints; the sign-up confirmation code is minted inside `sendVerificationEmail` (no separate email), while `sendEmailOTP` delivers standalone codes for passwordless sign-in and password reset. Codes are 6 digits and expire after 1 hour
