# Electron Auth Redesign — Engineering Plan

Date: 2026-04-25
Owner: Platform / Desktop
Status: Proposal — ready for review

## Goal

Eliminate the dual-session-owner architecture in Electron by making the
desktop main process the **only** session authority and having the
Next.js server trust an `Authorization: Bearer <access_token>` header
that the main process injects into protected platform webview requests.

End state — and the success criteria for this plan:

- **One refresh owner**: Electron main process. No browser auto-refresh,
  no `@supabase/ssr` cookie refresh in middleware for Electron requests,
  no renderer-owned refresh loop. The renderer may ask main for the current
  access token or for one forced refresh, but it never stores or rotates a
  refresh token.
- **One refresh endpoint**: `/auth/v1/oauth/token` with `client_id`.
- **One failure mode**: HTTP `401` with a structured
  `WWW-Authenticate: Bearer error="..."` header for HTTP/RSC/API requests,
  and a typed `ElectronAuthError` for imported Server Actions. Renderer
  wrappers catch it once, IPC-refresh through main, and retry once. No
  method-preserving redirects, no `POST /electron-login → 405`.
- **SSR/Server Actions still work**: server components, server actions,
  RSC, and middleware authenticate from the bearer for Electron and
  from cookies for the web. No `ensureFreshElectronSession` preflight,
  no `MutationCache.onMutate` scaffolding.
- **Direct browser Supabase calls still work**: realtime, storage, and
  browser-side Supabase data calls use an Electron-specific access-token
  provider backed by main-process IPC. They do not use persisted browser
  Supabase sessions or refresh tokens.

## Non-goals

- Replacing Supabase, Next.js, or Electron.
- Changing web-app auth (cookie SSR remains the source of truth there).
- Moving Electron to a SPA static build, Tauri, or a split native shell.
- Changing RLS schema. `auth.uid()` and `auth.jwt() ->> 'client_id'`
  continue to work because the server-side Supabase client we
  instantiate per request will have the bearer set on `global.headers`.

## Architectural Summary

| Concern                          | Today                                                                   | Target                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Session owners                   | 2 (main + cookies)                                                      | 1 durable owner (main); renderer can hold only short-lived access tokens                 |
| Refresh endpoints                | 2 (`/auth/v1/token` + `/auth/v1/oauth/token`)                           | 1 (`/auth/v1/oauth/token`)                                                              |
| Refresh triggers                 | Browser auto-refresh, SSR auto-refresh, IPC timer, focus, MutationCache | Main-process timer + on-demand refresh on `401`                                         |
| Server-side trust source         | Request cookies mirroring main                                          | Bearer JWT verified via JWKS                                                            |
| Browser Supabase trust source    | Browser cookie session                                                  | Main-backed access token provider / injected bearer, with no browser refresh ownership  |
| Server action failure mode       | 303 redirect or 405                                                     | Explicit typed auth error + one forced main-process refresh + one action retry           |
| Stale-cookie class of bug        | Fundamental                                                             | Impossible for Electron protected paths (cookies ignored and eventually stripped)        |
| CLI sharing                      | Shared file with rotation races                                         | Separate OAuth client; independent refresh tokens; coordinated single-flight            |

The two modes (web vs Electron) diverge at the auth boundary only:

- middleware and server clients choose bearer for Electron, cookies for web,
- the browser Supabase client uses an Electron token provider when running
  inside Electron, and
- action/query call sites use a small retry wrapper for typed Electron auth
  failures.

Business logic stays shared. The plan avoids duplicating feature behavior into
parallel Electron-only API implementations unless a specific browser-only
Supabase call cannot be made reliable through the token provider.

---

## Proposed Code Map

### New files

- `lib/auth/electron-jwt.ts` — `verifyElectronAccessToken(token)` wrapper
  around `createRemoteJWKSet` + `jwtVerify`. Asserts `aud=authenticated`,
  `iss=<supabase-url>/auth/v1`, and `client_id === ELECTRON_OAUTH_CLIENT_ID`.
- `lib/auth/get-electron-user.ts` — server-side helper exporting
  `getElectronUserFromRequest(request)` (middleware) and
  `getElectronUserFromHeaders()` (server components / server actions
  using `next/headers`). Returns `{ userId, email, accessToken, clientId }`
  or throws a typed `ElectronAuthError`.
