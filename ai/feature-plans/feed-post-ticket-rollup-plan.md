# Feed Post Ticket Rollup Plan

**Ticket:** `1:1003`  
**Goal:** Move feed posts from session/objective-scoped snapshots to one mutable post per ticket, with a mutable summary, objective-level timeline content, ticket-level tradeoffs/actions, objective-aware file grouping, and feed ordering by `updated_at`.

## Why the current implementation does not satisfy the goal

The current feed pipeline is still built around “create a post for a delivery/review event, then sometimes append to it”:

- `supabase/functions/generate-feed-post/index.ts` deduplicates primarily by `session_id`, not by `ticket_id`.
- `feed_posts.objective_id` currently means “the objective this post was generated for”, which assumes objective-scoped posts.
- Feed readers sort by `created_at` in both web and mobile:
  - `lib/actions/feed.ts`
  - `apps/mobile/lib/feed-posts.ts`
- Realtime listeners only subscribe to `INSERT`, but the new model depends on frequent `UPDATE`s:
  - `lib/hooks/use-feed-realtime.ts`
  - `apps/mobile/lib/hooks/use-feed-realtime.ts`
- Feed-discuss/context helpers still scope supporting data by `session_id`:
  - `lib/overlord/load-feed-discuss-append.ts`
  - `lib/overlord/protocol-context-objective.ts`

That behavior directly conflicts with:

1. One post per ticket.
2. New objectives and later deliveries updating the existing post.
3. Objective-grouped timeline content.
4. Feed ordering by `updated_at`.

## Target product behavior

For each ticket, the feed should expose exactly one canonical post:

- The post is created the first time ticket activity is feed-worthy.
- Every later feed-worthy update rewrites that same row.
- The post contains:
  - `title`
  - `summary` at the top, mutable across deliveries
  - objective timeline content in ascending objective order
  - ticket-level `impact_level`, `tradeoffs`, and `human_actions`
  - objective-aware file changes
  - ticket-level file changes when `file_changes.objective_id is null`
- Any update to the post bumps `updated_at`, and feed surfaces reorder from that field.

## Design Integration Notes

The replacement design handoff was available at:

`design-files/Overlord Handoff.tar.gz`

The original URL in the ticket returned HTTP 404. The accessible handoff's `overlord/README.md`,
chat transcript `chat5.md`, `Feed post designs.html`, and `data.jsx` indicate that V3 is the
target data shape:

- one feed post is a ticket-level rollup
- `summary` is mutable and always visible
- objectives are ascending rows with title, takeaway, event count, body drawer content, and time
- action-required items and tradeoffs are nested under the relevant objective row
- file changes with `objective_id is not null` are nested under that objective
- file changes with `objective_id is null` stay as ticket-level `orphan_file_changes`
- aggregate counts (`total_events`, `total_files`, `pending_actions`) are available at the post
  level for scan chips

This updates the earlier plan: top-level `tradeoffs` and `human_actions` remain for backwards
compatibility and card-level callouts, but the canonical rollup structure should also carry
objective-scoped `tradeoffs` and `action_required` inside `objective_sections`.

## Recommended data model

Keep `feed_posts` as the canonical read model, but make it explicitly ticket-rollup oriented.

### 1. Enforce one row per ticket

Add a unique constraint/index on `feed_posts(ticket_id)`.

Recommended sequence:

1. Add new columns first.
2. Backfill canonical ticket rollup rows.
3. Remove duplicates.
4. Add the unique constraint last.

This avoids locking the implementation into parsing legacy `body` text.

### 2. Add first-class summary and structured objective sections

Add:

- `summary text not null default ''`
- `objective_sections jsonb not null default '[]'::jsonb`
- `orphan_file_changes jsonb not null default '[]'::jsonb`
- `total_events integer not null default 0`
- `total_files integer not null default 0`
- `pending_actions integer not null default 0`

