# Overlord authorization

Part of the Overlord contract. [CONTRACT.md](CONTRACT.md) defines its scope, precedence and change protocol.

## Component Registry

### 7. Auth Layer

**Stable identifier**: `auth`
**Reference spec**: this document; design background (non-normative): [`auth/docs/07-user-token-authentication.md`](../auth/docs/07-user-token-authentication.md), [`auth/docs/08-role-based-access-control.md`](../auth/docs/08-role-based-access-control.md)

Owns:

- Token creation, rotation, revocation, tombstoning of revoked credentials, and hash storage
- Role assignment CRUD
- Permission check interface
- Audit log attribution fields
- Better Auth implementation tables (`user`, `session`, `account`, `verification`, `apikey`) — these are auth-internal and must not be read directly by other components
- Self-service account deletion trigger (`user.deleteUser`), delegating the cascade to a backend-supplied callback
- Account-connection ownership and credential envelopes: AES-256-GCM envelopes whose additional authenticated data binds the owner profile, organization, provider, and connection id, with the key and key id from server configuration; PKCE verifiers and OAuth `state` are stored encrypted and hashed respectively. Chat routes authorize by owner identity plus live workspace/project RBAC for every referenced project; no new role permission is added
- Account-connection key ring and credential formats: current key `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY` plus reserved per-provider fallback ids `everhour-env` and `github-user-env` over the existing environment keys; `credential_format` `connection-v1`, `everhour-user-key-v1`, `github-user-oauth-v1`; legacy envelopes adopted verbatim and re-sealed lazily under the current key; a missing fallback key answers `unavailable` without erasing. The key ring also holds a platform key derived with HKDF-SHA256 from the deployment-provisioned `BETTER_AUTH_SECRET` (at least 32 characters) under a label used only for account connections; its id `platform-<16 hex>` is a one-way fingerprint of the derived key and changes whenever the secret changes, and `platform-*` ids are reserved (`ACCOUNT_CONNECTIONS_ENCRYPTION_KEY_ID` cannot take one and falls back to `k1`, like the other reserved ids). New credentials are sealed, for Knowledgebase, under the explicit current key else the platform key; for a profile-scoped provider, under the explicit current key, else its fallback key, else the platform key. A row whose key id is absent from the ring is `unavailable` (503 from use, envelope kept, restoring the variable restores access) when it is a fallback-key or legacy-format row, an explicit-key row while no explicit key is configured, or a platform row while no platform key is derived; it becomes `reauthorization_required` with `credential_unreadable` and its credential is erased when it is an explicit-key row under a replaced key, or a platform row while a different platform key is derived (the secret was rotated). An authentication failure with the key present has the same outcome as a rotated key. After every successful read of a row in a legacy format or under a non-current key the module re-seals it under the write key (`connection-v1`), guarded by key id and credential revision; a re-seal changes neither the token nor, for a Knowledgebase ring re-seal, the credential revision. A bounded re-seal sweep runs at backend start when a current key is configured and logs counts only. The platform key, the secret and every credential stay inside the backend; DTOs, logs, realtime, URLs and agent processes never see them
- Personal GitHub repository authorization (profile-scoped OAuth, run by the account-connections module with a confidential client): a distinct, explicit grant requesting exactly `repo read:org` with `allow_signup=false`, separate from Better Auth GitHub sign-in through the same `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` registration; profile-bound, hashed, single-use `state` with a 10-minute expiry in `account_connection_authorizations` (at most five open per connection), bound to its provider so a state issued for one provider is never consumed by another provider's callback; a PKCE S256 challenge always sent, with the verifier sealed under the provider's write key. The callback stays `GET /api/auth/callback/github/repository`, mounted before the Better Auth `/api/auth/*` wildcard. A grant without both `repo` and `read:org` stores nothing and finishes `failed` with `insufficient_scope`; a GitHub account already live on another profile finishes `failed` with `account_in_use`. Use refreshes an expiring token under the module's refresh lease and persists the rotated credential before use; a refresh rejected with `bad_refresh_token` (or a missing refresh token) marks the connection `reauthorization_required`; an upstream 401 is retried once after a forced refresh and a second 401 marks it `reauthorization_required` (`invalid_grant`); a `/user` identity that no longer matches the stored account marks it `reauthorization_required` (`identity_changed`). `lastErrorCode` additionally admits `insufficient_scope`, `account_in_use`, `identity_changed` and `account_lookup_failed`. Disconnect erases the credential first, then revokes the token upstream (best-effort), then tombstones the legacy row
- Legacy personal-credential adoption: a profile with no Everhour (or GitHub) row in any state lazily adopts a live legacy `ext_everhour_user_connections` (or `ext_github_user_connections`) row written by an older instance; a row still in a legacy format is honoured only while its legacy source row is live; a disconnect in the module tombstones the legacy row (`deleted_at`, ciphertext `revoked:v1`), so neither a rollback nor a re-run can resurrect a credential the user removed. Workspace-key adoption stores the adopted key through the module and scrubs the workspace row's plaintext. The legacy GitHub routes no longer write `ext_github_user_connections` or `ext_github_user_oauth_states`
- Sign-up/sign-in email verification: an optional `sendVerificationEmail` callback (`CreateAuthOptions.sendVerificationEmail`) delegates delivery to a backend-supplied sender, mirroring the `onDeleteUser` delegation pattern. When provided, Better Auth also enables `emailAndPassword.requireEmailVerification` so unverified accounts cannot sign in. When omitted (the default, e.g. Local/offline editions with no configured email provider), verification stays fully disabled and behavior is unchanged. The backend's concrete sender (`backend/email-verification.ts`) uses Resend, configured via the `RESEND_API_KEY` env var and the `notifications.cooperativ.io` sending domain
- Numeric one-time codes (OTP): an optional `sendEmailOTP` callback (`CreateAuthOptions.sendEmailOTP`) enables Better Auth's `emailOTP` plugin (6-digit codes, 1-hour expiry), the same caller-supplied-callback pattern as `sendVerificationEmail`. When enabled, the sign-up verification email carries **both** the existing magic link **and** a real 6-digit code minted via `auth.api.createVerificationOTP` and passed to `sendVerificationEmail` as `otp` — replacing the previous behavior of showing the raw (untypable) verification link token in the code block. The plugin also exposes `/api/auth/email-otp/*` server endpoints (notably `verify-email`, `check-verification-otp`, `send-verification-otp`, `sign-in/email-otp`, `forget-password`/`reset-password`) and the corresponding `authClient.emailOtp.*` client methods for typed-code sign-in and password reset. When `sendEmailOTP` is omitted, the plugin is left off and no OTP endpoints exist. The backend sender is `emailOTPSenderFromEnv()` in `backend/email-verification.ts` (Resend-backed)
- Hosted MCP OAuth consent and token issuance: OAuth approval creates a scoped `USER_TOKEN` with the `mission_lifecycle` preset after an authenticated browser session approves the request. Authorization codes are short-lived, single-use, PKCE-protected, and exchanged for bearer access tokens; refresh tokens are not issued (the token endpoint supports only the `authorization_code` grant). A code that expires unexchanged, or whose exchange fails its client/PKCE/resource checks, revokes the `USER_TOKEN` it would have delivered, so no orphaned active token outlives its authorization code.