- `lib/auth/electron-detect.ts` — single source of truth for
  "is this an Electron request?". Reads a dedicated header
  `X-Overlord-Client: desktop` (preferred) and falls back to UA sniffing
  during rollout. Header is injected by main-process header injector.
- `apps/desktop/electron/services/session-store.ts` — in-memory
  authoritative session record `{ accessToken, accessTokenExpiresAt,
  refreshToken }` + accessors. Loaded on boot from
  `electron-credentials.ts`, kept in sync via `saveElectronCredentials`.
  Header injector reads `accessToken` synchronously from this module.
- `apps/desktop/electron/services/refresh-controller.ts` —
  single-flight refresh owner. Exposes
  `getValidAccessToken(): Promise<string>` which:
  - returns the cached token if it expires > `REFRESH_MARGIN_MS` away,
  - otherwise serializes through an in-memory mutex
    (`Promise<string> | null`) and refreshes via the existing
    `refreshOAuthTokens` function. Persists rotated refresh tokens
    through `saveElectronCredentials`.
- `apps/desktop/electron/services/header-injector.ts` —
  `installAuthHeaderInjector({ session, platformOriginGetter, refreshController })`
  registers `session.webRequest.onBeforeSendHeaders` for the platform
  origin and the configured Supabase origin. It injects `Authorization`
  for both, and injects `X-Overlord-Client: desktop` only for the platform
  origin. Supabase cookie stripping is implemented through the existing
  response-header/CSP pipeline rather than a second independent
  `onHeadersReceived` listener.
- `apps/web/lib/electron-auth/access-token-provider.ts` — renderer-side
  access-token provider with no durable state. It asks main for
  `auth:getAccessToken` / `auth:refreshSession`, memoizes only the
  short-lived access token in memory, and exposes a single-flight
  `getElectronAccessToken({ force?: boolean })`.
- `apps/web/lib/electron-auth/action-retry.ts` — wraps direct Server Action
  invocations in Electron. On the typed Electron auth error, it calls
  `window.electronAPI.auth.refreshSession()` once and re-invokes the action.
- `apps/web/lib/electron-auth/fetch-with-retry.ts` — wraps explicit
  client-side `fetch` calls to app routes. On a bearer `401`, it asks main
  for one forced refresh and retries once.
- `apps/web/app/electron/api/...` *(optional)* — only if we decide to
  give Electron a small set of API routes for things that **should not**
  be cookie-bound (e.g. a server-recognized 401-on-failure endpoint).
  Default plan: do not introduce new routes; keep all server actions.

### Modified files

- `supabase/utils/proxy.ts` (middleware)
  - Keep canonical-host redirects and public/machine endpoint bypasses
    before Electron bearer enforcement. `/electron-login`, `/api/auth/config`,
    OAuth consent/callback paths, health checks, protocol/MCP endpoints, and
    static assets must keep working without a bearer.
  - For protected Electron app/RSC/action/API requests: extract bearer →
    `verifyElectronAccessToken` → on success, clone request headers and
    return `NextResponse.next({ request: { headers } })` with
    `x-overlord-access-token` and `x-overlord-user-id` set. Never mutate
    `request.headers` after creating the response.
  - On failure, return `401` with
    `WWW-Authenticate: Bearer error="invalid_token" | "expired_token"`
    for any request whose `Accept` includes `application/json`,
    has a `next-action` header, has a `_rsc` query, is under `/api/`,
    or whose method is not `GET/HEAD`. Otherwise (true navigation)
    redirect to `/electron-login` with `307`.
  - Delete `getElectronCookieSessionState` and the cookie-staleness
    short-circuit. All Electron requests use the bearer; cookies are
    not consulted.
- `supabase/utils/server.ts`
  - Add `createElectronClient(accessToken)` that returns a
    `createServerClient` configured with **no cookies adapter** and
    `global: { headers: { Authorization: \`Bearer \${accessToken}\` } }`.
  - Add `createClientForRequest()` that picks `createElectronClient`
    when the request is Electron (after middleware has populated a
    request header `x-overlord-access-token`) and falls back to the
    cookie client otherwise. This is the migration seam for server
    actions, RSCs, and route handlers.
  - Add helpers for request-scoped preferences that currently read
    `cookies()` directly (`selected organization`, `default project`,
    `sidebar_state`, view preferences). Electron paths must either read
    explicit request inputs, persisted profile settings, or a small
    Electron preference store; they must not depend on Supabase auth
    cookies surviving.
