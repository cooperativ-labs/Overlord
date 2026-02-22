# Code Review Report — 2026-02-14

## Summary

Full codebase review of the Orchestrator project (Next.js 16 + Supabase). The codebase is early-stage (~5 commits) with clean architecture, good validation patterns, and a well-structured database schema. However, there are several issues ranging from critical security gaps to DRY violations and leftover scaffolding.

**Severity summary: 3 Critical, 5 High, 8 Medium, 5 Low**

---

## Critical Issues

### 1. API routes bypass middleware auth — agents use Supabase server client as the user's session

- **Location:** `app/api/protocol/*/route.ts`, `lib/overlord/protocol-db.ts`
- **Category:** Security

The protocol API routes authenticate via a bearer token (`ensureAgentToken`), but then call `createClient()` from `supabase/utils/server.ts` which uses `cookies()` to create a Supabase client from the user's browser session. Since these are machine-to-machine API calls from agents, there is no user cookie session. Queries execute with whatever permissions an unauthenticated Supabase client has.

**Recommendation:** Create a dedicated Supabase admin/service-role client for protocol routes:

```ts
// supabase/utils/service.ts
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createServiceClient() {
  return createSupabaseClient(
    getSupabaseUrl(),
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
```

### 2. SQL pattern injection via `ilike` with unsanitized `query` parameter

- **Location:** `app/api/protocol/read-context/route.ts:30`
- **Category:** Security

```ts
stateQuery = stateQuery.ilike('state_key', `%${query}%`);
```

The `query` value is interpolated directly into the `ilike` pattern without escaping `%` and `_` wildcards.

**Recommendation:** Escape SQL pattern characters:

```ts
const escaped = query.replace(/[%_\\]/g, '\\$&');
stateQuery = stateQuery.ilike('state_key', `%${escaped}%`);
```

### 3. Middleware doesn't protect API routes for agent protocol

- **Location:** `middleware.ts`, `supabase/utils/proxy.ts:38-44`
- **Category:** Security

The middleware redirects unauthenticated users to `/login` for all non-public paths. `/api/protocol/*` is not in the public paths list, so the middleware calls `supabase.auth.getUser()` for agent API requests (which have no cookies) and redirects them to `/login`.

**Recommendation:** Add `/api` to the public paths list:

```ts
const publicPaths = ['/login', '/auth', '/confirm-email', '/privacy', '/terms', '/api'];
```

---

## High Priority

### 4. N+1 query pattern in `reorderTicketsAction`

- **Location:** `lib/actions/tickets.ts:129-137`
- **Category:** Inefficiency

Each ticket reorder fires a separate `UPDATE` query in a loop. Dragging a ticket in a column with 20 items sends 20+ sequential database calls.

**Recommendation:** Use a single RPC call or batch update via a Postgres function.

### 5. Duplicate page: `app/page.tsx` and `app/tickets/page.tsx` are near-identical

- **Location:** `app/page.tsx`, `app/tickets/page.tsx`
- **Category:** DRY Violation

These two files contain the same `statusOrder`, `sortByStatus` function, and nearly identical page logic. The root page queries `ticket_statuses` while the tickets page queries `board_columns` (which does not exist in the schema — will fail at runtime).

**Recommendation:** Either redirect `/` to `/tickets` or extract shared logic. Fix the `board_columns` reference to use `ticket_statuses`.

### 6. RLS policies are fully permissive for local dev

- **Location:** `supabase/migrations/20260214125337_init-squash.sql`
- **Category:** Security

Many tables have `FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)` policies. Must be replaced before production deployment.

**Recommendation:** Replace anon-permissive policies with proper role-based checks before deploying.

### 7. Sidebar is scaffolding with hardcoded sample data

- **Location:** `components/app-sidebar.tsx`
- **Category:** Poor Practice

The sidebar contains hardcoded mail sample data, "Acme Inc" branding, and dummy navigation items (Inbox, Drafts, Sent, Junk, Trash) unrelated to the overlord app. Nav items link to `#` and randomly shuffle sample emails on click.

**Recommendation:** Replace with actual navigation items (Tickets, Settings, etc.) and remove all sample data.

### 8. Social login buttons don't work

- **Location:** `components/forms/auth-form.tsx:147-175`
- **Category:** Potential Bug

The "Continue with Apple" and "Continue with Google" buttons have `type="button"` but no `onClick` handlers.

**Recommendation:** Implement OAuth flows or remove the buttons.

---

## Medium Priority

### 9. `Ticket` type is duplicated across files

- **Location:** `app/tickets/(components)/KanbanCard.tsx:10-18`, `app/tickets/(components)/TicketListView.tsx:6-14`
- **Category:** DRY Violation

Two separate `Ticket` type definitions with slightly different fields.

**Recommendation:** Create a single shared type in `lib/overlord/types.ts`.