Recommended `objective_sections` shape:

```json
[
  {
    "id": "uuid",
    "objective_id": "uuid",
    "index": 1,
    "title": "Objective row title",
    "state": "draft|executing|complete|blocked",
    "position": 0,
    "time": "12:26 PM",
    "duration": "8m",
    "events": 3,
    "takeaway": "One-sentence scan summary",
    "body": "- concise markdown bullets for this objective",
    "file_changes": [
      {
        "path": "apps/web/...",
        "status": "added|modified|deleted|renamed",
        "additions": null,
        "deletions": null
      }
    ],
    "action_required": ["Run production migration"],
    "tradeoffs": [
      {
        "decision": "Use database trigger",
        "alternatives_considered": "Application-level inference",
        "rationale": "Consistent across insertion surfaces"
      }
    ],
    "event_ids": ["uuid"],
    "updated_at": "timestamp"
  }
]
```

Rationale:

- `summary` lets the top-of-post summary mutate independently from the objective timeline.
- `objective_sections` gives the system a structured ticket timeline instead of forcing later readers to reverse-engineer markdown.
- Keep `body` for compatibility, but redefine it as the fully rendered objective timeline markdown, generated from `summary + objective_sections + ticket-level file changes`.

### 3. Keep ticket-level metadata at the post level

Do **not** move these into per-objective data:

- `impact_level`
- `tradeoffs`
- `human_actions`
- `tags`
- `tickets_created`

That matches the requested behavior and keeps feed card rendering simple.

### 4. Preserve `objective_id`, but change its meaning

Keep `feed_posts.objective_id`, but redefine it as:

- “the latest objective materially represented in the rollup”

Use it as the current pointer for:

- feed discuss context
- protocol prompt context
- lightweight “what objective was most recently updated” needs

This is smaller and safer than a full rename, but the column comment and readers must be updated to reflect the new meaning.

### 5. Stop treating `session_id` as the primary slice key

In the new model, a post spans multiple sessions over time, so `session_id` can no longer drive reads.

Recommended behavior:

- Keep `session_id` as “latest contributing session” for compatibility/debugging.
- Use `source_event_ids` and `objective_sections[*].event_ids` as the true provenance.
- Optionally add `source_session_ids uuid[] not null default '{}'` if session provenance becomes important for debugging or discuss context.

## Generator redesign

## Source-of-truth strategy

The generator should rebuild the ticket rollup from authoritative ticket data each time, not append prose onto prior prose.

On each invocation:

1. Resolve the canonical post by `ticket_id`.
2. Load the ticket, project, objectives, non-system `ticket_events`, `file_changes`, and spawned tickets.
3. Group events and file changes by `objective_id`.
4. Build deterministic structured sections in ascending objective order.
5. Ask Gemini for:
  - ticket-level fields: `title`, `summary`, `tags`, `impact_level`, `tradeoffs`, `human_actions`
  - per-objective `body` entries keyed by `objective_id`
6. Deterministically render the final markdown `body`.
7. Upsert the single `feed_posts` row for the ticket.

This removes the need to merge old markdown with new markdown and is the cleanest way to keep the summary mutable.

## Prompt and output shape

Keep the generator parameters that already work well, but move them into a rollup-aware schema.

Recommended model response:

```json
{
  "title": "max 80 chars",
  "summary": "concise markdown bullets for the whole ticket",
  "tags": ["bugfix", "refactor"],
  "impact_level": "minor|notable|significant",
  "tradeoffs": [
    {
      "decision": "…",
      "alternatives_considered": "…",
      "rationale": "…"
    }
  ],
  "human_actions": ["run migration …"],
  "objective_sections": [
    {
      "objective_id": "uuid",
      "body": "- max 300 words of markdown bullets for this objective"
    }
  ]
}
```

Notes:

- `summary` is ticket-level and mutable.
- `objective_sections[*].body` preserves the current “body works well” pattern, but scopes it per objective.
- File grouping should be deterministic in server code, not left to the model.

