# Ticket Ordering Improvements

**Ticket:** `1:1200`
**Goal:** Make Kanban/list column ordering behave predictably across all status transitions — drag, agent-driven, and API-driven — so the drop position is honored, agent activity floats to the top, and the order doesn't drift over time.

## Reported problems

1. **Drag review→complete jumps.** A card dragged from `review` into `complete` first appears at the *bottom* of the complete column, then a second or two later jumps to the *top*. Expected: it stays at the drop position; if moved non-interactively, it goes to the top.
2. **Review column unpredictable.** Cards added to review recently sometimes appear farther down than older cards. Expected: review is ordered by "most recently added to review", with drag able to override.

## How ordering works today

Two columns in `public.tickets` drive board ordering:

- `board_position` (integer, default 0) — sort key for non-complete columns.
- `updated_at` — sort key for the `complete` column.

### Backend reads

| Path | Sort |
|---|---|
| `loadAllBoardTicketsForStatus` in `lib/actions/tickets/ticket-board.ts` (non-complete) | `board_position ASC`, paginated 1000 at a time |
| `loadBoardTicketsForStatus` in `lib/actions/tickets/ticket-board.ts` (complete) | `updated_at DESC`, limit 20 |
| Same split in `apps/web/app/(app)/tickets/(components)/TicketsBoardContent.tsx` | identical |

### Frontend display

`KanbanBoard.tsx` `groupTickets` and `TicketListView.tsx`:

```ts
if (isCompleteColumn) {
  // updated_at DESC, then board_position ASC as tiebreaker
} else {
  // board_position ASC
}
```

### Writes that touch ordering

| Path | Sets `board_position`? | Emits `status_change` event? |
|---|---|---|
| `assignTicketToColumnStart` / `…End` (create flows in `internals.ts`) | yes — `min - 1` or `max + 1` | n/a |
| `reorderTicketsAction(orderedIds, statusChange?)` (drag-end mutation) | yes — renumbers passed IDs `0..N` | the status update goes through `updateTicketStatusAndSchedule` which emits one (no `objective_id`) |
| `updateTicketStatusAndSchedule` (used by ticket detail page + drag status-change tail) | **no** — only writes `status` | yes, but with **no `objective_id`** |
| `POST /api/protocol/update` (agent `--phase review`) | yes — top of review | yes, with `objective_id` |
| `POST /api/protocol/deliver` | yes — top of review | yes, with `objective_id` |
| `POST /api/protocol/ask` | **no** | **no** |
| `protocol-record-work` (create-then-deliver shortcut) | yes — top of review | n/a (insert) |

### Realtime handlers (`apps/web/app/(app)/tickets/(components)/realtime-subscriptions.ts`)

- `tickets` UPDATE → `reconcileRealtimeTicketRow` merges all fields. Guarded by `isStaleUpdate(existing.updated_at, incoming.updated_at)`.
- `ticket_events` INSERT with `event_type='status_change'` → `handleStatusChangeEvent`:
  - Always bumps cached `updated_at` to the event's `created_at`.
  - Only moves to top of column when `phase === 'review' && objective_id !== null`. Other phases preserve `board_position`.

### Optimistic reducers (`lib/client-data/tickets/board-reducers.ts`)

- `moveTicketBetweenStatuses` — places at `min - 1` of the new column (top).
- `reorderTicketsInColumn` — renumbers explicit `orderedIds` to `0..N`.
- Drag-end chains both: `moveTicketBetweenStatuses` first (top), then `reorderTicketsInColumn` overrides with the actual drop index.

## Root causes

### Bug 1 — drag review→complete

The complete column sorts by `updated_at DESC`. The drag mutation writes only `board_position`; `updated_at` is updated later by the separate status-change write. Sequence:

1. Drag-end fires. Optimistic state puts the ticket in complete with `board_position = dropIndex`, but `updated_at` is still the *old* value (often hours/days stale).
2. `groupTickets` re-runs. Complete sort is `updated_at DESC`, so the ticket falls to the **bottom**.
3. Server processes the mutation. `reorderTicketsAction` writes board_position, then `updateTicketStatusAndSchedule` writes status and inserts a `status_change` event.
4. Realtime fires. `handleStatusChangeEvent` sets cached `updated_at = event.created_at`. Now it has the newest `updated_at` and **jumps to the top**.

Contributing factor: the `status_change` event from `updateTicketStatusAndSchedule` has no `objective_id`, so the `shouldMoveToTopOfReview` branch is dead for this path anyway.

### Bug 2 — review unpredictable

Three contributing causes:

1. **`/api/protocol/ask` doesn't reposition.** It does `UPDATE tickets SET status = 'review'` but never touches `board_position` and never inserts a `status_change` event. So the ticket carries forward whatever `board_position` it had in `execute` (could be anywhere — e.g., `42`), and no client gets the optimistic top-placement signal.
2. **`updateTicketStatusAndSchedule` doesn't reposition either.** Any non-drag UI path that calls this (status dropdown on ticket detail page, etc.) lands a ticket into review at its previous column's position.
3. **`board_position` drifts.** `reorderTicketsAction` renumbers `0..N` only for the IDs passed. After many partial reorders and cross-column moves, positions in a column become arbitrary integers (e.g., `-7, -3, 0, 3, 42`). When a ticket later enters that column without an explicit "place at top" write, it lands wherever its old integer falls.

