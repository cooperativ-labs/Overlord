# Ticket Search Improvement Review

## Current Behavior

Ticket search is implemented in three places that should behave the same:

- `lib/helpers/ticket-search.ts` powers `apps/web/app/api/tickets/search/route.ts` and `apps/web/app/api/protocol/search-tickets/route.ts`.
- `supabase/functions/mcp/handlers/search-tickets.ts` duplicates the helper logic for hosted MCP.
- `packages/overlord-cli/bin/_cli/protocol.mjs`, `packages/overlord-cli/bin/_cli/attach.mjs`, and `packages/overlord-cli/bin/_cli/tickets.mjs` all call the protocol endpoint.

The shared search flow is:

1. Sanitize the query to alphanumeric, spaces, and hyphens, then trim to 120 characters.
2. Query `tickets.search_vector` with Supabase/PostgREST full-text search using `type: 'websearch'`.
3. Order matching rows by `updated_at desc`.
4. Return the first page immediately if any full-text rows match.
5. Only if full-text returns zero rows, fall back to `title.ilike` or `ticket_id.ilike`.

The database `search_vector` includes `title`, `ticket_id` or legacy sequence, and the first objective text via migrations `20260225144000_ticket_search_vector.sql`, `20260226100500_include_first_objective_in_ticket_search_vector.sql`, and `20260505130000_add_ticket_identifier.sql`.

## Why Title Hits Can Be Missed

The main problem is ranking, not indexing. A ticket with the searched word in its title may match full-text, but it competes with tickets where the word appears in the first objective. Because results are sorted only by `updated_at desc`, newer lower-quality matches can fill the `limit` before the older exact-title match is returned. Since the `ILIKE` title fallback only runs when full-text returns no rows, it never rescues exact title matches from a non-empty but badly ranked full-text page.

There are secondary recall issues:

- Title, identifier, and objective text are all packed into one unweighted vector, so title terms have no priority over objective terms.
- The code appends `*` to terms but sends the query through web-search full-text mode; PostgreSQL prefix matching is a `tsquery` feature and should be handled explicitly in SQL instead of relying on web-search parsing.
- English full-text configuration stems and drops stop words. That is good for prose, but it can behave unexpectedly for short product terms, identifiers, acronyms, and literal title fragments.
- `1:1150` becomes `1 1150` during sanitization. If full-text finds many organization `1` rows, exact identifier fallback can also be skipped.
- The web API limit is only 6 and protocol default is 8, making ranking mistakes visible quickly.
- MCP duplicates the web helper logic, so any fix must be implemented twice unless MCP can share a generated SQL/RPC contract.

## Recommended Fix

Replace the two-phase "full-text, then fallback only on zero rows" approach with one ranked database search function. The function should combine title substring/exact matching, identifier matching, full-text rank, and recency into a single ordered result set.

Recommended ranking priority:

1. Exact `ticket_id` match.
2. Exact title match, case-insensitive.
3. Title prefix or title word-prefix match.
4. Title substring or trigram-similar match.
5. Weighted full-text match, with title weighted above objective text.
6. Recency as a tie-breaker, not the primary rank.

Implementation shape:

- Add a SQL RPC such as `public.search_tickets(...)` that applies organization/project/status/date filters and returns selected ticket fields plus a numeric rank or reason fields for debugging.
- Store a weighted vector using `setweight(to_tsvector(...title...), 'A') || setweight(to_tsvector(...ticket_id...), 'A') || setweight(to_tsvector(...first_objective...), 'B')`.
- Use `ts_rank_cd` for full-text rank and boost exact/prefix/substring title matches with explicit `CASE` expressions.
- Enable `pg_trgm` and add trigram GIN indexes on `tickets.title` and optionally `tickets.ticket_id` to make `ILIKE`, similarity, and typo-tolerant title search fast.
- Query more candidates than the display limit internally, rank them in SQL, and return the requested limit after ranking.
- Point the web route, protocol route, and MCP handler at this one contract so behavior does not drift.

## Library Options

Start with PostgreSQL before adding another search service. The app already stores the data in Supabase/Postgres, search is organization-scoped, and the immediate bug is caused by ranking. PostgreSQL full-text search plus `pg_trgm` should handle exact title recall, prefix matching, typo tolerance, and field weighting without new infrastructure.

Good open source options by scope:

- PostgreSQL full-text search plus `pg_trgm`: best first step; no new service, works with RLS-aware Supabase access patterns, supports GIN indexes, ranking, and trigram similarity.
- ParadeDB: worth evaluating later if ticket search grows into richer Postgres-native search with BM25-style ranking and more search features than built-in FTS.
- Meilisearch or Typesense: useful if product search needs typo tolerance, facets, highlighting, synonyms, analytics, or very fast cross-entity search. They add synchronization, authorization, and deployment complexity.
- MiniSearch, FlexSearch, Fuse.js, or Lunr: good for local/client-side search over a small already-authorized ticket set, but not a good primary source for organization-wide ticket search because the app should not preload every ticket into the browser or CLI.

## Test Plan

Add regression coverage around the shared ranked search contract:

- Searching a word that appears in an older ticket title ranks that ticket above newer objective-only matches.
- Exact `ticket_id` search ranks the target first.
- Title prefix search works for partial words.
- Completed tickets remain excluded by default.
- Status, project, creator, and date filters still apply before ranking.
- Web, protocol CLI, and MCP search return equivalent ordering for the same fixture data.

## Rollout Plan

1. Add the SQL RPC and indexes behind the existing endpoints.
2. Update `lib/helpers/ticket-search.ts` to call the RPC.
3. Replace duplicated MCP logic with the same RPC semantics.
4. Add focused tests against seeded Supabase fixtures.
5. Log or return internal rank reason during development so poor ordering can be diagnosed before shipping.