## Deterministic body rendering

Do not let the model decide final structural layout. The renderer should always produce:

1. `summary`
2. optional ticket-level file change section for `objective_id = null`
3. objective timeline sections ordered ascending by objective creation order

Recommended markdown shape:

```md
## Summary
- …

## Ticket-wide changes
- File changes not tied to an objective

## Objective 1: <objective text>
<objective body>

Files:
- path/a.ts
- path/b.ts

## Objective 2: <objective text>
…
```

That gives stable output, makes the UI predictable, and avoids prompt drift.

## File-change grouping rules

Use the database as the authority:

- `file_changes.objective_id is not null`
  - group under that objective’s section
- `file_changes.objective_id is null`
  - keep at ticket level

Also group `ticket_events` the same way so each objective section has its own event history.

Important edge cases:

- Objectives may exist with no file changes yet: still show their body if events justify it.
- Ticket-level file changes may exist even when all objectives are populated: preserve them; do not force-assign.
- If an event references an `objective_id` not present in the ordered objective list, load that objective row explicitly and append it in chronological order.

## Reader and UI changes

## Feed queries

Change all feed list queries to order by `updated_at desc`, not `created_at desc`.

Primary files:

- `lib/actions/feed.ts`
- `apps/mobile/lib/feed-posts.ts`

Also revisit pagination assumptions: once posts reorder in place, offset pagination is slightly less stable. It is acceptable as a first step, but cursor pagination by `(updated_at, id)` would be a stronger follow-up if feed churn grows.

## Realtime

Subscribe to both `INSERT` and `UPDATE` on `feed_posts`.

Primary files:

- `lib/hooks/use-feed-realtime.ts`
- `apps/mobile/lib/hooks/use-feed-realtime.ts`

Required behavior:

- If a post is inserted, prepend it.
- If a post is updated, replace the existing cached item by `id` and re-sort by `updated_at desc`.
- Dedup by `id`, not by “known insert IDs only”.

Without this, the feed UI will not reflect the new mutable-post model.

## Card rendering

Short-term:

- Continue rendering `post.body` for compatibility.
- Add a dedicated `summary` rendering block above the timeline if the UI should distinguish it visually.

If the first iteration wants minimal UI churn, the backend can render `summary` into the top of `body` and the UI can remain mostly unchanged. Even then, the new `summary` column should still exist as first-class data for future UI refinement.

## Timestamp semantics

If cards remain sorted by `updated_at` but still display `created_at`, the UI will appear to “move old posts for no visible reason.”

Recommended adjustment:

- sort by `updated_at`
- display either `updated_at`, or a compact “updated” label when `updated_at != created_at`

This is not strictly required for correctness, but it avoids a confusing feed.

## Overlord context and discuss flows

Because posts are no longer session-scoped, the readers that use `feed_posts.session_id` must change.

### `lib/overlord/load-feed-discuss-append.ts`

Current issue:

- It loads file changes and ticket events by `session_id` when present.

Required change:

- Prefer `source_event_ids` and the rollup’s `objective_sections` instead of session filtering.
- When needing supporting file changes, query by ticket and optionally narrow to the objective IDs present in the post.

### `lib/overlord/protocol-context-objective.ts`

Current issue:

- It assumes `feed_posts.objective_id` points to the single objective summarized by the post.

Required change:

- Treat `feed_posts.objective_id` as the latest objective in the rollup.
- If a richer objective is needed for a feed post, optionally use the last entry in `objective_sections`.

## Migration and backfill plan

## Schema migration

Create a new timestamped migration that:

1. Adds `summary`
2. Adds `objective_sections`
3. Updates column comments for `objective_id` and `session_id`
4. Optionally adds `source_session_ids`

Do **not** add the unique `ticket_id` constraint in the same step unless the backfill runs inside that migration and is guaranteed safe.