- `apps/desktop/electron/main.ts`
  - Mount `installAuthHeaderInjector` after `app.whenReady()` and after
    the platform URL is known. Inject `Authorization` and
    `X-Overlord-Client: desktop` for every webContents request whose
    URL origin matches the platform origin. Inject only `Authorization`
    for requests to the configured Supabase origin.
  - Replace the current standalone CSP `onHeadersReceived` installer with
    a composed response-header pipeline that applies CSP and Electron
    cookie hygiene in one webRequest listener.
- `apps/desktop/electron/ipc/auth.ts`
  - Replace ad-hoc refresh handlers (`auth:refreshSession`,
    `auth:refreshOAuthSession`, `auth:refreshAgentToken`,
    `auth:checkOAuthSession`, `auth:checkAgentToken`,
    `auth:saveRefreshToken`) with a thin wrapper around the new
    `refreshController.getValidAccessToken()` and `forceRefresh()`.
  - Add `auth:getAccessToken` for renderer Supabase clients. It calls
    `refreshController.getValidAccessToken()` and returns only the
    short-lived access token plus expiry metadata; it never returns the
    refresh token.
  - Remove the `safeStorage` decryption-on-read fallback that allowed
    a stale Desktop wrapper to overwrite the CLI plaintext session
    (lines 102–158 of `electron-credentials.ts` — the "older encrypted
    Desktop wrapper" branch is no longer needed once the main process
    is the only refresher).
- `apps/desktop/electron/services/electron-credentials.ts`
  - Stop writing the **same** refresh token to a CLI-shared
    `credentials.json`. Each client has its own credential file
    keyed by `client_id` (see "Separate OAuth clients" below).
- `apps/web/components/features/electron-auth/ElectronAuthGate.tsx`
  - Delete the renderer proactive refresh timer / focus handler.
    The renderer no longer owns refresh timing or refresh-token rotation —
    main does.
  - Keep the "restoring session" UI for first-launch and the
    `401 → IPC refresh → retry` recovery overlay.
  - Stop calling `supabase.auth.setSession()` after first-launch once the
    Electron token-provider client is installed. During rollout, this call
    remains behind the legacy-cookie feature flag only.
- `supabase/utils/client.ts`
  - In Electron, return a browser Supabase client configured with
    `persistSession: false`, `autoRefreshToken: false`, and the
    Electron access-token provider (or, where the SDK requires it,
    explicit `global.headers.Authorization` plus `realtime.setAuth()` after
    `auth:getAccessToken`). Web continues to use the normal cookie client.
  - Audit browser Supabase usages: realtime hooks, direct `.from()` reads,
    storage signed URL uploads/downloads, and any component that calls
    `createClient()` in the browser.
- `lib/electron-auth/ensure-session.ts`
  - **Delete file.** No callers should remain after the
    `MutationCache.onMutate` preflight is removed.
- React Query setup
  - Replace `MutationCache.onMutate` preflight with explicit wrappers at
    the transport edges:
    - `withElectronActionRetry(action)` for imported Server Actions used
      as mutation functions,
    - `fetchWithElectronRetry` for explicit client fetches,
    - `refreshElectronRoute()` for `router.refresh()` / RSC reload paths.
  - Server actions that fail auth under Electron return or throw a typed
    `ElectronAuthError` shape before doing business work. The wrapper
    catches only that shape, forces one main-process refresh, retries once,
    and then surfaces the original error if the retry fails.
- `app/electron-login/route.ts` (or page)
  - Stop accepting `POST`. Always responds to `GET` with a page or
    `303` to a navigation. Action-like requests now produce a bearer
    `401` or typed auth error, not redirects, so the `405` symptom is
    structurally impossible.

### Deletions (after rollout)

- `lib/electron-auth/ensure-session.ts`
- `MutationCache.onMutate` preflight in the QueryClient
- `getElectronCookieSessionState` and friends in `proxy.ts`
- The `safeStorage` cross-write logic in `electron-credentials.ts`

---

## Detailed Mechanics

### 1. Header injection (main process)