Plus: server/client can diverge. The realtime handler optimistically slots a review ticket to top, but if the server never wrote `board_position`, a fresh load or the 30 s `syncBoardData` poll re-pulls the DB row and the ticket reverts to its old position.

## Recommended fix

End-state invariant: **every column sorts by `board_position ASC`. Any status change (drag, agent, API) top-places the ticket unless the caller explicitly chose a slot. Drags within or across columns adjust position.**

### Step 1 — top-place on every status change (server)

In `updateTicketStatusAndSchedule` (`lib/actions/tickets/internals.ts`), after writing `status` (and only when the status actually changed), call `assignTicketToColumnStart(supabase, ticketId, status, organizationId)`. Include `objective_id` on the emitted `status_change` event when it's available to the caller.

### Step 2 — fix `ask`

In `apps/web/app/api/protocol/ask/route.ts`, mirror what `update`/`deliver` already do:

- Compute `min(board_position) - 1` for the target status and write it alongside `status`.
- Insert a `status_change` ticket_event with `phase`, `objective_id`, and a summary, so the realtime UI fires its sound/notification path and other tabs get the optimistic top-placement signal.

### Step 3 — drop dual-sort on complete column

- Server: `loadBoardTicketsForStatus` in `lib/actions/tickets/ticket-board.ts` (and the duplicate flow in `TicketsBoardContent.tsx`). Sort complete by `board_position ASC`. Keep `updated_at` only as the pagination cursor (or migrate the cursor to `board_position`).
- Client: `groupTickets` in `KanbanBoard.tsx` and the equivalent block in `TicketListView.tsx`. Drop the `isCompleteColumn` branch.

### Step 4 — generalize realtime top-placement

In `handleStatusChangeEvent` (`realtime-subscriptions.ts`), generalize:

```ts
const targetType = state.ticketStatusesByName[event.phase]?.status_type;
const shouldMoveToTop = targetType === 'review' || targetType === 'complete';
```

The `status_types` map is already in board state. This makes agent-driven completions float to the top alongside review.

### Step 5 (optional, recommended) — position compaction

Nightly job, or a one-shot per-column on bootstrap, that compacts each column's positions:

```sql
UPDATE tickets t
SET board_position = r.rn - 1
FROM (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id, status ORDER BY board_position, created_at
  ) AS rn
  FROM tickets
) r
WHERE r.id = t.id AND t.board_position <> r.rn - 1;
```

Prevents the integer drift identified in Bug 2 cause (3) without changing semantics.

### Alternative to Steps 1–2 — DB trigger

A `BEFORE UPDATE` trigger on `tickets`: when `OLD.status IS DISTINCT FROM NEW.status` and `NEW.board_position` is the same as `OLD.board_position` (i.e., the caller didn't explicitly set it), set `NEW.board_position = (SELECT COALESCE(MIN(board_position), 0) - 1 FROM tickets WHERE organization_id = NEW.organization_id AND status = NEW.status AND id <> NEW.id)`.

Pros: centralized, no caller can forget, covers future code paths automatically. Cons: hidden behavior on a hot table; harder to opt out when a caller does want to preserve position.

## Edge cases worth verifying after implementation

| Edge case | Expected |
|---|---|
| Two clients drag the same column simultaneously | Last writer wins on `reorderTicketsAction`; both clients converge after realtime |
| Drag *into* review from another client | `tickets` UPDATE arrives with the new `board_position`; the cache merges in via `mergeRealtimeTicketRow` |
| `ask` triggered while another tab has the board open | New `status_change` event reaches the other tab → optimistic top-placement, sound, unread indicator |
| Reorder within complete column | After Step 3, behaves like any other column |
| Bootstrap of a column with thousands of tickets | Already paginated 1000-at-a-time — fine |
| `getTopBoardPositionForStatus` racing on two near-simultaneous events | Both events resolve to `min - 1`; realtime convergence settles it |

## Suggested implementation order

1. Step 1 + Step 2 (server-side top-placement on all status changes) — fixes Bug 2 root cause; also fixes the user-visible part of Bug 1 since agent-driven completions now land at top by data, not by `updated_at` accident.
2. Step 4 (generalize realtime branch) — ensures the optimistic UX matches the new server behavior for any state-type that should top-place.
3. Step 3 (drop dual-sort) — removes the bottom-then-top jump entirely. Do this *after* Steps 1, 2, and 4 so completes still float to the top.
4. Step 5 (compaction) — schedule as a periodic Supabase Edge Function or pg_cron job once the above stabilizes.

Each step is independently shippable. Steps 1 and 2 are the highest-leverage fixes and should land first.