### 10. Type mismatch between DB enum and app-level status values

- **Location:** `lib/overlord/types.ts`, migration SQL
- **Category:** Potential Bug

The `ticket_status_type` DB enum has 4 values (`draft, execute, review, complete`). The app code `ticketStatuses` has 8 values (`draft, review, refine, execute, deliver, complete, blocked, cancelled`). The `tickets.status` column is `text`, so it works at runtime, but the enum is misleading.

**Recommendation:** Either expand the DB enum or remove it since `text` is used in practice.

### 11. Missing error reporting to Sentry

- **Location:** All server actions and API routes
- **Category:** Error Handling

CLAUDE.md specifies Sentry for error tracking and `@sentry/nextjs` is a dependency, but no file imports or calls Sentry.

**Recommendation:** Add `Sentry.captureException(error)` to catch blocks in server actions and API routes.

### 12. Server actions throw errors instead of returning them

- **Location:** `lib/actions/tickets.ts`
- **Category:** Error Handling

`createTicketAction` and `updateTicketAction` throw `new Error(...)` on failures. When used with form actions, unhandled throws produce poor UX.

**Recommendation:** Return `{ error: string }` objects and handle them in the UI with `useActionState`.

### 13. `updateTicketStatusAction` has no status validation

- **Location:** `lib/actions/tickets.ts:104`
- **Category:** Security / Validation

The `status` parameter is an arbitrary string with no validation.

**Recommendation:** Validate against `ticketStatuses` or the organization's status list.

### 14. No `database.types.ts` generated — queries are untyped

- **Location:** Project-wide
- **Category:** Type Safety

CLAUDE.md references `types/database.types.ts` but this file doesn't exist. All Supabase queries are untyped.

**Recommendation:** Run `yarn generate` and pass the generated type to `createClient<Database>()`.

### 15. NavUser "Log out" button has no action

- **Location:** `components/nav-user.tsx:106-108`
- **Category:** Potential Bug

The dropdown "Log out" item has no `onClick` handler. Sign-out only works from the header bar.

**Recommendation:** Wire up the `signOut` action to the dropdown item.

### 16. `New Ticket` link points to wrong path

- **Location:** `app/layout.tsx:60`
- **Category:** Potential Bug

```tsx
<Link href="/new">New Ticket</Link>
```

The new ticket page is at `/tickets/new`, not `/new`. This link will 404.

**Recommendation:** Change to `href="/tickets/new"`.

---

## Low Priority / Suggestions

### 17. `proxy.ts` export name mismatch

- **Location:** `middleware.ts:1`
- **Category:** Consistency

The middleware exports `proxy as default` from `@/supabase/utils/proxy`, but `proxy.ts` exports `updateSession` (not `proxy`).

### 18. `statusOrder` array duplicated in two files

- **Location:** `app/page.tsx:9-18`, `app/tickets/page.tsx:9-18`
- **Category:** DRY Violation

Should be imported from `lib/overlord/types.ts`.

### 19. Missing `loading.tsx` and `error.tsx` boundary files

- **Location:** `app/` directory
- **Category:** Maintainability

No loading or error boundary files exist. Users see no feedback during page transitions.

### 20. Select elements use raw HTML instead of shadcn Select

- **Location:** `app/tickets/new/page.tsx:71`, `app/tickets/[ticketId]/page.tsx:179`, `app/tickets/[ticketId]/edit/page.tsx:116`
- **Category:** Consistency

Raw `<select>` elements with manual styling instead of the shadcn `Select` component.

### 21. Unused dependencies in `package.json`

- **Location:** `package.json`
- **Category:** Maintainability

Potentially unused: `browser-image-compression`, `resend`, `next-pwa`, `next-themes`, `@tailwindcss/typography`. Dev types for unused packages: `@types/katex`, `@types/browser-image-compression`, `@types/date-fns`.

---

## Positive Observations

- Clean validation layer with Zod schemas consistently applied to all API inputs
- Timing-safe comparison in `protocol-auth.ts` prevents timing attacks
- Well-designed database schema with foreign keys, indexes, and generated columns
- Optimistic UI in KanbanBoard using `useOptimistic` with `useTransition`
- Consistent code style and well-organized imports
- Good separation of concerns across protocol routes, validation, DB helpers, and types

---

## Recommended Fix Order

1. **Immediate (Critical):** Fix middleware to allow `/api` routes; create service-role Supabase client for protocol routes; escape `ilike` patterns
2. **Before deploying:** Replace permissive RLS policies; generate database types; add Sentry integration
3. **Soon:** Remove scaffolding sidebar; fix duplicate pages; consolidate `Ticket` type; fix broken links (`/new` → `/tickets/new`)
4. **Ongoing:** Add `loading.tsx`/`error.tsx` boundaries; return errors from server actions instead of throwing; add tests; clean unused dependencies