## Backfill

Recommended approach:

1. Find all tickets that currently have at least one `feed_posts` row.
2. For each ticket, rebuild the canonical rollup from `ticket_events`, `file_changes`, objectives, and spawned tickets.
3. Write one canonical post row per ticket.
4. Delete or archive duplicate legacy rows.
5. Add the unique constraint on `ticket_id`.

Important:

- Backfill should not attempt to parse legacy `body` text.
- Rebuild from the authoritative event/file tables instead.

## Rollout

1. Ship schema additions.
2. Ship generator upsert logic and deterministic rendering.
3. Ship query/realtime updates for web and mobile.
4. Run backfill.
5. Add the `ticket_id` unique constraint.
6. Monitor feed ordering and discussion flows.

## Test plan

### Database / integration

Add coverage for:

- one post per ticket after repeated deliveries
- `updated_at` changes when the canonical post is rewritten
- objective-grouped file changes
- ticket-level file changes with `objective_id = null`
- objectives ordered ascending in rendered output

### Generator unit tests

Extract grouping/rendering helpers from `supabase/functions/generate-feed-post/index.ts` so they can be tested without invoking Gemini.

Add tests for:

- grouping events by objective
- grouping file changes by objective vs ticket-level
- deterministic body rendering
- merge of source event IDs on update
- fallback generation when Gemini is unavailable

### Web/mobile feed tests

Add tests for:

- ordering by `updated_at`
- replacing an existing post on realtime `UPDATE`
- keeping one visible item when the same post is updated multiple times

### Overlord context tests

Add or update tests around:

- `lib/overlord/protocol-context-objective.ts`
- `lib/overlord/load-feed-discuss-append.ts`

So feed discuss and prompt context still resolve the right objective once posts span multiple sessions/objectives.

## Risks and tradeoffs

### Risk: larger per-ticket rollups

As a ticket accumulates many objectives/events, the rollup input grows.

Mitigation:

- build deterministic grouped summaries before the model call
- cap raw event/file detail sent to Gemini
- keep structured provenance in `objective_sections` and `source_event_ids`

### Risk: offset pagination becomes unstable

Sorting by `updated_at` means existing rows can move between pages.

Mitigation:

- acceptable for first pass
- consider cursor pagination later if the feed becomes noisy

### Risk: old readers still assume session-scoped posts

The biggest non-obvious breakage is not the generator; it is downstream consumers still filtering by `session_id`.

Mitigation:

- update Overlord feed discuss/context readers in the same rollout
- cover them with tests before enabling the backfill

## Implementation checklist

1. Add `summary` and `objective_sections` to `feed_posts`.
2. Update `generate-feed-post` to upsert by `ticket_id`.
3. Rebuild feed content from ticket-wide authoritative data, not incremental markdown append.
4. Group events and file changes by `objective_id`, preserving ticket-level null-objective changes.
5. Render final `body` deterministically from `summary + objective_sections`.
6. Change web/mobile feed ordering to `updated_at desc`.
7. Subscribe to `feed_posts` realtime `UPDATE`s.
8. Update feed discuss/context helpers to stop relying on `session_id` as the primary slice.
9. Backfill canonical ticket rollups.
10. Add the unique constraint on `feed_posts(ticket_id)`.

## Files likely involved

- `supabase/functions/generate-feed-post/index.ts`
- `supabase/functions/generate-feed-post/operations-rules.ts`
- `supabase/migrations/<timestamp>_feed_posts_ticket_rollup.sql`
- `lib/actions/feed.ts`
- `lib/hooks/use-feed-realtime.ts`
- `apps/mobile/lib/feed-posts.ts`
- `apps/mobile/lib/hooks/use-feed-realtime.ts`
- `lib/overlord/load-feed-discuss-append.ts`
- `lib/overlord/protocol-context-objective.ts`
- `types/database.types.ts`
