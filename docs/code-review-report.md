# Codebase Review Report

**Date:** 2026-03-12
**Scope:** Full codebase — focus on DRY violations, modularity, and legacy/unnecessary code
**Severity Summary:** 5 Critical, 11 High, 14 Medium, 8 Low

---

## Table of Contents

1. [Critical Issues](#1-critical-issues)
2. [DRY Violations](#2-dry-violations)
3. [Modularity Improvements](#3-modularity-improvements)
4. [Legacy & Unnecessary Code](#4-legacy--unnecessary-code)
5. [Security & Bug Risks](#5-security--bug-risks)
6. [Positive Observations](#6-positive-observations)
7. [Recommendations Summary](#7-recommendations-summary)

---

## 1. Critical Issues

### C1. `isRecord()` type guard duplicated 6 times

**Severity:** Critical (DRY)
**Locations:**
- `app/tickets/(components)/KanbanBoard.tsx:93`
- `lib/overlord/agent-notifications.ts:13`
- `lib/overlord/conversation.ts:9`
- `lib/actions/everhour.ts:63`
- `lib/hooks/use-ticket-realtime.ts:53`
- `lib/helpers/ticket-waiting-response.ts:13`

All 6 files contain the exact same function:
```typescript
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

**Recommendation:** Extract to `lib/helpers/type-guards.ts` and import everywhere.

---

### C2. Authentication boilerplate repeated 36+ times across server actions

**Severity:** Critical (DRY)
**Locations:** Every file in `lib/actions/` (79 `createClient()` calls, 36 `auth.getUser()` calls across 19 files)

The pattern below is copy-pasted in nearly every server action:
```typescript
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  throw new Error('Unauthorized'); // Message varies: 'Unauthorized', 'User not authenticated', 'You must be signed in.'
}
```

`ai-connections.ts` already extracted this into a `getAuthenticatedUser()` helper (line 24), but **no other file reuses it**.

**Recommendation:** Create a shared `requireAuth()` in `lib/actions/_helpers.ts`:
```typescript
export async function requireAuth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  return { supabase, user };
}
```
This eliminates ~100 lines of boilerplate and standardizes error messages.

---

### C3. OAuth initiate routes are near-identical copy-paste

**Severity:** Critical (DRY)
**Locations:**
- `app/api/auth/claude-code/initiate/route.ts` (68 lines)
- `app/api/auth/codex/initiate/route.ts` (70 lines)

These files are ~95% identical. The only differences:
- Auth URL (`claude.ai` vs `auth.openai.com`)
- Scope string
- Cookie name prefix (`claude_` vs `codex_`)
- Client ID env var name
- Codex adds an `audience` param

**Recommendation:** Extract a `createOAuthInitiateHandler(config)` factory in `lib/auth/oauth-initiate.ts`.

---

### C4. OAuth callback routes are near-identical copy-paste

**Severity:** Critical (DRY)
**Locations:**
- `app/api/auth/claude-code/callback/route.ts` (113 lines)
- `app/api/auth/codex/callback/route.ts` (113 lines)

These files are ~98% identical. Only the token URL, provider name, cookie prefix, and env var name differ.

**Recommendation:** Extract a `createOAuthCallbackHandler(config)` factory in `lib/auth/oauth-callback.ts`.

---

### C5. `getEventPayload()` duplicated with different signatures

**Severity:** Critical (DRY)
**Locations:**
- `lib/overlord/conversation.ts:13` — exported, takes `TicketEvent`
- `lib/hooks/use-ticket-realtime.ts:57` — private, takes `JsonValue`

Both extract a `Record<string, unknown>` from an event payload but accept different input types.

**Recommendation:** Export the one from `conversation.ts` and adapt the hook to use it, or create a shared lower-level version.

---

## 2. DRY Violations

### D1. KanbanCard and TicketListCard share extensive duplicate logic

**Severity:** High
**Locations:**
- `app/tickets/(components)/KanbanCard.tsx`
- `app/tickets/(components)/TicketListCard.tsx`

Both components duplicate:
- Priority change handler (`handlePriorityChange` with `useTransition`)
- Agent running state derivation (`isAgentRunning`, `hasUnopenedWaitingResponse`, `hasUnopenedReview`)
- Active agent identifier resolution (`running_agent ?? recent_agent ?? assigned_agent`)
- `ActiveAgentDisplay` rendering (agent icon + label)
- Project color dot rendering
- Status dot rendering (red/sky dots)
- Context menu with raise/reduce priority and mark-unread items
- Objectives executed count badge

**Recommendation:** Extract shared pieces:
- `useTicketCardState(ticket)` hook for derived state
- `<TicketContextMenu>` component for the shared context menu
- `<ActiveAgentBadge>` component for agent display
- `<ProjectColorDot>` component

---

### D2. Ticket metadata fetching repeated across actions

**Severity:** High
**Locations:** `lib/actions/tickets.ts` (~15 times), `lib/actions/artifacts.ts` (3 times), `lib/actions/everhour.ts` (3 times)

The pattern of fetching `organization_id, project_id` from a ticket by ID is repeated with inconsistent field selections.

**Recommendation:** Create a `getTicketMetadata(supabase, ticketId)` helper that returns the commonly needed fields.

---

### D3. Revalidation patterns inconsistent and duplicated

**Severity:** High
**Locations:** 48 `revalidatePath` calls across 7 files

- `tickets.ts` has helper functions `revalidateTicketBoards()` and `revalidateTicketDetails()`
- `projects.ts` has `revalidateProjectPaths()`
- `everhour.ts` has inline loops revalidating every project path
- Other files call `revalidatePath()` directly with hardcoded strings

**Recommendation:** Consolidate into a `lib/actions/_revalidation.ts` module with shared helpers.

---

### D4. `fetchClaudeUsage` and `fetchCodexUsage` share structure

**Severity:** Medium
**Location:** `lib/actions/ai-connections.ts:89-131`

Both functions follow the same pattern: fetch URL with auth header, check response, parse JSON, extract windows. Only the URL, headers, and field mapping differ.

**Recommendation:** Create a generic `fetchAiUsage(url, headers, fieldMap)` function.

---

### D5. Upsert-with-merge pattern repeated

**Severity:** Medium
**Locations:**
- `lib/actions/agent-config.ts:87-109`
- `lib/actions/project-user-preferences.ts:61-70`
- `lib/actions/profile-settings.ts`

All follow: read existing → parse → merge with patch → upsert back.

**Recommendation:** Extract a `mergeAndUpsert(table, key, defaults, patch)` utility.

---

### D6. Password validation duplicated

**Severity:** Low
**Location:** `lib/actions/account.ts:90-92` and `lib/actions/account.ts:121-123`

Both `updatePasswordAction` and `setPasswordAction` check `!newPassword || newPassword.length < 8` with slightly different error messages.

**Recommendation:** Extract a `validatePassword(password)` helper.

---

## 3. Modularity Improvements

### M1. `lib/actions/tickets.ts` is too large (~1100+ lines)

**Severity:** High
**Location:** `lib/actions/tickets.ts`

This file contains 20+ exported functions handling ticket CRUD, objectives, prompt building, board ordering, read/unread state, and more. It's the largest file in the codebase.

**Recommendation:** Split into focused modules:
- `lib/actions/ticket-crud.ts` — create, update, delete
- `lib/actions/ticket-objectives.ts` — objective management
- `lib/actions/ticket-prompt.ts` — prompt building (already partially in `lib/overlord/ticket-prompt.ts`)
- `lib/actions/ticket-board.ts` — reordering, column operations
- Keep a `lib/actions/tickets.ts` barrel export for backward compatibility

---

### M2. `lib/actions/everhour.ts` is too large (~850 lines)

**Severity:** High
**Location:** `lib/actions/everhour.ts`

Contains API client, timer management, project sync, time records, and settings — all in one file.

**Recommendation:** Split into:
- `lib/actions/everhour/api-client.ts` — `everhourFetch()` and base request logic
- `lib/actions/everhour/timer.ts` — timer start/stop/status
- `lib/actions/everhour/sync.ts` — project synchronization
- `lib/actions/everhour/time-records.ts` — time record listing

---

### M3. Protocol routes could use a handler registry pattern

**Severity:** Medium
**Locations:** `app/api/protocol/*/route.ts` (14 route files)

Each protocol route follows the same pattern:
```typescript
export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, schema);
  if (!parsed.ok) return parsed.errorResponse;
  try {
    const result = await handler(parsed.data, parsed.tokenContext);
    return NextResponse.json(result);
  } catch (error) {
    return internalErrorResponse(error);
  }
}
```

The `_lib.ts` helper is good but each route still repeats the try/catch wrapper.

**Recommendation:** Create a `createProtocolRoute(schema, handler)` factory that handles the full pattern.

---

### M4. No shared error handling middleware for server actions

**Severity:** Medium
**Location:** All files in `lib/actions/`

Every action manually wraps errors. There's no consistent pattern for:
- Logging to Sentry
- Returning user-friendly messages
- Handling Supabase-specific error codes

**Recommendation:** Create a `withActionErrorHandling(fn)` wrapper or use a decorator pattern.

---

### M5. Ticket type definition is not centralized

**Severity:** Medium
**Locations:**
- `app/tickets/(components)/KanbanCard.tsx:30-54` — defines `Ticket` type
- `app/tickets/(components)/TicketListCard.tsx` — imports from KanbanCard
- Various server actions return different subsets of ticket fields

**Recommendation:** Define canonical `TicketSummary` and `TicketDetail` types in `types/` and use them across components and actions.

---

## 4. Legacy & Unnecessary Code

### L1. `uploadImageArtifactAction` uses local filesystem

**Severity:** High
**Location:** `lib/actions/artifacts.ts:12-109`

This function saves artifacts to the local filesystem at `.overlord/artifacts/`, while `uploadTicketDocumentAction` (line 124) uses Supabase Storage. Two completely different storage mechanisms for the same concept.

The filesystem approach:
- Won't work on Vercel (no persistent filesystem)
- Doesn't have auth checks (no `getUser()` call)
- Uses an unused `organizationId` parameter (line 14)
- Creates records with `uri` (filesystem path) instead of `storage_path`

**Recommendation:** Migrate to Supabase Storage and deprecate/remove the filesystem approach. If local storage is needed for Electron, gate it behind an environment check.

---

### L2. Everhour time records function tries 9 API endpoints

**Severity:** Medium
**Location:** `lib/actions/everhour.ts` — `listTimeRecordsForTicket()` function

This function cycles through 9 different Everhour API endpoint variations with fallbacks, suggesting historical API instability.

**Recommendation:** Audit which endpoint is actually being used successfully and remove the dead fallbacks.

---

### L3. `extractWindow()` handles 3 field name variants per property

**Severity:** Medium
**Location:** `lib/actions/ai-connections.ts:60-87`

Handles `usage`/`used`/`count` for usage, `limit`/`max` for limit, and `resets_at`/`reset_at`/`resets_at_ms` for reset time. This suggests adapting to unstable external APIs.

**Recommendation:** Document which provider uses which fields. Consider separate extractors per provider for clarity.

---

### L4. `revalidateTicketBoards` ignores its parameter

**Severity:** Low
**Location:** `lib/actions/tickets.ts:24-28`

```typescript
function revalidateTicketBoards(organizationIds: Iterable<number>) {
  void organizationIds; // explicitly discarded
  revalidatePath('/u');
  revalidatePath('/projects');
}
```

The function accepts `organizationIds` but immediately discards it. This is leftover from when organization-scoped paths were revalidated.

**Recommendation:** Remove the parameter.

---

### L5. `ticket-waiting-response.ts` has backward-compatible parsing

**Severity:** Low
**Location:** `lib/helpers/ticket-waiting-response.ts:19-20`

Contains backward compatibility for an old `{ [ticketId]: number }` storage format.

**Recommendation:** If the old format is no longer in use, remove the compatibility layer.

---

### L6. `view-preference.ts` is a 31-line file for cookie read/write

**Severity:** Low
**Location:** `lib/actions/view-preference.ts`

This entire server action file just reads/writes a single cookie. Could be a utility function instead of a server action module.

---

## 5. Security & Bug Risks

### S1. Potential logic bug in agent-tokens error check

**Severity:** High
**Location:** `lib/actions/agent-tokens.ts:34`

```typescript
if (error && !data) {
  throw new Error(error.message ?? 'Failed to load agent token.');
}
```

Uses `&&` instead of `||`. If there's an error AND data is truthy, the error is silently ignored and the (potentially corrupt) data is returned.

**Recommendation:** Change to `if (error || !data)` or handle error and data separately.

---

### S2. `uploadImageArtifactAction` missing auth check

**Severity:** High
**Location:** `lib/actions/artifacts.ts:12-109`

Unlike `uploadTicketDocumentAction` (which calls `supabase.auth.getUser()`), the filesystem upload function has no authentication check. Any caller could write files to the server.

**Recommendation:** Add auth check or remove this function (see L1).

---

### S3. Silent error on ticket event inserts

**Severity:** Medium
**Locations:**
- `lib/actions/artifacts.ts:88-93` — `ticket_events` insert result unchecked
- `lib/actions/artifacts.ts:191-196` — same
- `lib/actions/tickets.ts:881` — `markTicketReadAction` has no error handling

**Recommendation:** At minimum, log failures to Sentry even if not thrown to the user.

---

### S4. Race condition in token rotation

**Severity:** Medium
**Location:** `lib/actions/agent-tokens.ts:66-88`

`rotateAgentTokenAction` revokes all tokens (line 66-74), then creates a new one (line 76-84) in two separate operations. Between revoke and create, the user has zero valid tokens. If the insert fails, all tokens are revoked with no recovery.

**Recommendation:** Use a database transaction or create-then-revoke pattern.

---

### S5. Transaction safety in onboarding

**Severity:** Medium
**Location:** `lib/actions/onboarding.ts:91-102`

After creating an organization via RPC, a token is inserted separately. If the token insert fails, the organization exists but the user has no token.

**Recommendation:** Wrap in a transaction or handle the failure gracefully.

---

### S6. `as any` usage

**Severity:** Low
**Locations:**
- `next.config.ts:56` — `as any as NextConfig`
- `components/pwa/InstallPrompt.tsx:16` — `(window as any).MSStream`

Minimal `as any` usage — only 2 instances, both in edge cases. Good discipline overall.

---

### S7. Unsafe type casting in artifact metadata

**Severity:** Medium
**Location:** `lib/actions/artifacts.ts:234-235`

```typescript
fileType: ((a.metadata as Record<string, unknown>)?.type as string) ?? '',
fileSize: ((a.metadata as Record<string, unknown>)?.size as number) ?? 0,
```

Double cast with no runtime validation. If metadata structure changes, this silently returns wrong types.

**Recommendation:** Use a Zod schema or runtime check for metadata parsing.

---

## 6. Positive Observations

1. **Strong TypeScript usage** — Only 2 `as any` casts in the entire codebase. Types are generated from Supabase and used consistently.

2. **Good protocol layer design** — `app/api/protocol/_lib.ts` provides a clean `parseProtocolBody()` abstraction with Zod validation and auth in one call.

3. **Consistent Zod v4 usage** — Schema validation uses modern Zod patterns throughout `lib/schemas/` and `lib/overlord/validation.ts`.

4. **Well-structured helper modules** — `lib/helpers/ticket-path.ts`, `lib/helpers/color.ts`, `lib/helpers/agent-types.ts` are focused, single-responsibility modules.

5. **Good revalidation helpers in tickets.ts** — `revalidateTicketBoards()` and `revalidateTicketDetails()` are the right pattern, just need to be shared more broadly.

6. **Clean UI component structure** — shadcn/ui components in `components/ui/` are properly separated from feature components.

7. **No TODO/FIXME/HACK comments** — The codebase has zero markers for known technical debt (though some exists unmarked).

8. **Proper `'use server'` directives** — All 16 action files correctly declare the directive.

9. **Good use of `maybeSingle()` vs `single()`** — Supabase queries appropriately use `maybeSingle()` when the row may not exist.

10. **LoadingButton pattern** — Async operations use `useTransition` for loading states consistently.

---

## 7. Recommendations Summary

### Immediate (Week 1) — High-Impact DRY Fixes

| # | Action | Files Affected | Lines Saved (est.) |
|---|--------|---------------|-------------------|
| 1 | Extract `requireAuth()` helper | 19 files | ~100 lines |
| 2 | Extract `isRecord()` to shared module | 6 files | ~30 lines |
| 3 | Extract `getEventPayload()` to shared module | 2 files | ~15 lines |
| 4 | Create OAuth initiate/callback factories | 4 files | ~180 lines |
| 5 | Fix `agent-tokens.ts:34` error check bug | 1 file | — |

### Short Term (Week 2-3) — Modularity

| # | Action | Impact |
|---|--------|--------|
| 6 | Split `tickets.ts` into focused modules | Maintainability |
| 7 | Split `everhour.ts` into focused modules | Maintainability |
| 8 | Extract shared ticket card components | ~100 lines saved |
| 9 | Centralize `Ticket` type definition | Type safety |
| 10 | Create `createProtocolRoute()` factory | ~14 routes simplified |

### Medium Term (Month 1) — Cleanup & Safety

| # | Action | Impact |
|---|--------|--------|
| 11 | Remove/migrate `uploadImageArtifactAction` | Security, consistency |
| 12 | Audit Everhour API fallback endpoints | Code clarity |
| 13 | Add Sentry reporting to silent failures | Observability |
| 14 | Add transaction safety to multi-step operations | Data integrity |
| 15 | Create shared revalidation module | Consistency |
| 16 | Add metadata parsing with Zod schemas | Type safety |