```ts
// header-injector.ts (sketch)
session.defaultSession.webRequest.onBeforeSendHeaders(
  { urls: [`${platformOrigin}/*`, `${supabaseOrigin}/*`] },
  async (details, callback) => {
    try {
      const token = await refreshController.getValidAccessToken();
      const origin = new URL(details.url).origin;
      const headers = {
        ...details.requestHeaders,
        Authorization: `Bearer ${token}`
      };
      if (origin === platformOrigin) {
        headers['X-Overlord-Client'] = 'desktop';
      }
      callback({ requestHeaders: headers });
    } catch {
      // No valid session — let the request proceed without a bearer.
      // Middleware will return 401 and the renderer will route to
      // /electron-login.
      callback({ requestHeaders: details.requestHeaders });
    }
  }
);
```

- `webRequest.onBeforeSendHeaders` supports an async callback in
  Electron ≥ 24, but the callback is invoked once the promise resolves;
  any sync token read needs to be available immediately to keep
  navigation snappy. Hence `refreshController.getValidAccessToken()`
  must return synchronously when the cached token is fresh — implement
  it as `if (cache.expiresAt - now > MARGIN) return cache.accessToken;`
  before awaiting.
- The injector must be scoped to the exact configured platform and
  Supabase origins. Never attach the bearer to arbitrary navigation,
  third-party images, or external browser handoff URLs.
- Cookie hygiene is part of the existing response-header pipeline in
  `main.ts`. Compose it with CSP in one `onHeadersReceived` listener:
  apply CSP for renderer documents, then remove Supabase auth cookies
  only from responses for the configured platform origin. Do not register
  an independent second `onHeadersReceived` listener.

### 2. Single-flight refresh

```ts
// refresh-controller.ts (sketch)
let inflight: Promise<string> | null = null;

export async function getValidAccessToken(): Promise<string> {
  const cached = sessionStore.read();
  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return cached.accessToken;
  }
  inflight ??= doRefresh().finally(() => { inflight = null; });
  return inflight;
}

async function doRefresh(): Promise<string> {
  const credentials = loadElectronCredentials();
  if (!credentials?.refresh_token) {
    throw new ElectronAuthError('no_refresh_token');
  }
  const session = await refreshOAuthTokens(
    credentials.platform_url,
    credentials.refresh_token
  );
  saveElectronCredentials({
    ...credentials,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    access_token_expires_at: new Date(
      Date.now() + (session.expires_in ?? 3600) * 1000
    ).toISOString()
  });
  sessionStore.write(session);
  emitSentryBreadcrumb('electron_auth.token_rotated');
  return session.access_token;
}
```

- This kills the single-use refresh-token race **at the source** and
  removes the need for the renderer-side `refreshInFlight` lock.
- `forceRefresh()` (used by the 401 retry path) clears the cache and
  awaits a new `doRefresh()` — but still serializes through `inflight`.

### 3. Server-side bearer verification

```ts
// lib/auth/electron-jwt.ts
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getElectronOAuthClientId, getSupabaseUrl } from '@/lib/env';

const JWKS = createRemoteJWKSet(
  new URL(`${getSupabaseUrl()}/auth/v1/.well-known/jwks.json`)
);

export async function verifyElectronAccessToken(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `${getSupabaseUrl()}/auth/v1`,
    audience: 'authenticated'
  });
  if (payload.client_id !== getElectronOAuthClientId()) {
    throw new Error('invalid_client');
  }
  return payload as { sub: string; email?: string; client_id: string };
}
```

- `jose` is already a transitive dep via Supabase; if not, add it
  explicitly (~30 KB).
- JWKS is cached in-process by `createRemoteJWKSet`; no extra plumbing.
- The Edge runtime supports `jose`. Middleware verification works.

### 4. Middleware dispatcher

```ts
// supabase/utils/proxy.ts (Electron branch sketch)
if (isPublicRoute(request.nextUrl.pathname) || isMachineAuthEndpoint(request)) {
  return NextResponse.next({ request });
}

if (isElectronRequest(request) && isProtectedAppRequest(request)) {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return electron401(request, 'missing_token');

  try {
    const claims = await verifyElectronAccessToken(token);
    // Pass the verified token through to server components / actions
    // via a *request* header (not a cookie) so createElectronClient
    // can reach it from next/headers.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-overlord-access-token', token);
    requestHeaders.set('x-overlord-user-id', claims.sub);
    requestHeaders.set('x-overlord-client-id', claims.client_id);
    return NextResponse.next({
      request: { headers: requestHeaders }
    });
  } catch (err) {
    return electron401(request, classify(err));
  }
}
```

`electron401(request, code)` returns:

- `Response.json({ error: code }, { status: 401, headers: { 'WWW-Authenticate': \`Bearer error="\${code}"\` } })`
  for: any non-`GET/HEAD` method, any request with `next-action`,
  `_rsc` query, `Accept: application/json`, or a pathname under `/api/`.
- A `307` redirect to `/electron-login?next=…` for the rest (top-level
  navigations the user can actually see).

Middleware ordering is part of the contract:

1. canonical host redirect,
2. public/static/machine endpoint bypass,
3. Electron protected-request bearer validation,
4. existing web cookie SSR flow.

This keeps first launch, `/electron-login`, `/api/auth/config`, OAuth
consent/callbacks, protocol/MCP routes, and health checks usable before an
Electron access token exists.

### 5. Server components & server actions

```ts
// supabase/utils/server.ts
export async function createClientForRequest() {
  const headerStore = await headers();
  const electronToken = headerStore.get('x-overlord-access-token');
  if (electronToken) return createElectronClient(electronToken);
  return createClient(); // existing cookie-based client
}

export function createElectronClient(accessToken: string) {
  return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: { getAll: () => [], setAll: () => {} },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}
```

- Migration is mechanical: every `await createClient()` in a server
  action, RSC, or route handler that depends on the current user becomes
  `await createClientForRequest()`. This is one codemod (e.g. ts-morph)
  plus a quick PR, followed by a grep audit for route handlers and direct
  `cookies()` usage.
- Direct cookie reads are not automatically safe under Electron. Replace
  scattered reads with helpers such as `getSelectedOrganizationForRequest()`,
  `getDefaultProjectForRequest()`, and `getViewPreferenceForRequest()`.
  Those helpers use cookies for the web path and Electron-safe state
  (explicit action input, profile settings, or Electron preferences) for
  the desktop path.

### 6. Browser Supabase client in Electron

The renderer still has legitimate browser-side Supabase usage: realtime
subscriptions, direct `.from()` reads in live views, and storage signed URL
operations. Removing persisted browser sessions without replacing those
calls would break the app.

```ts
// supabase/utils/client.ts (Electron branch sketch)
export function createClient() {
  if (isElectron()) {
    return createBrowserClient(getSupabaseUrl(), getSupabasePublishableKey(), {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      accessToken: () => getElectronAccessToken()
    });
  }

  return createBrowserClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookieOptions: getSupabaseCookieOptions()
  });
}
```

- The access-token callback is backed by `auth:getAccessToken` and the same
  main-process `refresh-controller`. The renderer never sees or writes a
  refresh token.
- If the installed Supabase SDK path cannot use an async access-token
  callback for a specific transport, use the nearest explicit hook:
  `global.headers.Authorization` for REST/storage and `realtime.setAuth()`
  after fetching the token. Re-authenticate realtime after a forced refresh.
- Keep `onBeforeSendHeaders` injection for the Supabase origin as a
  defense-in-depth layer and for transports that honor browser request
  headers, but do not rely on it as the only realtime auth mechanism.
- Audit all browser `createClient()` call sites before disabling
  `supabase.auth.setSession()` in Electron.

### 7. Renderer retry contract

```ts
// app/_lib/fetch-with-retry.ts
export async function fetchWithElectronRetry(input, init, retried = false) {
  const res = await fetch(input, init);
  if (
    res.status === 401 &&
    !retried &&
    res.headers.get('www-authenticate')?.startsWith('Bearer ')
  ) {
    await window.electronAPI?.auth.refreshSession();
    return fetchWithElectronRetry(input, init, true);
  }
  return res;
}
```

- TanStack Query fetch-based `queryFn` / `mutationFn` call sites use this
  wrapper. Mutation functions that call imported Server Actions use the
  action wrapper below instead.
- Imported Server Actions do **not** rely on this fetch wrapper. They use
  an explicit action wrapper:

```ts
export function withElectronActionRetry<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>
) {
  return async (...args: TArgs): Promise<TResult> => {
    try {
      return await action(...args);
    } catch (err) {
      if (!isElectronAuthError(err) || !window.electronAPI?.auth) throw err;
      await window.electronAPI.auth.refreshSession();
      return action(...args);
    }
  };
}
```

- TanStack mutation functions that call imported actions wrap those actions
  directly. This replaces the broad `MutationCache.onMutate` preflight with
  a narrow retry at the call site that actually failed.
- Form actions / `useActionState` paths use the same wrapper where possible.
  If a framework-level action failure cannot be caught as a typed error, the
  component refreshes through `refreshElectronRoute()` and then re-renders
  the current route once.

### 8. CLI separation

- Register a second OAuth public client `overlord-cli` in the
  Supabase OAuth admin. Desktop continues to use the existing
  `overlord-desktop` client. They no longer share a refresh token.
- `electron-credentials.ts` writes only to
  `~/.ovld/credentials.<client>.json`.
- The CLI installer reads from `~/.ovld/credentials.cli.json`. RLS
  policies that need to discriminate use
  `auth.jwt() ->> 'client_id'`.
- Migration: on first boot after upgrade, if only the legacy
  `credentials.json` exists, copy it to
  `credentials.desktop.json`, leave the original untouched until the
  next CLI run, which performs a fresh login against the new
  `overlord-cli` client.

### 9. Loopback port

- Replace fixed `45620` with a small range. Register
  `http://127.0.0.1:45620/callback` … `45629/callback` in the OAuth
  client's allowed redirect URIs. On login, iterate and bind the first
  available port.
- Eliminates the `EADDRINUSE` Sentry symptom.

### 10. Logout

```ts
ipcMain.handle('auth:logout', async () => {
  try {
    await revokeGrant(clientId, accessToken); // POST /auth/v1/oauth/revoke
  } catch { /* best-effort */ }
  clearElectronCredentials();
  sessionStore.clear();
  await session.defaultSession.clearStorageData({
    origin: platformOrigin,
    storages: ['cookies']
  });
});
```

### 11. Diagnostics

Tagged Sentry breadcrumbs (no secrets):

- `electron_auth.refresh_attempt { reason: 'preemptive' | 'on_401' | 'first_boot' }`
- `electron_auth.refresh_success { rotated: boolean, latency_ms }`
- `electron_auth.refresh_failed { code, status }`
- `electron_auth.bearer_missing { pathname, method }`
- `electron_auth.bearer_invalid { code }`
- `electron_auth.loopback_bind_failed { port }`

Drop the `[overlord:electron-auth-redirect]` console block — the
breadcrumbs replace it.

---

## Migration Sequencing

Each step is independently shippable and reversible.

1. **Register `overlord-cli` OAuth client.** No code change yet; just
   the registration. Confirm both clients can issue OAuth tokens.
2. **Add `lib/auth/electron-jwt.ts`, `lib/auth/electron-detect.ts`,
   `lib/auth/get-electron-user.ts`.** Pure additions, no behavior
   change.
3. **Add `apps/desktop/electron/services/session-store.ts` and
   `refresh-controller.ts`.** Existing IPC handlers continue to work;
   the new module is a no-op until the injector is mounted.
4. **Add `auth:getAccessToken` and the Electron browser Supabase token
   provider behind a feature flag.** Browser Supabase calls continue to
   work without persisted Electron cookies: verify realtime hooks, direct
   `.from()` reads, and storage signed URL flows.
5. **Mount `installAuthHeaderInjector` in `main.ts` behind a feature
   flag** (`OVLD_ELECTRON_BEARER_AUTH=1` env, or a Settings toggle).
   At this point Electron requests carry **both** cookies and a bearer.
   Server-side still uses cookies. Compose cookie hygiene into the existing
   CSP response-header listener, but leave stripping disabled until step 13.
6. **Branch middleware on Electron + flag + bearer present.**
   Public routes and machine endpoints bypass bearer enforcement; protected
   Electron requests verify the bearer and pass it downstream through
   `NextResponse.next({ request: { headers } })`. Roll out to internal users.
7. **Migrate one canary server action** (e.g. `createTicketInColumnAction`)
   to `createClientForRequest` and wrap its client mutation with
   `withElectronActionRetry`. Verify under the flag.
8. **Codemod remaining server-side `createClient()` call sites** to
   `createClientForRequest()`. Include server actions, RSCs, and route
   handlers. Land in chunks per feature area.
9. **Replace direct request cookie reads.** Audit `cookies()` in `app/`,
   route handlers, and `lib/actions/`; move selected organization, default
   project, sidebar, and view preferences behind request-aware helpers.
10. **Delete the cookie-staleness short-circuit and the
   `electron-auth-redirect` log block.** Middleware's Electron path is
   bearer-only.
11. **Switch renderer transports to the retry contract.** Use
   `withElectronActionRetry` for imported server actions,
   `fetchWithElectronRetry` for explicit fetches, and
   `refreshElectronRoute()` for route refreshes. Verify mutations and RSC
   navigations recover from a forced expiry.
12. **Delete `lib/electron-auth/ensure-session.ts` and the
    `MutationCache.onMutate` preflight.**
13. **Disable cookie writes in Electron entirely**: remove the
    `setSession`-in-webview path; strip Supabase cookies on the
    platform origin via the composed response-header pipeline.
14. **Flip the feature flag default to on.** Keep
    `OVLD_ELECTRON_BEARER_AUTH=0` /
    `NEXT_PUBLIC_OVLD_ELECTRON_BEARER_AUTH=0` as the documented rollback
    switch for one release, then remove the flag in the follow-up cleanup
    release.
15. **Split CLI credentials store; backfill once.**
16. **Loopback port range.**

A safe rollback through the default-on release is "set
`OVLD_ELECTRON_BEARER_AUTH=0` and
`NEXT_PUBLIC_OVLD_ELECTRON_BEARER_AUTH=0`" — that restores the legacy
cookie-backed Electron path for one release while the cleanup ticket lands.

---

## Test Plan

### Unit

- `verifyElectronAccessToken` accepts a freshly minted token; rejects
  wrong `iss`, wrong `aud`, wrong `client_id`, expired, malformed.
- `refresh-controller` collapses N concurrent
  `getValidAccessToken()` calls into one network round-trip; verify
  with a mocked `refreshOAuthTokens`.
- `header-injector` attaches headers only for the platform origin and
  configured Supabase origin, and not for arbitrary URLs (e.g.
  `https://google.com` — confirm no leak). Supabase-origin requests must
  not receive `X-Overlord-Client`.
