# Full Webapp Code Review - 2026-05-22

## Scope

Reviewed the entire Overlord webapp: API routes (22 protocol endpoints + auth/mcp/tickets), server actions (40+ files in `lib/actions/`), authentication layer, React components (~170+ files), database migrations, edge functions, Supabase client patterns, and security configuration.

---

## Summary

The codebase is well-structured and demonstrates mature engineering practices. Key strengths include consistent Zod validation on all protocol API routes, proper RLS enforcement, clean separation of server/client Supabase clients, and good security headers in `next.config.ts`. The issues found are primarily medium/low severity with a few areas warranting attention.

---

## Findings

### Security

#### S1: Auth Callback Open Redirect (Low)
**File:** `apps/web/app/auth/callback/route.ts:8-14`
**Issue:** The `next` query parameter is used directly in a redirect: `NextResponse.redirect(\`${origin}${next}\`)`. While the server action layer (`lib/actions/auth.ts`) has `sanitizeNextPath` which validates paths properly (rejecting `//` prefixes), the auth callback route does not apply this sanitization. The risk is mitigated because `origin` is prepended (so `//evil.com` becomes `https://ovld.ai//evil.com`, which browsers resolve as a path), but defense-in-depth best practice suggests applying `sanitizeNextPath` here too.
**Recommendation:** Apply the same `sanitizeNextPath` validation used in `lib/actions/auth.ts` to this route.

#### S2: Admin Authorization - Single Email Hardcoded (Low)
**File:** `lib/auth/admin.ts:1`
**Issue:** Admin authorization is a hardcoded email check: `ADMIN_EMAIL = 'jake@cooperativ.io'`. While this works for a single-admin setup and is properly enforced on both the page level (`app/(app)/admin/page.tsx:121`) and action level (`lib/actions/admin-features.ts:34`, `lib/actions/admin-agent-models.ts:10`), it doesn't scale.
**Recommendation:** Move admin designation to a database role or column when adding more admins.

#### S3: Service Role Client Used Extensively in Protocol Routes (Medium - by design)
**File:** All `apps/web/app/api/protocol/*/route.ts` files
**Issue:** All 22 protocol API routes use `createServiceRoleClient()` (bypasses RLS) rather than `createClientForRequest()` (respects RLS). This is by design since protocol requests authenticate via bearer tokens rather than cookies, but it means every query in every protocol route bypasses RLS. The auth layer (`parseProtocolBody` -> `resolveAgentToken`) properly validates the bearer token and org membership before any DB queries, and organization scoping is enforced manually via `.eq('organization_id', ...)`.
**Recommendation:** This pattern is acceptable since protocol auth is well-implemented. Ensure all new protocol routes consistently apply the `organizationId` filter from `tokenContext`. Consider adding a linting rule or code comment convention to flag when org scoping is intentionally omitted.

#### S4: No CSP Header on Main Pages (Low)
**File:** `apps/web/next.config.ts:13-37`
**Issue:** The security headers include `X-Frame-Options`, `X-Content-Type-Options`, `HSTS`, and `Permissions-Policy`, but no `Content-Security-Policy` header for the main application (only `/sw.js` has one). This leaves the app without script-source restrictions.
**Recommendation:** Add a CSP header. Given the Next.js architecture with inline scripts, start with `script-src 'self' 'unsafe-inline'` and progressively tighten using nonces.

#### S5: MCP Proxy CORS Allows All Origins (Low)
**File:** `apps/web/app/api/mcp/route.ts:20-27`
**Issue:** `Access-Control-Allow-Origin: '*'` on the MCP proxy endpoint. This is by design for MCP clients (which connect from various origins and tools), but it's worth noting that any origin can make authenticated requests to this endpoint if they have a valid bearer token.
**Recommendation:** Acceptable for the MCP use case. Document the rationale.

### Code Quality

#### Q1: Duplicate Session Close in Deliver Route (Low)
**File:** `apps/web/app/api/protocol/deliver/route.ts:149-155, 243-248`
**Issue:** The `after()` callback closes the agent session twice: once at line 149 (immediately after marking the objective complete) and again at line 243 (as part of the ticket status update block). The second update is redundant since the session is already closed.
**Recommendation:** Remove the duplicate session update at lines 243-248.

#### Q2: Large tickets.ts Server Action File (Medium)
**File:** `lib/actions/tickets.ts` (2,645 lines)
**Issue:** This is the largest file in the codebase and contains 30+ exported actions covering ticket CRUD, board operations, objective management, scheduling, prompt generation, and board data loading. While each function is well-structured, the file's size makes it harder to navigate and maintain.
**Recommendation:** Consider splitting into focused modules: `ticket-crud.ts`, `ticket-board.ts`, `ticket-objectives.ts`, `ticket-prompts.ts`.

#### Q3: Realtime Hook Complexity (Medium)
**File:** `apps/web/app/(app)/tickets/(components)/useTicketBoardRealtime.ts` (836 lines)
**Issue:** This hook manages Supabase realtime subscriptions, audio notifications, desktop notifications, waiting states, objective sync, and board reconciliation. It's doing a lot of work in a single hook. However, the logic is cohesive and the 30-second polling fallback (`setInterval` at line 804) is a good safety net.
**Recommendation:** Consider extracting the notification logic (audio + desktop) into a separate hook and the waiting-state tracking into its own module.

