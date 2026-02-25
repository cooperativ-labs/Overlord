# Engineering Plan: Web-Based OAuth Login Flow for Electron App and CLI

## Objective

Adopt a browser-initiated authentication flow for both the Electron app and the `ovld` CLI so users authenticate through the web app (Supabase Auth), including email-confirmation cases, and then securely bootstrap local app/CLI credentials without copying tokens manually.

## Current State (Repo-Specific)

- Web app auth is Supabase session-cookie based (`/login`, `/auth/callback`).
- CLI already uses a browser approval flow via device codes:
  - `POST /api/auth/device/request`
  - browser confirmation at `/auth/device`
  - `POST /api/auth/device/poll`
  - stores resulting `agent_tokens.token` in `~/.ovld/credentials.json`.
- Protocol APIs authenticate with `Authorization: Bearer <agent_token>` via `lib/overlord/protocol-auth.ts`.
- Electron currently has no first-class login bootstrap for agent tokens; it can pass a token to launcher IPC, but acquisition/refresh UX is not defined.

## Problem

- Browser-based auth exists for CLI, but only as a custom device flow and not explicitly framed as a unified OAuth-style flow for all local clients.
- Electron lacks a deterministic sign-in handshake for acquiring and rotating local API credentials.
- Token lifecycle is coarse (`agent_tokens` are long-lived and unnamed beyond "CLI Token"), with no scopes, expiry, or revocation UX.

## Target Architecture

Implement a single "Local Client Authorization" model based on web-initiated authorization and short-lived authorization transactions:

1. User initiates "Sign in to local client" in Electron or CLI.
2. Local client opens browser to Overlord authorization endpoint with one-time request metadata.
3. User authenticates in web app (Supabase handles email confirmation/redirect).
4. Web app issues client credential material for that request.
5. Local client receives credential via:
   - polling exchange (CLI and fallback)
   - loopback redirect callback (Electron preferred UX, optional phase)
6. Client stores credential locally and uses it for protocol APIs.

## Credential Model Changes

### 1) Split auth transaction from API token

- Keep `agent_tokens` for bearer auth to protocol endpoints.
- Replace/extend `device_auth_codes` into a generic `auth_grants` table:
  - `grant_code` (one-time)
  - `user_code` (optional, for manual flow)
  - `client_type` (`cli` | `electron`)
  - `client_name`
  - `requested_scopes` (array/text)
  - `expires_at`, `approved_at`, `consumed_at`
  - `agent_token_id` (nullable FK)
- Keep `device_auth_codes` compatible during migration; deprecate after cutover.

### 2) Harden `agent_tokens`

- Add `expires_at` (optional in v1 migration; enforced later).
- Add `revoked_at`, `last_used_at` (already present), `created_by_grant_id`.
- Add `name` conventions (`CLI <hostname>`, `Desktop <machine>`).
- Add eventual `scope` column for future endpoint scoping.

## API and UX Plan

### Phase 1: Unify current CLI flow under "authorization grant"

- Introduce new routes (or version existing):
  - `POST /api/auth/grants/request`
  - `POST /api/auth/grants/poll`
  - `POST /api/auth/grants/approve` (server action-backed)
- Keep `/auth/device` page but back it by the new grant table.
- Preserve CLI compatibility by aliasing old endpoints until CLI is upgraded.

### Phase 2: Electron browser login bootstrap

- Add Electron IPC methods:
  - `auth:startLogin` (creates grant, opens browser)
  - `auth:pollLogin` (for grant completion)
  - `auth:getStatus`
  - `auth:logout`
- Store token in Electron secure storage (keytar preferred; encrypted file fallback only if unavailable).
- Add lightweight renderer auth UI:
  - "Sign in" button
  - pending/approved/error states
  - "Re-authenticate" and "Sign out"

### Phase 3: Optional loopback callback for Electron

- Run ephemeral localhost callback listener in Electron main process.
- Launch browser with `redirect_uri=http://127.0.0.1:<port>/callback`.
- On callback, exchange short code for `agent_token` via secure API route.
- Keep polling fallback for locked-down environments.

### Phase 4: Token lifecycle and management UI

- Add account settings page for active local sessions/tokens:
  - list device tokens
  - revoke one/all
  - show last used
- Enforce token expiry and refresh/re-auth behavior in CLI/Electron.

## Security Requirements

- One-time grant consumption (`consumed_at`) to prevent replay.
- Short grant TTL (10-15 min).
- Rate-limit grant request and poll endpoints.
- Strict validation of redirect targets (`localhost` only for native callback mode).
- No token in URL fragments/query after completion; exchange code server-side and return token only over authenticated/polled channel.
- Audit events:
  - grant requested
  - approved
  - token issued
  - token revoked

## Migration and Compatibility

- Keep current CLI `ovld auth login` behavior working during rollout.
- Ship CLI update to prefer new `/api/auth/grants/*` endpoints.
- Keep legacy `/api/auth/device/*` wrappers for at least one release window.
- Add backfill migration for existing tokens:
  - mark as `created_by_grant_id = null`
  - optionally assign soft expiry far in future.

## Implementation Work Breakdown

1. Data layer
   - Create `auth_grants` table and indexes.
   - Extend `agent_tokens` columns (`revoked_at`, optional `expires_at`, `created_by_grant_id`).
2. Server routes and actions
   - Implement grant request/poll/approve.
   - Add token validation checks for revoked/expired in `resolveAgentToken`.
3. CLI integration
   - Point login command to new grant endpoints.
   - Improve credential file metadata (`created_at`, `token_name`, `expires_at`).
4. Electron integration
   - Add auth IPC surface and secure token storage.
   - Add auth status UI and launch gating (require auth before launching agents).
5. Management and observability
   - Build token/session management UI.
   - Add structured logs and audit events.

## Testing Plan

- Unit tests
  - grant state transitions (pending -> approved -> consumed)
  - token validation (active/revoked/expired)
- API integration tests
  - request + poll + approve happy path
  - expired grant and replay attempt rejection
- End-to-end manual checks
  - unconfirmed email user: confirm via email, return, approve, CLI succeeds
  - Electron sign-in from fresh install
  - token revocation causes immediate API 401 on next call
- Regression checks
  - existing `ovld protocol *` commands still work with stored credentials.

## Rollout Plan

1. Deploy schema and new routes behind feature flag `LOCAL_AUTH_GRANTS_V1`.
2. Update CLI to dual-read old/new endpoints.
3. Ship Electron auth bootstrap UI and enforce authenticated launch.
4. Enable token management UI and revoke controls.
5. Remove legacy `device_auth_codes` once adoption and telemetry are stable.

## Risks and Mitigations

- Risk: token leakage on local machine.
  - Mitigation: keychain/keytar storage, minimal token scope, revoke UI.
- Risk: login dead-ends during email confirmation redirect.
  - Mitigation: preserve `next` parameter through `/login` and `/auth/callback` back to grant approval screen.
- Risk: breaking existing scripts that depend on current device endpoints.
  - Mitigation: compatibility wrappers and staged deprecation.

## Acceptance Criteria

- CLI and Electron both authenticate via browser-mediated flow without manual token copy/paste.
- Users with email-confirmation flows can complete auth and return to local client successfully.
- Issued local client tokens are auditable, revocable, and rejected when revoked/expired.
- Existing protocol command flows continue to work after migration.