- The composed response-header pipeline preserves the existing CSP header
  while stripping only Supabase auth cookies for the platform origin.
- `createElectronClient` does not read or write cookies even when a
  request has Supabase cookies set.
- Middleware passes verified Electron bearer data downstream by cloning
  request headers into `NextResponse.next({ request: { headers } })`.
- `withElectronActionRetry` retries exactly once for typed Electron auth
  failures and does not retry ordinary validation/business errors.
- The Electron browser Supabase client calls `auth:getAccessToken`, disables
  persistence and auto-refresh, and never writes a browser session.

### Integration (Playwright in Electron)

- Cold-start with valid stored refresh token: app opens to `/u`, no
  login screen, no cookies on the platform origin.
- First launch with no stored credentials: `/electron-login` and
  `/api/auth/config` load without a bearer and without a `401` loop.
- Force-expire the cached access token; perform a server action;
  expect one IPC refresh and a successful retry, both visible in
  Sentry breadcrumbs.
- Force-expire the cached access token; run an explicit app-route fetch
  and a direct imported Server Action mutation; both refresh once and retry
  once through their respective wrappers.
- With Electron cookies stripped, verify browser Supabase paths still work:
  realtime updates, direct live-view `.from()` reads, and storage signed
  URL upload/download flows.
- Revoke the refresh token in Supabase; perform an action; expect a
  `401`, IPC refresh fails, render `/electron-login`.
