# ADR 0056: Unify draft and future objectives into one ordered draft queue

- Date: 2026-11-14
- Status: accepted
- Contract version: 172.0.0
- Supersedes: none

## Context

A mission's unstarted objectives were split across two states. Exactly one objective was the
`draft` ("next up"); every other unstarted objective was `future`. Keeping that shape required
machinery in several components:

- a single-draft rule (setting one objective to `draft` demoted every other draft to `future`,
  and a promoted `future` was spliced into the draft slot);
- three implementations of a "refill the draft slot" routine (backend repository, core missions
  service, automations planner) that promoted the next `future` objective when the draft
  attached or completed, and soft-deleted blank drafts it replaced;
- a 409 "promote the objective to draft first" launch guard, and Run Queue dispatch that
  promoted a `future` objective as a side effect;
- a reorder surface (`reorder-future-objectives`, `overlord_reorder_future_objectives`,
  `PATCH /api/missions/{id}/objectives/reorder`) restricted to `future` rows, so the next-up
  objective could not be moved without a separate promote step;
- a `multiple_drafts` lifecycle violation and split Editable/Future groups with a Promote button
  in the web app and OverlordMobile.

The rule already leaked (wedged-launch resets and batch adds could leave several drafts), and
the readers that meant "the draft" took an arbitrary row (`LIMIT 1` with no order). There is one
user and every client ships in the same release, so no compatibility period is needed.

## Decision

1. **Vocabulary.** `future` is removed from the closed `objectives.state` vocabulary. Unstarted
   objectives are `draft`; discussion still uses `submitted`. A mission may hold any number of
   drafts. Both database dialects enforce the new CHECK; SQLite rebuilds `objectives`.
2. **Draft queue.** `draft` and `submitted` objectives form the mission's draft queue, ordered by
   `position`, then `created_at`, then `id`. `launching` is not part of the queue and keeps its
   position. Three derived, non-persisted selectors share that order:
   - *queue head* — first `draft` or `submitted`, blank allowed (the full card in clients);
   - *first draft* — first `draft`, blank allowed (editing, `discuss-objective` default, the
     mission card's draft resource badge);
   - *next runnable draft* — first `draft` with non-empty instruction text. Automatic selection
     (auto-advance planning, awaiting-approval notices) uses only this selector and therefore
     skips submitted objectives and blank drafts, wherever they sit relative to the delivered
     objective.
   Unpinned attach is an explicit execution order: after active-state resolution it prefers a
   submitted objective (the discuss → attach flow), then the next runnable draft, then the first
   draft, then any unfinished objective.
3. **No promotion or refill.** Creating, launching, reordering, reopening or delivering one
   objective never changes another objective's state. New objectives are always appended as
   `draft`. Every draft or submitted objective is directly launchable; the refill routines, the
   single-draft block, the promote launch guard and Run Queue `promoteFutureToDraft` are deleted.
   The empty "type here" composer stays client-only.
4. **Reorder.** `reorder-future-objectives` / `overlord_reorder_future_objectives` are renamed
   `reorder-objectives` / `overlord_reorder_objectives`; the REST route is unchanged and its body
   schema is renamed `ReorderObjectivesBody`. The request must name exactly the live `draft` and
   `submitted` objectives of the mission (missing, extra, duplicate, foreign or non-queued ids are
   rejected). The listed rows are written into the sorted position slots they already hold, so a
   launching, active or complete row between them never moves. An unchanged order writes no
   revision. The new order is carried into the mission's Run Queue entries in the same
   transaction.
5. **Reopen.** Setting an executing, pending-delivery or complete objective back to `draft`
   moves it to the queue head: the reopened row and the queued rows trade their existing slots
   (reopened first, queued rows in their existing relative order). Every other row keeps its
   position. A reopened row already before the queue, or a mission with no queue, keeps its
   position. Reopen timestamps, evidence retention, request cancellation and queue pausing are
   unchanged.
6. **Direct position writes.** `PATCH /api/objectives/{id}` refuses a `position` that differs from
   the current one (400); positions move only through reorder, reopen and Run Queue write-through.
7. **Concurrency.** Writes that change a mission's queued set or positions (insert, delete,
   reorder, reopen, Run Queue position write-through) serialize on a per-mission lock (a
   `missions` row lock on Postgres; the per-handle write mutex on SQLite). Reorder position writes
   are state-checked, so a launch that moved a listed row out of the queue concurrently rejects
   the whole reorder with 409 and the client refetches.
8. **Migration.** Every `future` row, live or soft-deleted, becomes `draft` with only `state`,
   `revision` and `updated_at` changing. Blank rows, attachments, configuration, provenance and
   Run Queue entries are preserved; historical events and delivery payloads keep the state strings
   they recorded. Positions need no renumbering.
9. **Positional context fields stay.** `previousObjectives` / `futureObjectives` in attach and
   load-context responses keep their names; they describe position relative to the current
   objective, not a state.
10. **Cutover.** The change ships as one coordinated release: backend, core, automations, CLI,
    MCP, connectors, web/desktop and OverlordMobile. Old writers and dispatchers stop before the
    migration; only matching versions restart. Rollback is restoring the pre-migration backup with
    the matching old binaries, never running an old single-draft binary against multi-draft data.

## Consequences

- Affected components: automations (lifecycle rules and selectors), core services (missions,
  protocol, run-queue, new `objective-queue` helpers), backend repository/launch/dispatch/protocol,
  database migrations (SQLite and Postgres), contract package (search vocabulary, MCP tool
  catalog, generated REST types), MCP server and connector shim (tool rename; connector release),
  CLI help and launch picker, web/desktop mission panel, and OverlordMobile (separate objective
  in the same release).
- The visible queue head can differ from the next runnable draft (a submitted or blank head).
  Explicit Run Queue membership and order remain authoritative for dispatch; a queued submitted
  objective is not skipped by the dispatcher.
- Queueing an objective still cascades to unstarted objectives positioned after it; earlier
  unqueued drafts stay unqueued even though launches may now happen out of order.
- Clients that still send `future`, call the old command/tool names, or send partial reorder
  sets fail with 400/404 and must update.

## Alternatives considered

- **Keep `future` as an input alias for a release.** Rejected: there is a single operator and
  every client ships together, so an alias would only prolong the dual model.
- **Persist a "next up" marker.** Rejected: a derived selector over position cannot drift, while
  a stored marker reintroduces the maintenance the refill routines existed for.
- **Delete blank legacy rows in the migration.** Rejected: blank rows may carry attachments,
  configuration or history; automatic selection skipping blanks makes deletion unnecessary.
- **Renumber the queue contiguously on reorder.** Rejected: a launching objective between queued
  rows would collide or move; recycling existing slots keeps every non-queued row fixed.