Does NOT own:

- User identity schema (co-owned with Database Layer via schema contract)
- Application business logic gating (callers act on the result of a permission check)

### User tokens

- **Ownership.** A `USER_TOKEN` is owned by the creating user account, visible and
  manageable only by that user, and usable across any workspace where that user has
  active membership; listing is independent of the currently active workspace.
  Workspace authorization remains per-workspace through RBAC. Consent narrows, it never
  grants: a token the user mints for themselves (CLI login, settings) consents to every
  current and future workspace in that user's organization and asks for no selection; a
  third-party OAuth client's token carries whatever the approval screen selected. Either
  way, effective access is that consent intersected with live membership and
  per-workspace RBAC.
- **Secrets.** Secrets are high-entropy with the recognizable `out_` prefix. Only a hash
  and a non-secret lookup prefix are stored. The raw secret is shown exactly once, at
  creation; token lifecycle operations never return it otherwise, and tokens minted
  internally by cloud `ovld auth login` are stored directly as CLI credentials and are not
  printed. Raw tokens are never logged, and `out_…`-shaped values are redacted from CLI
  diagnostics. List output never reveals raw secrets.
- **Lifecycle.** Creation takes a user-supplied label and defaults `expires_at` to 90 days
  from creation when no expiry is supplied (`DEFAULT_USER_TOKEN_TTL_DAYS`); callers may pass
  an explicit expiry, or an explicit `null` to mint a non-expiring token. Revoked tokens
  fail authentication immediately. A label can be changed without changing the secret. A
  successful authentication updates the last-used timestamp.
- **Authentication.** Token authentication resolves to a user identity before permission
  checks and must not derive authorization scope from the token's issuance workspace.
  Revocation and expiry are checked before scope evaluation.
- **Scopes.** A token is created with a `scope` preset. `full` persists no scope rows and
  inherits the full permissions of its creating user's roles. `mission_lifecycle` and
  `project_automation` persist the grant patterns of `MISSION_LIFECYCLE_GRANTS` and
  `PROJECT_AUTOMATION_GRANTS` (`auth/src/rbac/permissions.ts`) into `user_token_scopes`;
  neither includes `user_token:self:*`, so a scoped token cannot mint further tokens.
  Effective permissions are the owner's role grants in the requested workspace
  **intersected with** the token's scope grants. Absence of scope rows means "no
  token-level restriction". Scopes can only restrict, never exceed, the user's current
  role: if the user's role is reduced in a workspace, the token becomes less powerful
  there automatically. The `requirePermission` gate enforces this uniformly across REST,
  protocol, and runner routes.