- Two windows performing concurrent mutations: only one
  `refresh_attempt` breadcrumb fires.
- Logout: cookies absent for platform origin, credential files gone,
  next launch sends user to `/electron-login`.

### Regression

- Web-app smoke tests must remain green throughout — there is no
  Electron header on web requests, so the cookie path is unchanged.
- Ensure RLS policies that read `auth.uid()` still work for Electron
  by hitting a row-restricted query in a server action and asserting
  the same result as the cookie-based path.
- Verify Server Actions that currently revalidate paths
  (`revalidatePath('/u/...')`) still succeed under the bearer path.
- Verify route handlers using the current user (`/api/tickets/search`,
  project file routes, ticket conversation routes) authenticate through
  `createClientForRequest()` under Electron.
- Verify request preferences that previously used `cookies()` still have
  deterministic Electron behavior for selected organization, default
  project, sidebar state, and board/list view.

### Manual checklist

- [ ] Sleep laptop > 1 hour, wake, navigate — no 401 visible to user.
- [ ] Update from previous version with stale cookies present —
  cookies are stripped on first request to the platform origin.
- [ ] Run CLI and Desktop concurrently — neither overwrites the
  other's refresh token.

---

## Risks & Mitigations

- **Risk:** `webRequest.onBeforeSendHeaders` runs in main and adds
  latency. **Mitigation:** synchronous return when token is fresh;
  measure p99 added latency in dev (target < 1 ms).
