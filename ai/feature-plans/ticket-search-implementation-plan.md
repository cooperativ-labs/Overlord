# Ticket Search Implementation Plan

## Short Answer

No. Enabling a Supabase/Postgres extension alone will not fix the current bug.

The main issue is in the query strategy:

- full-text matches are ordered by `updated_at desc` instead of relevance
- title and `ticket_id` fallback only runs when full-text returns zero rows
- title, identifier, and objective text are stored in one unweighted search vector

`pg_trgm` is still worth adding, but only as part of a broader database search rewrite.

## What To Implement

1. Add a SQL RPC, for example `public.search_tickets(...)`, that applies all existing filters and computes one combined rank.
2. Change ranking so these signals are ordered ahead of recency:
   - exact `ticket_id` match
   - exact title match
   - title prefix / word-prefix match
   - title substring or trigram similarity
   - weighted full-text rank
   - `updated_at` only as tie-breaker
3. Replace the current `search_vector` build with a weighted vector:
   - title = weight `A`
   - `ticket_id` = weight `A`
   - first objective = weight `B`
4. Update the shared web/protocol helper to call the RPC.
5. Update the MCP handler to use the same RPC semantics instead of its duplicated local logic.
6. Add regression tests covering title-first ranking, exact identifier ranking, prefix queries, and filter parity.

## Database Changes

The minimal database work is:

- add `create extension if not exists pg_trgm with schema extensions;`
- add trigram indexes on `tickets.title` and likely `tickets.ticket_id`
- add a new SQL function for ranked search
- update the trigger/backfill logic that populates `tickets.search_vector`

This is still a normal Supabase migration path. No separate search service is required.

## Can We Simply Add Supabase Postgres Plugins?

Only partially.

Adding `pg_trgm` helps with:

- fast `ILIKE` title matching
- prefix / substring ranking
- typo tolerance via `similarity(...)`

But it does **not** solve:

- full-text results being ordered by recency
- fallback not running when low-quality full-text rows already exist
- title terms having the same weight as objective terms

So the right answer is:

- `pg_trgm`: yes, add it
- additional search plugins/services: not needed for this fix
- query/RPC rewrite: required

## Estimated Scope

Reasonable first-pass scope:

- 1 migration for extension, weighted vector updates, RPC, and indexes
- 1 helper update in `lib/helpers/ticket-search.ts`
- 1 MCP handler update in `supabase/functions/mcp/handlers/search-tickets.ts`
- targeted Supabase/API regression tests

This should be a relatively contained change, but it is not just a one-line extension enablement.
