# Desktop logout state — diagnosis & mitigations

Ticket: 1:1389 — "Fix logout state bugs and improve user experience"

## Symptoms

1. **Silent expiry.** When a desktop token expires, the app keeps looking
   normal but no changes save.
2. **Partial-login / stuck state.** Refreshing can leave the Kanban board
   visible while the app sidebar and nav bar disappear. Logout is impossible,
   and restarting the app does not reset the login state.

## How desktop auth works (context)

- The Electron **main process** owns the OAuth refresh + access tokens and
  persists them to disk (`session-store` → `electron-credentials`).
- A **refresh controller** hands out a valid access token, refreshing when it
  is within 5 min of expiry.
- A **header injector** (`onBeforeSendHeaders`) injects a fresh
  `Authorization: Bearer …` plus `X-Overlord-Client: desktop` on every renderer
  → platform/Supabase request.
- The renderer's Supabase client has no session of its own; it calls
  `auth:getAccessToken` per request.
- **Middleware** (`supabase/utils/proxy.ts`) verifies the bearer **locally**
  (JWKS signature + `exp`) and forwards it to server components.
- **Server components / actions** call `supabase.auth.getUser()`, which
  validates against the **Supabase Auth server** (this also catches revocation).

## Root causes

### Issue 1 — silent expiry
When the **refresh token itself is dead** (expired or revoked), every
`getValidAccessToken()` throws. The header injector **swallows** that error and
sends requests with no `Authorization`. On-screen reads survive (server-rendered
HTML + React Query cache), so the UI looks logged in. Writes (server actions,
`/api/*`, `_rsc`) get a `401 Bearer error="expired_token"`; the per-call retry
helpers try `forceRefresh()`, which also fails, and the error is then swallowed
per call. **Nothing turns a terminal auth failure into user-visible feedback or
a logged-out transition**, so the user never learns their writes are lost.

### Issue 2 — partial login / unrecoverable state
Several compounding defects:

1. **Dead sessions were never cleared.** The refresh controller threw but the
   persisted session stayed on disk. Only an explicit `auth:logout` cleared it →
   "restarting the app does not reset the login state."
2. **`auth:getStatus` reported `isAuthenticated: session !== null`** — true even
   when the refresh token was dead. The non-blocking `ElectronAuthGate` relied
   solely on this and never redirected a stuck session.
3. **Local-verify vs server-verify mismatch.** Middleware can pass a token that
   is locally valid (signature + `exp`) but that the `(app)/layout`'s
   `getUser()` rejects (revoked grant, or a request racing the 5-min margin).
   The layout then took its `user ? … : …` else branch and rendered a
   **chrome-less `<main>{children}</main>`**: the Kanban page still rendered, but
   `NavHeader` and `AppSidebar` (both gated on `user`) vanished.
4. **Logout lived only in the chrome.** `handleLogout` is in `nav-user.tsx`
   inside `AppSidebar`. With the chrome gone, there was no way to log out.

## Mitigations (implemented)

1. **Classify refresh failures (terminal vs transient).**
   `oauth-tokens.ts` now throws a typed `OAuthRefreshError` with a `terminal`
   flag — `true` for `invalid_grant`/401/403 (dead refresh token), `false` for
   network/5xx so we never sign users out over a flaky connection.

2. **Clear dead sessions and announce them.** `ipc/auth.ts` detects terminal
   failures in its central `refreshSession` path; it clears the persisted
   session once and broadcasts `auth:session-expired` to every renderer (guarded
   so queued requests don't spam; re-armed on a successful refresh or new login).
   This makes `getStatus()` honest going forward and resets state across
   restarts.

3. **Renderer reacts to expiry.** `ElectronSessionWatcher` listens for
   `auth:session-expired`, clears the React Query cache, shows a clear toast
   ("Your session has expired. Please sign in again."), and routes to
   `/electron-login`. Because the `on_401` `forceRefresh()` path now triggers the
   broadcast on a terminal failure, this also surfaces Issue 1's silently-failing
   writes.

4. **Never render a half-app.** `(app)/layout.tsx` now renders
   `ElectronSessionEndedScreen` (a clear message + "Sign in again", auto-routing
   to `/electron-login`) whenever a desktop request reaches the layout without a
   `user`, instead of the chrome-less board. This closes the residual
   revoked-but-locally-valid window where no refresh (and thus no broadcast)
   occurs.

## Files changed

- `apps/desktop/electron/services/oauth-tokens.ts` — `OAuthRefreshError` +
  terminal classification.
- `apps/desktop/electron/ipc/auth.ts` — terminal detection, clear + broadcast,
  guard/re-arm.
- `apps/desktop/electron/main.ts` — wire `onSessionExpired` → broadcast to all
  windows.
- `apps/desktop/electron/preload.ts` + `types/electron.d.ts` —
  `auth.onSessionExpired` subscription.
- `apps/web/components/features/electron-auth/ElectronSessionWatcher.tsx` — new.
- `apps/web/components/features/electron-auth/ElectronSessionEndedScreen.tsx` —
  new.
- `apps/web/app/(app)/layout.tsx` — mount watcher; render session-ended screen
  for unauthenticated desktop requests.
- `tests/apps/desktop/electron/services/oauth-tokens.test.ts` — new coverage for
  terminal classification.

## Follow-ups (not in this change)

- Consider validating token freshness inside `auth:getStatus` directly, so the
  blocking `ElectronAuthBoundary` short-circuits even faster.
- Consider a proactive background refresh timer so access tokens are renewed
  before expiry rather than lazily on first failing request.