- **Risk:** A server action somewhere reaches into `cookies()` directly
  or route handlers are missed by the `createClient()` codemod.
  **Mitigation:** codemod + grep audit for `createClient()` and
  `cookies()` usage in `app/`, route handlers, and `lib/actions/`. Add
  request-aware helpers for current user and preferences so callers never
  touch auth cookies directly.
- **Risk:** Browser-side Supabase calls break when Electron no longer
  persists a Supabase browser session. **Mitigation:** ship the
  Electron browser Supabase token provider before stripping cookies; verify
  realtime, direct `.from()` reads, and storage signed URL flows under the
  feature flag.
- **Risk:** Server Action auth failures are swallowed by the Next action
  transport before app code can inspect a response. **Mitigation:** do not
  rely on global fetch interception for imported actions. Use typed action
  errors and explicit `withElectronActionRetry` wrappers at mutation/form
  call sites, with integration tests for forced expiry.
- **Risk:** Electron response-header listeners conflict. **Mitigation:**
  compose CSP and cookie hygiene in one `onHeadersReceived` pipeline owned
  by `main.ts`.
- **Risk:** Public Electron login/config routes get caught by bearer
  enforcement. **Mitigation:** keep public and machine endpoint bypasses
  before the protected Electron branch and add no-token first-launch tests.
