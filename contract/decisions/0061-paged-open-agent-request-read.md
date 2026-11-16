# ADR 0061: A paged, status-filtered read of a mission's agent requests

- Date: 2026-11-16
- Status: accepted
- Contract version: 173.2.0
- Supersedes: none

## Context

`GET /api/agent-requests?missionId=…` returns a mission's newest 200 requests of every status.
The web mission panel derives open questions from that list. A long-lived open question can be
displaced by 200 newer closed requests, and the panel then shows no question although the agent is
still blocked. Client-side filtering cannot recover a row the server never returned. The mission
panel redesign (coo:1281, `planning/feature-plans/mission-panel-redesign.md` section 3.1) replaces
per-objective polling with one mission-wide collection, which makes cross-objective displacement
possible in ordinary use.

The CLI and the native mobile app read the same route and depend on its current shape.

## Decision

1. **Opt-in, not a changed default.** The read is paged only when the caller supplies `status`,
   `limit` or `cursor`. Without them the response is unchanged: newest first, at most 200 rows and
   no `page` member. Existing consumers keep their behavior.
2. **Filter before the limit.** `status=open` (the only accepted value) is applied in the query
   before the page limit, so every open request is reachable however many closed requests follow.
   Every request kind is returned; the client chooses which kinds block.
3. **Oldest-first keyset order.** Pages are ordered by `(created_at, id)` ascending, `limit`
   1–200 (default 100). A request created while a client pages sorts after the cursor and is read
   on a later page rather than skipped; one resolved while paging is absent from later pages. The
   id tie-break makes identical timestamps page exactly once.
4. **Explicit completeness.** A paged response carries `page { complete, nextCursor, limit,
   status }`. Absence is proven only after following `nextCursor` to a page whose `complete` is
   true. Clients must not treat absence from a partial or failed read as resolution.
5. **Scope-bound cursors, authorization on every page.** A cursor is an opaque encoding of the
   resolved mission, objective, status and last `(created_at, id)`. One that does not decode, or
   that names another mission, objective or status, answers 400 `invalid_input`. Mission resolution
   and `session:read` are evaluated on every page before the cursor is read, so a cursor grants
   nothing. Paging requires mission scope; the cross-workspace inbox read stays unpaged.

## Consequences

- Additive: contract impact minor (173.2.0); OpenAPI `info.version` 4.6.0.
- The web client reads every page into one shared, deduplicated collection with a page bound,
  keeps the last successful collection on failure, and exposes `complete`/`partial`/`error`.
- The CLI and mobile app are unaffected and may adopt the paged read later.
- No migration. Existing indexes serve the mission-scoped read; a dedicated
  `(mission_id, status, created_at, id)` index can be added if request volume requires it.
