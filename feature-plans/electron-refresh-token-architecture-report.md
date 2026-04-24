# Electron Refresh Token Architecture Report

Date: 2026-04-24

## Purpose

This report describes the Electron refresh-token problem we are seeing in production and explains why it is a consequence of the current app architecture. The goal is not to justify the current patches. The goal is to give us a shared technical model so we can review and plan a cleaner auth redesign.

## Executive Summary

The Electron app currently has two overlapping auth systems:

1. A normal Next.js/Supabase SSR browser session stored in webview cookies.
2. A desktop-owned OAuth session stored by the Electron main process and refreshed through Supabase's OAuth token endpoint.

Those two systems do not have the same refresh semantics.

The web app path assumes Supabase SSR can refresh cookies through the standard GoTrue refresh endpoint:

```text
POST /auth/v1/token?grant_type=refresh_token
```

The Electron OAuth path requires refresh through Supabase's OAuth token endpoint with a client id:

```text
POST /auth/v1/oauth/token
grant_type=refresh_token
client_id=<electron-oauth-client-id>
```

When the Electron webview cookie session gets stale, middleware, RSC requests, and server actions can still try to use the cookie refresh token as if it were a standard browser refresh token. Supabase rejects it with:

```text
Invalid Refresh Token: Refresh Token Not Found
code: refresh_token_not_found
```

This is why the problem appears in Electron but not the web app. The web app has one session owner. Electron currently has two.

## Observed Production Symptoms

We have seen several related symptoms:

- Creating a project in Electron can fail with the client-side message "An unexpected response was received from the server."
- Creating a task in Electron can fail in the same way.
- Vercel logs show Supabase refresh failures:

```text
AuthApiError: Invalid Refresh Token: Refresh Token Not Found
status: 400
code: refresh_token_not_found
```

- Middleware logs show Electron auth redirects from protected routes:

```text
[overlord:electron-auth-redirect] {
  authErrorMessage: 'Invalid Refresh Token: Refresh Token Not Found',
  authErrorName: 'AuthApiError',
  authErrorStatus: 400,
  method: 'GET',
  pathname: '/u',
  refererPath: '/u',
  supabaseCookieCount: 2
}
```

- One runtime log showed a server-action-style request being redirected to the Electron login page:

```text
POST /electron-login -> 405
```

- A separate Sentry issue showed Electron login can fail before any webview session is restored:

```text
OAuth callback port 45620 is already in use
```

These are not all the same bug, but they are connected by the same architectural theme: Electron auth state is split between desktop main-process credentials and browser cookie state.

## Current Architecture

### Web App Auth

The web app follows the normal Supabase SSR model:

- Middleware creates a Supabase server client using request cookies.
- `supabase.auth.getUser()` is called in middleware to validate and refresh session state.
- Server components and server actions create their own Supabase server clients from cookies.
- The browser Supabase client owns browser session persistence and auto-refresh.

In this model, the cookie session is the source of truth. It works because the refresh token in the cookie is compatible with Supabase SSR's normal refresh path.

### Electron Auth

Electron adds another auth layer:

- The renderer is still the Next.js web app running in a Chromium webview.
- The Electron main process performs an OAuth Authorization Code + PKCE flow.
- The OAuth callback is received on a local loopback port.
- The main process exchanges the code through Supabase's OAuth token endpoint.
- The main process stores the OAuth refresh token outside the webview.
- The renderer calls IPC methods like `auth.refreshSession()`.
- The renderer then calls `supabase.auth.setSession()` so the webview has cookies for server components, server actions, and middleware.

This means Electron has a desktop-owned source of truth and a cookie mirror. The cookie mirror is necessary because the Next.js app still expects cookie-authenticated SSR.

## Why The Refresh Problem Happens

The core problem is that the cookie mirror can become stale while the desktop-owned OAuth session is still valid.

Several events can cause this:

- The app is asleep or closed when the access token expires.
- The renderer misses the proactive refresh timer.
- The browser Supabase client attempts its own normal refresh and fails.
- A refresh token rotates in the main process, but stale cookies still contain the previous refresh token.
- Multiple Electron windows or processes race login/refresh behavior.
- The user signs in again but the loopback callback fails or the renderer cookie state is not fully replaced.

Once the cookie is stale, any server-side Next.js request can trip the issue:

- RSC navigation, such as `GET /u?_rsc=...`
- direct route loads
- server actions
- API routes that use cookie auth
- client transitions that trigger middleware

