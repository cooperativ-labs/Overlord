# Auth Changelog - 2026-04-25

## Scope

This changelog captures the authentication and session-management changes across Electron Desktop, Web, Supabase request utilities, OAuth flows, and CLI credential handling.

## Added

### Electron bearer-auth infrastructure

- Added request header injection in Electron main process so requests to platform and Supabase origins carry a fresh `Authorization: Bearer <token>` access token.
- Added desktop client identity header support (`X-Overlord-Client: desktop`) for server-side request classification.
- Added a centralized in-memory + persisted Electron session store (`session-store`) for platform URL, refresh token, access token, and token expiry metadata.
- Added a refresh controller (`refresh-controller`) with:
  - token freshness checks and expiry margin handling,
  - single-flight refresh de-duplication,
  - force refresh support for 401 recovery paths.
- Added OAuth token utilities (`oauth-tokens`) for config fetch, refresh grant exchange, and JWT-expiry fallback parsing.
- Added response header/CSP wiring in Electron (`installRendererResponseHeaders`) and auth-cookie stripping for platform-origin responses.

### Server-side Electron token verification

- Added Electron request detection helpers (`lib/auth/electron-detect.ts`) based on injected header with UA fallback.
- Added JWT verification for Electron bearer tokens (`lib/auth/electron-jwt.ts`) using Supabase JWKS and issuer/audience checks.
- Added client binding enforcement for Electron tokens via `client_id` claim validation against runtime OAuth config.
- Added normalized Electron auth/user resolution helpers (`lib/auth/get-electron-user.ts`) with explicit error codes:
  - `missing_token`
  - `invalid_token`
  - `expired_token`
  - `invalid_client`
  - `missing_client_id`

### Web retry/recovery primitives for Electron

- Added client-side action retry wrapper (`lib/electron-auth/action-retry.ts`) that force-refreshes Electron tokens and retries failed server actions on auth-related failures.
- Added fetch retry wrapper (`lib/electron-auth/fetch-retry.ts`) that retries once after bearer 401 responses when refresh succeeds.
- Added route refresh helper (`lib/electron-auth/route-refresh.ts`) that refreshes Electron auth state before router refresh.

## Changed

### Electron login and IPC contract

- Refactored Electron auth IPC to operate around access-token retrieval/rotation APIs instead of exposing refresh-token-oriented browser session flows.
- Updated preload + Electron type contracts to replace older methods (`saveRefreshToken`, `checkOAuthSession`, `refreshOAuthSession`, etc.) with:
  - `getAccessToken`
  - `forceRefresh`
  - `refreshSession` (access-token focused response shape)
- Updated Electron login screen behavior to validate desktop auth via `getStatus` + `getAccessToken` and removed Supabase browser-session bootstrapping calls from login/logout paths.
- Simplified `ElectronAuthGate` to an auth-status gate when bearer-auth is enabled, removing cookie/session orchestration logic that previously depended on browser-managed Supabase session state.

### Supabase client creation by request type

- Added `createClientForRequest()` path in `supabase/utils/server.ts` that:
  - builds bearer-token server clients for Electron requests,
  - falls back to cookie-based clients for browser sessions.
- Migrated auth-sensitive routes/actions/pages to `createClientForRequest()` (device auth, OAuth consent, auth callback, Slack OAuth callback, auth actions).
- Updated browser Supabase client to support bearer-auth mode in Electron via `accessToken` callback (`supabase/utils/client.ts`) and disabled cookie/session dependence in that mode.

### Middleware/proxy auth flow

- Reworked `supabase/utils/proxy.ts` middleware behavior for Electron requests:
  - resolves/validates bearer token up front,
  - injects normalized auth context headers into downstream request handling,
  - returns bearer 401 with `WWW-Authenticate` for machine/API contexts,
  - preserves redirect-to-login behavior for browser-style navigation contexts.
- Introduced explicit machine endpoint handling for protocol/health/API paths so auth behavior matches machine-client expectations.
- Reduced stale-cookie-driven redirect noise by moving Electron auth decisions away from cookie-session freshness checks.

### OAuth runtime config

- Added dedicated `deviceClientId` support in OAuth runtime config and included it in allowed client IDs.
- Updated device authorization flow to use `deviceClientId` instead of CLI client ID.

### Public route behavior

- Expanded public route coverage to include `/api/health`.

## Fixed

### Electron token lifecycle and reliability

- Fixed repeated session-expiry issues caused by coupling Electron auth to browser cookie session refresh behavior.
- Fixed auth refresh races by introducing single-flight refresh handling in the desktop refresh controller.
- Fixed auth failures after wake/resume and near-expiry windows by centralizing token freshness evaluation and force-refresh paths.
- Fixed mismatches between renderer and main-process auth assumptions by moving to a unified access-token retrieval contract.

### OAuth callback and route auth consistency

- Fixed inconsistent client-ID usage in device OAuth callback/exchange paths.
- Fixed server action and route auth consistency by standardizing request-scoped Supabase client construction.

## Security

- Hardened Electron auth by validating incoming bearer JWTs against Supabase JWKS and enforcing expected issuer/audience.
- Enforced Electron OAuth client isolation by validating the JWT `client_id` claim against configured Electron client ID.
- Reduced token exposure surface by:
  - removing renderer-facing refresh-token persistence APIs from preload contracts,
  - returning access-token-centric responses only where possible.
- Added explicit bearer challenge responses (`WWW-Authenticate`) for invalid/expired tokens in machine-facing request contexts.
- Added Sentry breadcrumbs for refresh attempts/success/failure and bearer-token validation outcomes to improve security incident observability.

## Migration and compatibility notes

- Desktop credentials moved toward dedicated desktop storage (`credentials.desktop.json`) with best-effort migration from legacy credential files.
- CLI credentials moved to `credentials.cli.json` with one-time legacy migration markers.
- Legacy credential files are still read for migration compatibility but are no longer the primary write targets.
- Feature-flagged rollout path remains available through `OVLD_ELECTRON_BEARER_AUTH` / `NEXT_PUBLIC_OVLD_ELECTRON_BEARER_AUTH`.

## Removed

- Removed `lib/electron-auth/ensure-session.ts` and the mutation-cache-driven "ensure fresh session before mutate" approach that depended on browser-managed Supabase cookie sessions.

## Test coverage updates

- Added/updated tests for:
  - Electron header injection behavior,
  - refresh-controller token lifecycle behavior,
  - Electron JWT verification and auth error handling,
  - Electron retry wrappers (`action-retry`, `fetch-retry`),
  - Supabase client/server/proxy auth utility behavior,
  - CLI credential migration and source resolution behavior.

## Operational impact summary

- Electron auth is now bearer-token first, main-process controlled, and less dependent on browser cookie/session mechanics.
- Web and middleware auth paths now support both browser-cookie sessions and Electron bearer sessions via request-aware client creation.
- Credential storage for desktop and CLI is now separated, improving isolation and reducing cross-surface token coupling.
