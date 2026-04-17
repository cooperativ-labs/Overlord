# Client-First Local DB Sync Spike Recommendation

## Context

Phases 1-9 establish TanStack Query as the shared client cache for the interactive ticket, feed,
project, status, current-changes, Everhour, and offline-ticket surfaces. The remaining question is
whether Overlord should add a deeper local database sync layer for Electron after those cache
boundaries stabilize.

## Recommendation

Do not adopt a local database sync backend yet.

The current architecture now has a clear optimistic mutation model and scoped reconciliation paths.
Adding PowerSync, Electric, or TanStack DB before the cache/mutation contracts settle would create a
second source of truth for tickets, projects, statuses, timers, and feed posts. That would increase
conflict-handling and auth/RLS complexity without solving the primary lag sources this migration
targets.

## Evaluation

### PowerSync + Supabase

- Strong fit for local SQLite reads and Electron availability.
- Good long-term candidate if Overlord needs true offline browsing/editing of ticket boards.
- Adoption requires explicit conflict semantics for ticket reorder/status edits and project/status
  renames.
- Supabase RLS and organization scoping would need a dedicated sync-rule review before production.

### Electric + TanStack DB

- Promising for Postgres-shaped reactive collections and TanStack ecosystem alignment.
- Best fit if the app wants collection-level reactivity across web and Electron.
- Still adds operational machinery and conflict semantics before the current query cache warrants it.
- Needs a separate proof of Electron packaging, local persistence, and auth token refresh behavior.

### TanStack DB Abstraction

- Useful later as a facade over query-backed collections.
- Not useful as a new dependency until the query key, DTO, and mutation contracts stop changing.
- Could reduce future migration cost if introduced around stable domains only, such as projects and
  ticket statuses, after board/feed/timer behavior is verified.

## Go / No-Go

No-go for immediate product adoption.

Proceed only with a bounded proof of concept after phases 1-9 pass manual QA in Electron across
multiple windows and offline replay. The POC should target one read-heavy domain first, preferably
project/status metadata plus a small ticket-board slice, and must prove:

- organization-scoped auth/RLS behavior
- conflict behavior for reorder/status mutations
- realtime and polling fallback coexistence
- Electron persistence and reset behavior
- rollback path that returns the app to TanStack Query-only operation

## No-Adoption Rationale

The client-first cache already removes the perceived refresh lag for the interactive surfaces.
Offline ticket creation can stay as a localStorage-backed mutation queue for now because it replays
through the same create-ticket transport and cache merge path as online creation. A full sync layer
should be justified by a concrete offline-read/edit requirement, not by general architectural
appeal.