Middleware sees Supabase auth cookies and calls `supabase.auth.getUser()`. Supabase SSR attempts to recover the session by refreshing the cookie refresh token through the standard endpoint. That endpoint does not accept the stale or OAuth-issued refresh token, so the request fails before Electron has a chance to restore through IPC.

## Why Server Actions Produce A Confusing Error

Server actions expect a specific Next.js action response. If middleware redirects the action request to `/electron-login`, the renderer does not receive the action payload it expected.

For a `POST` action request, a redirect can preserve the method. That produces:

```text
POST /electron-login -> 405
```

The user does not see that low-level detail. They see a generic Next.js client error:

```text
An unexpected response was received from the server.
```

This is why the project/task creation failures look like application mutation failures even though the root problem is auth/session refresh.

## Why It Only Affects Some Users

This problem depends on timing and local state, so it does not affect every Electron user.

Users are more likely to hit it when:

- their webview cookies contain an old refresh token
- their Electron main-process credential store contains a different refresh token
- their app slept through a scheduled renderer refresh
- they recently updated from a version with different refresh behavior
- they have multiple Electron processes or stale local callback listeners
- their OAuth refresh token has rotated but the cookie mirror did not update
- the first protected request after expiry is a server action or RSC request

Users are less likely to hit it when:

- they use the web app, because there is only one browser session owner
- they freshly signed in and the cookie mirror was set correctly
- the renderer stayed awake long enough to refresh before expiry
- the first post-expiry path goes through the Electron login bridge cleanly

The "recently signed in" cases are important. Recent sign-in does not guarantee correctness if the sign-in did not fully complete, if the loopback callback failed, or if stale cookies survived beside newer main-process credentials.

## Why The Existing "Restoring Session" Flow Exists

`ElectronLoginScreen.tsx` has a restoring-session path because the app already recognized that Electron's durable credentials live outside the browser cookie session.

That flow tries to recover this state:

```text
main process has refresh token
renderer/webview has no usable Supabase session cookie
```

It works when the user reaches `/electron-login` as a normal page. It does not fully solve the architecture issue because middleware and server actions can fail before the renderer is in control.

The key limitation is that Electron's correct refresh mechanism is client/IPC-driven, while Next.js middleware and server actions run server-side before renderer code can execute.

## Direct Server-Action And Server-Side Surfaces At Risk

Any server action or server-rendered path that depends on the Supabase cookie session can hit the same failure if Electron cookies are stale.

Examples include:

- project creation through `createProject`
- ticket creation through `createTicketInColumnAction`
- ticket updates, status changes, reorder, delete, and project assignment
- project settings mutations
- ticket status mutations
- Everhour mutations
- route loads and RSC refreshes for `/u` and project pages

The issue is not specific to project creation or task creation. Those were just the user-visible workflows that exposed it.

## Current Patch Direction

The recent patches reduce the blast radius:

- React Query mutations in Electron preflight through `ensureFreshElectronSession()`.
- Middleware logs Electron auth redirects with enough context to identify stale-cookie cases.
- Middleware can short-circuit expired Electron cookies before Supabase SSR hits the wrong refresh endpoint.
- Non-GET redirects to login use `303` so server-action `POST`s do not become `POST /electron-login`.
- The browser Supabase client disables auto-refresh in Electron so the Electron main process is the intended refresh owner.
- Electron startup now prevents multiple app instances from competing for the fixed OAuth callback port.

These are useful mitigations, but they are still compensating for split session ownership.

## Architectural Root Cause

The root cause is not simply "bad refresh token handling."

The root cause is that Electron is running a web app architecture that assumes cookie-owned browser auth, while the desktop app also owns a separate OAuth credential lifecycle.

The current system has these mismatches:

| Concern | Web App Assumption | Electron Reality |
| --- | --- | --- |
| Durable session owner | Browser/Supabase cookies | Electron main-process credential store |
| Refresh endpoint | `/auth/v1/token` | `/auth/v1/oauth/token` with `client_id` |
| Refresh trigger | Supabase browser/SSR client | Electron IPC |
| Server-side auth source | Request cookies | Request cookies that mirror desktop state |
| Recovery path | Redirect to `/login` | Renderer must call Electron IPC |
| Failure visibility | Normal web auth redirects | Server action/RSC protocol errors |

The system is fragile because the mirrored cookie state is treated as authoritative by Next.js middleware, server components, and server actions even though it is not the durable Electron session.

## Design Questions For Redesign

The redesign should choose one clear auth authority for Electron. The main question is: what should server-side Next.js trust for Electron requests?

### Option A: Make Webview Cookies The True Electron Session