#### Q4: Board Ticket Data N+1 Pattern Mitigated (Good)
**File:** `lib/actions/tickets.ts:2391-2424`
**Issue:** The `getTicketBoardBootstrapAction` correctly batches objective and session lookups by collecting ticket IDs and performing a single query with `.in('ticket_id', ticketIds)`, avoiding N+1 queries. This is a good pattern.

### Architecture & Patterns

#### A1: Consistent Protocol Route Pattern (Good)
All protocol routes follow the same pattern: `parseProtocolBody` -> validate schema -> `resolveTicketId` -> `resolveSession` -> business logic -> `internalErrorResponse` catch. This consistency makes the codebase predictable and auditable.

#### A2: Proper Server/Client Component Separation (Good)
The app properly separates server components (page.tsx files doing data fetching) from client components (marked with `'use client'`). No instances of server-side secrets leaking to client components were found.

#### A3: No XSS Vectors Found (Good)
- No `dangerouslySetInnerHTML` usage anywhere in the codebase
- Markdown rendering uses `react-markdown` with `remarkGfm` (safe by default - no `rehypeRaw`)
- No `eval()` or `Function()` usage
- Only 1 `eslint-disable` comment in the entire webapp

#### A4: Type Safety (Good)
- Zero `any` types found in `lib/actions/tickets.ts` and `lib/overlord/*.ts`
- Zod schemas used for all protocol input validation with proper max lengths
- Database types generated from Supabase schema

#### A5: `after()` Used for Non-Critical Background Work (Good)
**File:** `apps/web/app/api/protocol/deliver/route.ts:135`
The deliver route uses Next.js `after()` to defer non-critical work (artifact insertion, feed post generation, status updates, push notifications) after returning a fast 200 response. This is a good pattern for agent-facing endpoints where latency matters.

### Database & Migrations

#### D1: Migration Quality (Good)
The recent migrations (`20260521120000_agent_sessions_objective_ownership.sql`) demonstrate careful data migration practices: backfill with fallback strategies, validation checks that raise exceptions on unexpected state, proper index creation, and comprehensive RLS policy rewrites.

#### D2: RLS Properly Enforced (Good)
- `execution_requests` table has RLS enabled with granular policies
- `agent_sessions` policies properly join through `objectives` -> `tickets` for org membership checks
- Role-based access control uses `has_org_role()` with explicit role arrays

#### D3: Edge Function Auth (Good)
**File:** `supabase/functions/mcp/auth.ts`
The MCP edge function supports both OAuth JWT (with JWKS verification) and agent tokens (with SHA-256 hash lookup). Organization membership is verified for all auth methods. The `deno-lint-ignore-file no-explicit-any` at the top is worth cleaning up.

### Performance

#### P1: Board Bootstrap Parallel Status Loading (Good)
**File:** `lib/actions/tickets.ts:2372-2383`
Board data loading parallelizes per-status ticket fetching with `Promise.all(statuses.map(...))`. This is efficient for the typical 5-7 status columns.

#### P2: Realtime Polling Interval (Acceptable)
**File:** `useTicketBoardRealtime.ts:804`
The 30-second `setInterval` for `syncBoardData()` is reasonable as a safety net when Supabase Realtime drops events. It's not heavy since it reuses existing Supabase client connections.

#### P3: Audio Element Preload (Good)
**File:** `useTicketBoardRealtime.ts:283-299`
Audio elements are created once and preloaded, avoiding re-creation on each notification.

### Error Handling

#### E1: Consistent Sentry Integration (Good)
Server actions and API routes consistently use `Sentry.captureException()` for unexpected errors. The `internalErrorResponse()` helper in `_lib.ts` ensures all protocol errors are logged and reported.

#### E2: Fire-and-Forget Patterns Properly Handled (Good)
Several places use fire-and-forget patterns (feed post generation, title generation, push notifications) with `.catch()` handlers that log but don't propagate errors. This prevents non-critical failures from breaking the main flow.

---

## Summary of Actionable Items

| Priority | Finding | Action |
|----------|---------|--------|
| Low | S1: Auth callback open redirect | Apply `sanitizeNextPath` to callback route |
| Low | S4: No CSP header | Add Content-Security-Policy header |
| Low | Q1: Duplicate session close | Remove redundant session update in deliver route |
| Medium | Q2: Large tickets.ts | Consider splitting into focused modules |
| Medium | Q3: Realtime hook complexity | Extract notification and waiting-state logic |

---

## Overall Assessment

**Rating: Strong**

The codebase demonstrates solid engineering practices across security, type safety, error handling, and architecture. The auth layer is well-designed with proper token validation, org membership checks, and timing-safe secret comparison. Database patterns follow Supabase best practices with consistent RLS enforcement. The main areas for improvement are organizational (file sizes, hook complexity) rather than correctness or security issues.
