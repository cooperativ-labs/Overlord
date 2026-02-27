# c18c0ad0 - Better process for un-highlighting completed tickets

## Goal
Define one simple rule-set for clearing all ticket highlight badges (blue review + red waiting) with correct behavior when the ticket is already open.

## Proposed approach: per-badge state machine (client-side)
Use the same lifecycle for every highlight badge type (`review`, `waiting_response`, and future badge types):

- `idle`: no highlight shown.
- `highlighted_unseen`: highlight is active; user has not opened ticket since this badge was raised.
- `highlighted_seen_while_open`: badge was raised while ticket was already open, so keep highlight until the user closes and reopens.

## Transition rules
1. Badge raised while ticket is closed
- Set state to `highlighted_unseen`.

2. Badge raised while ticket is open
- Set state to `highlighted_seen_while_open`.

3. User opens ticket
- `highlighted_unseen -> idle` (clear immediately on open)
- `highlighted_seen_while_open -> highlighted_unseen` (do not clear yet)

4. User closes ticket
- No state change.

5. User reopens ticket
- `highlighted_unseen -> idle` (clears now)

This exactly satisfies:
- Clear when user opens a highlighted ticket.
- If badge appears while ticket is already open, require another close+open cycle before clear.
- Same logic for blue and red badges.

## Why this is efficient
- No DB migration required.
- No extra roundtrips; all state can remain in existing local-storage backed badge state.
- One shared state reducer prevents drift between blue/red badge behavior.
- Easy to extend to new badge types without adding custom logic each time.

## Minimal implementation outline
1. Replace separate `openedWaiting` / `openedReview` timestamp checks with one generic local state map keyed by `{ticketId, badgeType}`.
2. Add route transition hooks (open/close detection) that dispatch reducer events:
- `BADGE_RAISED`
- `TICKET_OPENED`
- `TICKET_CLOSED`
3. Compute `has_unopened_*` booleans from reducer state instead of duplicated timestamp comparison logic.
4. Keep current realtime event ingestion; only mapping to highlight visibility changes.

## Acceptance checks
- Review badge appears for ticket A while closed -> clears on next open.
- Review badge appears while ticket A is open -> remains highlighted after first close; clears only after next open.
- Waiting badge follows identical behavior.
- Mixed badges on same ticket are independent (clearing one does not clear the other).