- **`project_automation`.** It is minted with a required, non-empty `projectIds` list
  (rejected for the other presets), persists the selected projects in
  `user_token_projects`, and its selection is immutable: a different selection is a new
  token. Issuance validates that the owner can `project:read` and `mission:create` in every
  selected project and derives workspace consent from the selection:
  `user_token_workspaces` receives exactly the owning workspaces and `all_workspaces` stays
  `false`. At authentication the selected project ids join the request authorization
  snapshot. Two default-deny layers then apply. First, the `/api`, `/ext`, `/sync`, and
  `/realtime` guards admit only this route allowlist; every other route returns `404`
  before a handler runs: `GET /api/authorized-workspaces`, `GET /api/projects`,
  `GET /api/projects/:id`, `GET /api/projects/:id/statuses`,
  `GET /api/projects/:id/tags`, `GET /api/projects/:id/missions`, `POST /api/missions`,
  `GET /api/missions/:id`, `GET /api/missions/:id/objectives`,
  `GET /api/missions/:id/events`, `GET /api/missions/:id/deliveries`,
  `GET /api/missions/:id/artifacts`, `GET /api/missions/:id/context`,
  `GET /api/missions/:id/file-changes`, `GET /api/search/v3`,
  `GET /api/objectives/:id/attachments`, `GET /api/storage/attachments/:storageKey` (the
  attachments bucket only), `GET /api/stream`, `GET /realtime`, `GET /sync/changes`,
  `GET /mcp`, `POST /mcp`, and `POST /api/protocol/:subcommand` for exactly `create`
  (project form only), `load-context`, `search`,
  `discover-project` (`--project-id` form only; the working-directory form and the
  `project_selection_required` choice list would name hidden projects), `statuses`,
  `list-deliveries`, `objective-changes`, `attachment-list`, `attachment-download-url`, and
  `auth-status`. `GET /api/meta`, legacy `GET /api/missions/search` and
  `GET /api/missions/search/v2`, the `/api/agent-requests` and `/api/agent-session-inputs`
  readers, protocol `read-context`, and every `/ext/*` route are deliberately outside the
  list even where a grant would pass; they may be added later only with the project
  predicate in place. No route on the list is widened for any other caller. `GET /api/missions/:id` does not record
  `mission_status_seen` for this preset. Second, one project-scope predicate makes any
  project, mission, objective, attachment storage key, or agent request outside the
  selection read as `404` without revealing existence, for UUID and display-id addressing
  alike, while account-wide lists, search, `/sync/changes`, and SSE filter by the
  selection before pagination and totals; no `project_id IS NULL` change row reaches the
  preset. Protocol `create` requires `mission:create` in its target project for every
  caller; `prompt`, `record-work`, `add-objectives`, inbox capture, and all session,
  launch, queue, token, webhook, and administration commands are denied for this preset
  before any write.
- **No route is exempt.** The bounds above apply to every route a token reaches,
  including those whose role requirement is derived rather than a single grant. Workspace
  management (rename, delete, members, roles, invitations, objective export) needs the
  target workspace in the token's consent (404 otherwise) and the operation's permission
  in its scope (403); organization administration and organization image upload need the
  token bound to that organization (404) and consenting to every live workspace of it
  (403); workspace creation needs the token's own organization and `ADMIN` in a consented
  workspace. Workspace, organization and notification lists narrow to the token's
  organization and consented workspaces, as `GET /api/authorized-workspaces` does. A token
  accepts a workspace invitation only when its scope is unrestricted, it is bound to the
  invited workspace's organization and it consents to every workspace of it. A route that
  changes stored state requires the write action, not only read access. Sessions keep the
  membership-derived checks; the loopback local operator alone may fall back to the oldest
  active human profile, and an authenticated caller whose profile is missing or deleted is
  refused rather than given another identity.
- **Creator-token attribution.** Every mission a direct `out_` bearer creates is stamped
  with `missions.created_by_token_id` (a soft reference, no foreign key) and
  `missions.created_by_token_label` (a label snapshot), exposed read-only as
  `MissionDto.createdByToken`. Rename changes only future snapshots; revoke and
  soft-delete leave attribution readable; scheduled duplicates never copy it.

### Role-based access control

- **Permissions are domain capabilities.** Permission names are domain-oriented strings
  such as `mission:create` or `execution_request:claim`, never database table names
  unless the table also represents a stable domain resource. Grants support wildcard
  expansion (`mission:*`, `*`) and self-scoped permissions such as `user_token:self:*`.
  Business logic calls the authorization service for a capability; it does not check for
  specific role names. Token scopes reuse the same canonical permission names.
- **Default roles.** The default policy provider is backed by `overlord.rbac.toml`, which
  defines the role grants and permission groups. `ADMIN` grants `*`. `PUBLIC` is the
  unauthenticated read role for intentionally public resources (public workspace,
  organization and user images).
- **Last administrator.** A workspace's last `ADMIN` cannot be removed or demoted, and an
  organization's last admin cannot be removed.

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