- **Risk:** RSC requests from links opened in an external browser do
  not get the header. **Mitigation:** external links to platform pages
  are already a re-login path; document and accept.
- **Risk:** Bearer tokens sent over plain `http://` to a local Next.js
  dev server. **Mitigation:** dev already runs the platform on
  localhost; tokens never leave the device. Verify the injector is
  scoped to the configured platform origin only.
- **Risk:** Sentry breadcrumb cardinality. **Mitigation:** keep keys
  enumerated and bounded; do not include URLs with IDs.
- **Risk:** A user has an old Desktop build that still mirrors cookies
  while the server-side codepath has been migrated. **Mitigation:** the
  feature flag and the staged sequencing ensure server-side migration
  ships only after a Desktop release that injects the header. Keep the
  cookie path live for at least one release after server-side migrates.

---

## Open Questions

1. Do we want to also issue Electron a separate **client_id-scoped**
   short-lived token for Server Actions only, vs. the same access token
   used everywhere? Default plan: one token; revisit only if we
   discover a server-side caller that should be scoped down.
2. Is there value in moving **agent IPC tokens** (`auth:checkAgentToken`,
   `auth:refreshAgentToken`) to the same controller? Probably yes —
   they should also flow through `refresh-controller` once the
   controller exists. Folded into step 3.
3. Do we need a server-side per-organization scope check at the
   middleware layer? Today this is enforced inside RLS / actions; not
   changing here.

---

## Definition of Done

- All Electron-originated requests verified server-side via JWKS;
  no path consults Supabase cookies for Electron requests.
- Public Electron bootstrap paths (`/electron-login`, `/api/auth/config`,
  OAuth consent/callbacks, protocol/MCP routes) remain reachable without a
  bearer.
- Middleware propagates verified bearer claims with request-header overrides,
  not post-response request mutation.
- Browser-side Supabase usage in Electron works without persisted Supabase
  cookies: realtime, direct reads, and storage signed URL flows all use
  main-backed access tokens.
- Existing CSP behavior remains intact while Electron Supabase auth cookies
  are stripped through the composed response-header pipeline.
- `lib/electron-auth/ensure-session.ts` deleted; no preflight in
  React Query.
- Imported Server Action mutations use typed `withElectronActionRetry`
  rather than relying on global fetch interception.
- `getElectronCookieSessionState` and the cookie-staleness short-circuit
  removed from `supabase/utils/proxy.ts`.
- A forced 1-hour sleep + cold action triggers exactly one refresh
  and zero user-visible errors in a Playwright run.
- Sentry shows the new structured breadcrumbs and zero
  `Invalid Refresh Token: Refresh Token Not Found` events from the
  Electron client over a full release window.
- CLI and Desktop have independent OAuth clients; rotation in one does
  not invalidate the other.
- Loopback port `EADDRINUSE` failure mode no longer reachable.
