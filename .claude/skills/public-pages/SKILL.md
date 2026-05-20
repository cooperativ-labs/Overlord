---
name: public-pages
description: Use when adding or changing pages that must be reachable without signing in. Requires updating lib/auth/public-routes.ts so middleware and the web auth gate allow unauthenticated access.
---

# public-pages

Apply this skill whenever you create or modify a route that should be **publicly accessible** (no Supabase session required).

## Why this matters

`lib/auth/public-routes.ts` is the single source of truth for unauthenticated access. It is used by:

- **Middleware** — `supabase/utils/proxy.ts` skips auth redirects when `isPublicRoute(pathname)` is true.
- **Client auth gate** — `apps/web/components/features/auth/WebAuthGate.tsx` skips session validation on public paths.

If you add a `page.tsx` (or other route) but forget to register it here, signed-out users are redirected to login even though the page exists.

## Required workflow

### 1. Confirm the route should be public

Public pages include marketing, legal, docs, demos, auth flows (login/signup), OAuth callbacks, and other intentionally anonymous surfaces. App pages under `/[organizationId]/` and most authenticated product UI are **not** public unless explicitly requested.

### 2. Register the path in `lib/auth/public-routes.ts`

Open `lib/auth/public-routes.ts` and add the path to **one** of:

| List | Use when |
|------|----------|
| `PUBLIC_EXACT_PATHS` | A single URL with no meaningful child segments (e.g. `/privacy`, `/terms`). |
| `PUBLIC_PATH_PREFIXES` | A section and all nested routes (e.g. `/docs/` → `/docs/...`, `/presentations/` → slide decks). |

Rules:

- Paths must match the **URL pathname** (leading slash, no query string), same as `request.nextUrl.pathname` / `usePathname()`.
- For a section with both an index and nested pages, register the index in `PUBLIC_EXACT_PATHS` and the subtree prefix in `PUBLIC_PATH_PREFIXES` (see `/changelog` + `/changelog/`).
- Prefer a **trailing slash** on prefixes when another route could share the same prefix (e.g. `/changelog/` avoids treating `/changelogging` as public). `startsWith` is used for prefix matching.
- Do not duplicate entries already covered by an existing prefix unless the index path would otherwise be missed.

### 3. Add or update tests

Extend `tests/lib/auth/public-routes.test.ts` with cases for:

- The new exact path or a representative nested path under a new prefix.
- At least one **negative** case if prefix matching could be ambiguous (e.g. a similar but unrelated path must stay private).

Run:

```bash
yarn test tests/lib/auth/public-routes.test.ts
```

### 4. Verify behavior

- Signed-out navigation to the new path should **not** redirect to `/login`.
- Signed-in users should still reach the page normally.
- If the page is linked from marketing/docs nav, ensure hrefs use the same pathname you registered.

## Checklist (do not skip)

- [ ] Route file(s) created or updated under `apps/web/app/` (or appropriate app)
- [ ] Path added to `PUBLIC_EXACT_PATHS` or `PUBLIC_PATH_PREFIXES` in `lib/auth/public-routes.ts`
- [ ] Tests added/updated in `tests/lib/auth/public-routes.test.ts`
- [ ] Confirmed no accidental public access (only intended paths registered)

## Examples

### Single static page (`/about`)

```ts
// lib/auth/public-routes.ts — PUBLIC_EXACT_PATHS
'/about',
```

```ts
// tests/lib/auth/public-routes.test.ts
expect(isPublicRoute('/about')).toBe(true);
expect(isPublicRoute('/about/team')).toBe(false);
```

### Docs subtree (`/docs` + `/docs/...`)

```ts
// PUBLIC_EXACT_PATHS
'/docs',

// PUBLIC_PATH_PREFIXES
'/docs/',
```

```ts
expect(isPublicRoute('/docs')).toBe(true);
expect(isPublicRoute('/docs/surfaces/cli')).toBe(true);
```

### Removing public access

When retiring or gating a page behind auth, remove its entry from `public-routes.ts` and delete or adjust the corresponding tests.

<!-- version: 1.1.0 -->
