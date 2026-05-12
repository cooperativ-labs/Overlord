# Ticket events: auto-associate `objective_id`

**Ticket:** 1:1006 (follow-up)  
**Context:** `ticket_events` already has an optional `objective_id` column (FK to `objectives`). We want new rows to pick the right objective **without** agents or clients having to pass it.

## Goal

On every `ticket_events` insert, when `objective_id` is null, set it to:

1. The objective for that ticket with `state = 'executing'`, **newest by `created_at`** (if any).
2. Else the objective with `state = 'complete'`, **newest by `completed_at`**, falling back to **`created_at`** if `completed_at` is null.

If the caller already supplies `objective_id`, **leave it unchanged** (explicit override).

## Recommended approach: database trigger

`ticket_events` is inserted from many surfaces (protocol API routes, MCP edge handlers, `lib/actions/*`, mobile app, `insertTicketEvent`, etc.). A single **`BEFORE INSERT`** trigger on `public.ticket_events` covers all current and future call sites.

### Migration contents (sketch)

- `public.resolve_ticket_event_objective_id(p_ticket_id uuid) returns uuid`  
  - Query 1: `objectives` where `ticket_id = p_ticket_id` and `state = 'executing'` order by `created_at desc` limit 1.  
  - Query 2: else same ticket, `state = 'complete'` order by `completed_at desc nulls last`, `created_at desc` limit 1.
- `public.set_ticket_event_objective_id()` trigger function: if `NEW.objective_id` is null and `NEW.ticket_id` is not null, set `NEW.objective_id` from the resolver.
- `CREATE TRIGGER ... BEFORE INSERT ON public.ticket_events FOR EACH ROW EXECUTE FUNCTION ...`.
- Optional: update column comment to note auto-fill when null.

**Existing migration:** `supabase/migrations/20260512140000_ticket_events_objective_id.sql` adds the column and index; a **new** migration should add the function + trigger (do not rewrite shipped migration history).

## Flows to validate

| Scenario | Expected |
|----------|----------|
| Normal execute | `executing` objective wins. |
| Deliver → `status_change` event | Objective is marked `complete` before insert; no `executing`; trigger should attach **latest complete** (the one just delivered), using `completed_at` / `created_at`. |
| Resume after delivery | Code may set an objective back to `executing`; subsequent events bind to that row. |
| Multiple `executing` (edge) | Newest `created_at` among `executing` keeps behavior deterministic. |

## Implementation checklist

1. Add new timestamped migration under `supabase/migrations/` (resolver + trigger).
2. Apply locally (`supabase db reset` or your usual migrate path).
3. Run `yarn generate` so `types/database.types.ts` matches the schema (no hand-edited types for this).
4. Add tests: SQL or integration inserts on synthetic `objectives` + `ticket_events`, assert `objective_id` after insert.
5. Deploy migration to hosted Supabase before relying on queries that filter by `objective_id`.

## Optional follow-ups (not required for correctness)

- Document that null `objective_id` on insert is auto-filled at the DB layer.
- Align any in-app “resolve active objective” helpers (e.g. checkpoint code) with the same ordering rules if we want one mental model everywhere.

## Out of scope

- Changing RLS or event payloads.
- Making `objective_id` NOT NULL (explicitly optional when no objective exists).

## Workspace hygiene

Before landing the migration + tests, isolate from unrelated dirty files (stash, branch, or separate PR) so the change stays reviewable.