Electron would need a cookie-compatible Supabase session where the standard SSR refresh path works. The main process would no longer maintain a separate OAuth refresh lifecycle, or it would only bootstrap the browser session and then step aside.

Questions:

- Can Electron use a Supabase session shape that refreshes through the standard endpoint?
- What happens to CLI/shared OAuth credentials?
- Can we avoid storing a second refresh token in the main process?
- Does this conflict with the OAuth-only CLI/Desktop direction?

### Option B: Make Electron Main Process The Only Session Authority

The main process would own refresh tokens and access tokens. The renderer and server requests would not rely on Supabase SSR cookie refresh.

Questions:

- How do server components and server actions receive the current Electron access token?
- Can protected server actions use an Authorization header or another signed Electron session transport?
- Can middleware validate Electron requests without reading stale Supabase cookies?
- Do we need Electron-specific API routes instead of direct server actions?

### Option C: Add A Server-Side Electron Session Bridge

Electron could maintain a server-recognized session separate from Supabase SSR cookies. Middleware would detect Electron and validate a desktop-issued or server-issued session marker, then server actions could resolve the user through a shared helper.

Questions:

- What token/session is safe to expose to the renderer?
- Can the main process attach auth to webview requests consistently?
- How do we rotate and revoke this session?
- How do we preserve RLS access if database calls still need Supabase user context?

### Option D: Move Electron Mutations Off Direct Server Actions

Electron-specific mutations could go through API routes or RPC endpoints where auth headers can be explicit and refresh can happen before the request.

Questions:

- Is it acceptable to diverge Electron from the web app transport layer?
- Which workflows require server actions for Next.js behavior?
- Can TanStack Query become the normal mutation layer and hide transport differences?
- How much server-rendered state should Electron continue using?

## Recommended Redesign Principles

Regardless of the chosen option, the redesign should follow these principles:

1. One refresh owner per runtime.
   Electron should not have Supabase browser auto-refresh, Supabase SSR refresh, and Electron IPC refresh all competing.

2. One durable token store.
   If Desktop and CLI share OAuth credentials, define one canonical credential record and make rotation atomic.

3. Server-side auth must match the token type.
   If Electron uses OAuth-issued refresh tokens, server-side code should not attempt standard cookie refresh with them.

4. Renderer recovery cannot be the only recovery path.
   Middleware and server actions run before renderer code. Electron auth recovery must account for that boundary.

5. Redirects must respect request type.
   Auth redirects for server actions and API-like requests should not return login HTML or method-preserving redirects that violate the caller protocol.

6. Login transport should not rely on one globally fixed port forever.
   The fixed loopback port can fail due to another app instance, a stale process, or local software occupying the port.

7. Auth diagnostics should be first-class.
   We should keep structured logs that distinguish expired cookie, missing cookie, stale refresh token, OAuth refresh failure, loopback bind failure, and user-not-found cases without logging secrets.

## Open Risks

- Clearing or bypassing stale cookies can force users through the login bridge more often if the main-process credential store is missing or invalid.
- Any design that preserves server components must solve auth before the RSC request reaches route rendering.
- Any design that moves Electron to API routes must manage divergence from the web app and avoid duplicating business logic.
- Any design that keeps shared Desktop/CLI OAuth credentials must handle refresh token rotation carefully to prevent one process from overwriting another with stale credentials.
- Supabase OAuth server behavior constrains callback URIs and refresh endpoint choices.

## Review Checklist

When evaluating redesign proposals, verify that the proposal answers:

- Who owns the Electron refresh token?
- Which code path is allowed to refresh it?
- How does a server action authenticate in Electron?
- How does an RSC request authenticate in Electron?
- What happens when the app wakes from sleep after token expiry?
- What happens when the refresh token rotates?
- What happens if the renderer has stale cookies but the main process has valid credentials?
- What happens if the main process has stale credentials but the renderer has valid cookies?
- How does the user recover from invalid credentials?
- How does logout clear every credential source?
- How do Desktop and CLI avoid overwriting each other's refresh tokens?
- How will Vercel/Sentry logs distinguish expected reauth from broken refresh?

## Conclusion

The Electron refresh problem is a structural mismatch between a cookie-authenticated Next.js web app and a desktop OAuth credential owner. The web app works because cookie auth is the single source of truth. Electron fails intermittently because the cookie session is only a mirror of a separate desktop session, but the server still treats it as authoritative and tries to refresh it through the wrong mechanism.

The patches can reduce failures, but the stable fix is a redesign that gives Electron one auth authority and makes server-side Next.js requests authenticate through that authority intentionally.
