# ADR 0096: Activity feed pages delivered missions by three-day windows

Date: 2026-11-21
Status: accepted
Contract version: [179.12.0](../CHANGELOG.md#179120---2026-11-21)
Supersedes: none (narrows the window set by coo:826.mnds)
Contract impact: minor

## Context

The Feed page loaded slowly and showed far more history than an operator needs at a glance.
`GET /api/activity-feed` returned every mission delivered in the past two weeks on its first
page. Its reads filtered `deliveries`, `mission_events` and `objectives` by `workspace_id` plus a
time or state column, but no index served that shape, so every load scanned each workspace's full
history. The "is anything older?" check behind `nextBefore` took `MAX(delivered_at)` over all
older deliveries and ran a latest-delivery and live-work subquery per row.

## Decision

- The delivered window is three days for the first page and for each `before` page. Scroll
  paging, the skip over empty calendar holes, and `nextBefore` semantics are otherwise unchanged.
- The older-delivery check reads newest-first with `LIMIT 1`, so it stops at the first
  qualifying delivery.
- Migration `20261121100000_activity_feed_indexes` adds `deliveries (workspace_id,
  delivered_at)`, `mission_events (workspace_id, type, created_at)` and `objectives
  (workspace_id, state, updated_at)` on both adapters.

"Last updated" for a delivered mission remains its most recent live delivery, the timestamp the
card already shows. Mission `updated_at` was not used: it also moves on edits such as a title
change, which would pull old work back onto the feed.

## Consequences

The first page is smaller and its queries use the new indexes. Missions delivered three to
fourteen days ago now appear only after scrolling. Clients that follow `nextBefore` need no
change. Existing data is not rewritten.
