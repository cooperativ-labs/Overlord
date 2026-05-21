# Associate `agent_sessions` with `objectives`

**Ticket:** 1:1174 - *agent_sessions should be associated with objectives, not tickets*

## Goal

Keep `agent_sessions` as the protocol/session table, but change its ownership from tickets to objectives:

- `agent_sessions.objective_id -> objectives.id`
- Drop `agent_sessions.ticket_id`
- Keep session-specific fields on `agent_sessions`: `session_key`, `session_state`, `connection_method`, heartbeat timestamps, `external_session_id`, `external_url`, and `metadata`
- Stop storing `session_id` on tables that only need objective-level provenance
- Keep `session_id` only where exact launch/session provenance still matters

This preserves the original requirement that external/native sessions remain associated with `agent_sessions`, while making objectives the durable unit of work across the product.

No legacy compatibility. Single migration. Everyone moves to the updated app immediately.

---

## 1. Data model

### 1.1 `agent_sessions`

Add objective ownership:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `objective_id` | uuid references `public.objectives(id)` on delete cascade | initially nullable, then not null after backfill | Durable objective this session is attached to |

Remove ticket ownership:

| Column | Action | Notes |
|---|---|---|
| `ticket_id` | drop | Ticket is reachable through `agent_sessions -> objectives -> tickets` |

Keep all session fields on `agent_sessions`:

- `id`
- `agent_identifier`
- `connection_method`
- `session_state`
- `session_key`
- `metadata`
- `heartbeat_at`
- `attached_at`
- `detached_at`
- `external_session_id`
- `external_url`
- timestamps

Indexes:

- Keep `agent_sessions_session_key_key`
- Keep or recreate the session key lookup index if needed
- Add `agent_sessions_objective_id_idx` on `(objective_id)`
- Add `agent_sessions_objective_attached_idx` on `(objective_id, attached_at desc)` for "latest session for objective"

RLS:

- Rewrite `agent_sessions_*` policies to authorize through `objective_id -> objectives.ticket_id -> tickets.organization_id`
- Do not add public lookup-by-session-key policies. Protocol routes and MCP functions already use service-role clients for session auth.

Realtime:

- Keep `agent_sessions` in `supabase_realtime`
- Realtime handlers must account for payloads no longer containing `ticket_id`; they should derive `ticket_id` from `objective_id` when needed

### 1.2 Tables that should drop `session_id`

These tables should use objective-level provenance only:

| Table | Current state | Target |
|---|---|---|
| `artifacts` | `session_id`, no `objective_id` | add nullable `objective_id`, backfill, drop `session_id` |
| `feed_posts` | `session_id`, `objective_id`, `source_session_ids uuid[]` | drop `session_id`; replace `source_session_ids` with `source_objective_id uuid` |
| `objective_attachments` | `objective_id`, `session_id` | keep `objective_id`, drop `session_id` |
| `shared_state` | `ticket_id`, `session_id` | add nullable `objective_id`, backfill when possible, drop `session_id` |
| `ticket_events` | `ticket_id`, nullable `objective_id`, nullable `session_id` | backfill `objective_id`, drop `session_id` |

Notes:

- `shared_state.objective_id` stays nullable because some state can remain ticket-scoped.
- `ticket_events.objective_id` stays nullable because system/user events may not always belong to a specific objective.
- `artifacts.objective_id` should be nullable unless every artifact can be reliably linked during migration.

### 1.3 Tables that should keep `session_id`

These tables intentionally preserve exact session provenance:

| Table | Why it keeps `session_id` |
|---|---|
| `file_changes` | Review/debug surfaces may need the exact agent session that produced a change, especially if the same objective has multiple sessions |
| `project_checkpoints` | Checkpoints are session snapshots and should continue to identify the exact session that created them |
| `execution_requests` | `launched_session_id` records the exact later session launched from an objective; this is the rare multi-session case the model must preserve |

`file_changes` and `project_checkpoints` already have `objective_id`; after the migration, writers should always populate both `objective_id` and `session_id`.

`execution_requests.launched_session_id` should keep its current name unless we want a separate cleanup migration. The important behavior is that it remains an FK to `agent_sessions(id)`.

---

## 2. Migration plan

### 2.1 Backfill `agent_sessions.objective_id`

Add `objective_id` nullable first:

```sql
alter table public.agent_sessions
  add column objective_id uuid references public.objectives(id) on delete cascade;
```

Build a temporary mapping from old `agent_sessions.id` to the best objective:

1. Prefer existing exact child data:
   - `execution_requests.launched_session_id -> execution_requests.objective_id`
   - `file_changes.session_id -> file_changes.objective_id`
   - `project_checkpoints.session_id -> project_checkpoints.objective_id`
   - `objective_attachments.session_id -> objective_attachments.objective_id`
   - `ticket_events.session_id -> ticket_events.objective_id`
   - `feed_posts.session_id -> feed_posts.objective_id`
2. If multiple objective ids are associated with one session, choose deterministically:
   - executing objective first
   - otherwise most recent objective by `updated_at`
   - record the ambiguous count before applying
3. Fallback only when no exact child data exists:
   - pick the executing/submitted/completed objective on the same old `agent_sessions.ticket_id`
   - prefer `executing`, then `submitted`, then latest `complete`

Important: do not use a blanket "one session per ticket" backfill. That loses provenance on tickets with multiple objectives.

After backfill:

```sql
alter table public.agent_sessions
  alter column objective_id set not null;
```

Then add indexes and drop the old FK/column:

```sql
create index agent_sessions_objective_id_idx
  on public.agent_sessions(objective_id);

create index agent_sessions_objective_attached_idx
  on public.agent_sessions(objective_id, attached_at desc);

alter table public.agent_sessions
  drop constraint if exists agent_sessions_ticket_id_fkey;

alter table public.agent_sessions
  drop column ticket_id;
```

### 2.2 Drop session FKs from objective-level tables

Create a reusable mapping:

```sql
with session_to_objective as (
  select id as session_id, objective_id
  from public.agent_sessions
)
-- use in per-table updates before dropping columns
```

`artifacts`:

```sql
alter table public.artifacts
  add column objective_id uuid references public.objectives(id) on delete set null;

update public.artifacts a
set objective_id = e.objective_id
from public.ticket_events e
where a.event_id = e.id
  and e.objective_id is not null
  and a.objective_id is null;

update public.artifacts a
set objective_id = m.objective_id
from session_to_objective m
where a.session_id = m.session_id
  and a.objective_id is null;

alter table public.artifacts
  drop constraint if exists artifacts_session_id_fkey,
  drop column session_id;
```

`feed_posts`:

- Add `source_objective_id uuid references public.objectives(id) on delete set null`
- Backfill `source_objective_id` from:
  1. `feed_posts.objective_id`
  2. `feed_posts.session_id -> agent_sessions.objective_id`
  3. the first/latest mapped objective from old `source_session_ids`
- Drop `session_id`
- Drop `source_session_ids`

Do not implement this as a simple `rename column source_session_ids to source_objective_id`, because the old column is `uuid[]` and the new column is a single `uuid`.

`objective_attachments`:

- Keep existing `objective_id`
- Drop `session_id`

`shared_state`:

- Add nullable `objective_id`
- Backfill from `session_id -> agent_sessions.objective_id`
- Drop `session_id`

`ticket_events`:

- Backfill `objective_id` from `session_id -> agent_sessions.objective_id` when `objective_id is null`
- Drop `session_id`

### 2.3 Keep exact-session tables intact

Do not drop these FKs:

- `file_changes.session_id -> agent_sessions(id)`
- `project_checkpoints.session_id -> agent_sessions(id)`
- `execution_requests.launched_session_id -> agent_sessions(id)`

Because `agent_sessions.id` remains stable, these constraints can stay valid while `agent_sessions.ticket_id` is dropped.

### 2.4 Migration verification

Before dropping old columns, report counts in the migration or in a local verification script:

- agent sessions with null `objective_id`
- sessions mapped by exact child data
- sessions mapped by fallback ticket heuristic
- sessions with conflicting child objective ids
- artifacts/feed posts/shared state/events that cannot be backfilled to an objective
- file changes with missing `objective_id`
- project checkpoints with missing `objective_id`
- execution requests with `launched_session_id` whose session has a different `objective_id` than the request

Expected handling:

- Fail the migration if any `agent_sessions.objective_id` remains null.
- Leave nullable child objective columns null only for genuinely ticket/system-scoped records.
- Fix `file_changes.objective_id` and `project_checkpoints.objective_id` before completing the migration, because those tables keep exact `session_id` and should also carry objective attribution.

---

## 3. Producer code

### 3.1 Attach/connect flows

Update:

- `lib/overlord/protocol-attach.ts`
- `lib/overlord/protocol-connect.ts`
- `supabase/functions/mcp/handlers/attach.ts`

Behavior:

1. Resolve or mark the target objective first.
2. Insert a new `agent_sessions` row with `objective_id`, not `ticket_id`.
3. Keep returning the real session id:

```ts
{
  id: session.id,
  sessionKey: session.session_key,
  state: session.session_state
}
```

4. When writing `ticket_events`, write `objective_id` instead of `session_id`.

`connect` should attach to the current executing objective. If no objective is executing, either error clearly or promote the most recent submitted objective using the same selection rules as attach.

### 3.2 Session resolution

Update:

- `lib/overlord/protocol-db.ts`
- `supabase/functions/mcp/session.ts`

`resolveSession(sessionKey, ticketId, organizationId?)` should:

1. Select `agent_sessions` by `session_key`.
2. Join through `objectives!inner(ticket_id)` to verify the supplied ticket id and organization.
3. Return the session row plus derived `objective_id` and `ticket_id`.
4. Update `agent_sessions.heartbeat_at`.
5. Mark stale sessions by updating `agent_sessions.session_state` and `detached_at`.

Do not move `session_key` or heartbeat state onto `objectives`.

### 3.3 Protocol event writers

Update every route/handler that currently inserts `ticket_events.session_id`:

- `apps/web/app/api/protocol/update/route.ts`
- `apps/web/app/api/protocol/deliver/route.ts`
- `apps/web/app/api/protocol/ask/route.ts`
- `apps/web/app/api/protocol/read-context/route.ts`
- `apps/web/app/api/protocol/write-context/route.ts`
- `apps/web/app/api/protocol/create-ticket/route.ts`
- `apps/web/app/api/protocol/request-approval-gate/route.ts`
- `apps/web/app/api/protocol/record-change-rationales/route.ts`
- `apps/web/app/api/protocol/attachments/*`
- matching `supabase/functions/mcp/handlers/*`

Replace:

```ts
session_id: resolved.session.id
```

with:

```ts
objective_id: resolved.session.objective_id
```

Keep passing `session.id` only into code paths that write `file_changes`, `project_checkpoints`, or `execution_requests.launched_session_id`.

### 3.4 File changes and checkpoints

Update:

- `lib/overlord/file-changes.ts`
- `lib/overlord/checkpoints.ts`
- `supabase/functions/mcp/handlers/_change-rationales.ts`
- `supabase/functions/mcp/handlers/_checkpoints.ts`

Writers should populate both:

- `session_id = resolved.session.id`
- `objective_id = resolved.session.objective_id`

This keeps exact session traceability while making objective queries direct.

### 3.5 Record-work and spawn

Update:

- `lib/overlord/protocol-record-work.ts`
- `lib/overlord/protocol-spawn.ts`
- `supabase/functions/mcp/handlers/record-work.ts`
- `supabase/functions/mcp/handlers/create-ticket.ts`

Record-work:

- Create/update the objective as today.
- Insert a completed `agent_sessions` row with `objective_id`.
- Insert events/artifacts using `objective_id`, not `session_id`.
- Insert file changes/checkpoints with both `session_id` and `objective_id`.

Spawn:

- Parent session lookup still uses `session_key`.
- Child ticket/objective creation remains the same.
- Child session insert uses child `objective_id`.
- Spawn events use parent `objective_id`.

### 3.6 Execution launch requests

Keep `execution_requests.launched_session_id`.

Update:

- `apps/web/app/api/protocol/complete-execution-launch/route.ts`
- `lib/hooks/use-execution-request-launcher.ts`
- desktop launcher code that reports launched session ids
- connector scripts/docs that expose `launched_session_id`

Validation to add:

- If `launched_session_id` is provided, verify the session's `objective_id` matches `execution_requests.objective_id`.

---

## 4. Consumer code

### 4.1 Running sessions

Keep `lib/actions/agent-sessions.ts`; do not rename it to objective sessions.

Rewrite queries from:

```ts
agent_sessions.ticket_id -> tickets
```

to:

```ts
agent_sessions.objective_id -> objectives.ticket_id -> tickets
```

Affected functions:

- `getRunningAgentSessionCountAction`
- `getRunningAgentSessionsAction`
- `stopRunningAgentSessionAction`

The returned `id` stays the real `agent_sessions.id`.

### 4.2 Ticket detail live session

Update:

- `apps/web/components/features/TicketLiveProvider.tsx`
- `apps/web/components/features/TicketPanelContent.tsx`
- `apps/web/components/features/TicketPanelLive/AgentSessionBadge.tsx`
- `apps/web/components/features/TicketPanelLive/TicketPanelLive.tsx`
- `lib/hooks/use-ticket-realtime.ts`
- `lib/client-data/tickets/detail-hooks.ts`
- `apps/mobile/lib/hooks/use-ticket-realtime.ts`

Queries should fetch latest session for a ticket through objectives:

```sql
agent_sessions
  join objectives on objectives.id = agent_sessions.objective_id
where objectives.ticket_id = :ticket_id
order by agent_sessions.attached_at desc
limit 1
```

UI state still reads:

- `session.session_state`
- `session.agent_identifier`
- `session.external_url`
- `session.external_session_id`

### 4.3 Board/list realtime

Keep `agent_sessions` realtime subscriptions if the board still displays active-agent state.

Update handlers so `agent_sessions` events route through `objective_id`:

1. Receive session insert/update.
2. Look up or cache `objective_id -> ticket_id`.
3. Apply the existing session override to that ticket.

Affected files:

- `apps/web/app/(app)/tickets/(components)/useTicketBoardRealtime.ts`
- `apps/web/app/(app)/tickets/(components)/TicketsBoardContent.tsx`
- `apps/web/app/(app)/tickets/(components)/ticket-view-helpers.ts`
- `apps/web/app/(app)/tickets/(components)/KanbanCard.tsx`
- `apps/web/app/(app)/tickets/(components)/TicketListCard.tsx`

Do not remove the active-agent badge as part of this migration unless there is a separate product decision to do so.

### 4.4 Feed

Update:

- `lib/actions/feed.ts`
- `apps/mobile/lib/hooks/use-executing-feed-tickets.ts`
- `apps/mobile/lib/feed-posts.ts`
- `lib/hooks/use-feed-realtime.ts`
- `supabase/functions/generate-feed-post/index.ts`
- demo/example feed data

Changes:

- Drop `feed_posts.session_id`
- Replace `feed_posts.source_session_ids` with `feed_posts.source_objective_id`
- Fetch active sessions through `agent_sessions.objective_id -> objectives.ticket_id`
- When generating feed posts, set:
  - `objective_id` to the canonical/latest objective for the post
  - `source_objective_id` to the source objective that replaces legacy session provenance
  - `agent_type` from the latest relevant `agent_sessions.agent_identifier`

### 4.5 Project file changes API

Update:

- `apps/web/app/api/projects/[projectId]/file-changes/route.ts`
- `tests/app/api/projects/file-changes/route.test.ts`

Because `file_changes.session_id` stays:

- Keep loading session details from `agent_sessions`
- Adjust any joins or response expectations that previously assumed `agent_sessions.ticket_id`
- Verify each file change response has both objective context and exact session metadata

### 4.6 Shared state, artifacts, attachments

Update:

- protocol artifact writers
- MCP attachment handlers
- `LiveArtifacts`
- `SharedStateSection`
- attachment list/finalize/upload routes

These should write/read objective attribution directly. They should not depend on `session_id`.

---

## 5. Types, seed, docs, and generated data

After migration:

1. Run `yarn generate` to regenerate `types/database.types.ts`.
2. Update `seed.ts`.
3. Run `yarn seed:sync` to regenerate `supabase/seed.sql`.
4. Update docs mentioning:
   - `agent_sessions.ticket_id`
   - `ticket_events.session_id`
   - `feed_posts.source_session_ids`
   - `execution_requests.launched_session_id` semantics
5. Update public docs:
   - `docs/public/feed-page-functionality.md`
   - `docs/public/auto-advance-flow.md`
6. Update demo/example content under `apps/web/example-content` and marketing demo data.

Important: the repo uses root `seed.ts`, not `supabase/seed.ts`.

---

## 6. Tests

Update existing tests:

- `tests/app/api/projects/file-changes/route.test.ts`
- `tests/supabase/file-changes-objective-id-trigger.test.ts`
- protocol attach/connect/update/deliver tests
- feed generation tests
- board realtime reducer tests

Add targeted tests:

- attach creates `agent_sessions.objective_id` and no longer writes `ticket_id`
- protocol update writes `ticket_events.objective_id` and no `session_id`
- file change insertion writes both `session_id` and `objective_id`
- project checkpoint insertion writes both `session_id` and `objective_id`
- execution launch completion can store a second later `launched_session_id` for the same objective
- feed post generation writes `source_objective_id`
- latest ticket session lookup works through objective join
- RLS allows session reads/writes through objective membership

---

## 7. Verification

Run:

1. `supabase db reset`
2. `yarn generate`
3. `yarn seed:sync`
4. `yarn lint`
5. `yarn build`
6. relevant Jest/Supabase tests

Manual smoke:

1. Create a ticket with multiple objectives.
2. Attach to the submitted objective.
3. Confirm `agent_sessions.objective_id` is set and `ticket_id` is gone.
4. Send update/deliver events; confirm `ticket_events.objective_id` is set.
5. Record change rationales; confirm `file_changes.session_id` and `objective_id` are both set.
6. Create checkpoint; confirm `project_checkpoints.session_id` and `objective_id` are both set.
7. Generate feed post; confirm no `session_id`, no `source_session_ids`, and `source_objective_id` is set.
8. Launch a second session for the same objective; confirm `execution_requests.launched_session_id` points to the later session.
9. Verify board/list active-agent state and ticket panel AgentSplitButton still reflect the latest attached session.

---

## 8. Risks and decisions

1. **Ambiguous historical sessions.** Some old session rows may have child records tied to multiple objectives. The migration should report these and choose deterministically instead of silently using ticket-level recency everywhere.

2. **`source_objective_id` is singular.** This follows the latest product direction. It is not a direct type-preserving rename from `source_session_ids`; implement it as add/backfill/drop.

3. **Exact session provenance becomes intentionally narrower.** After this migration, exact session identity remains on `file_changes`, `project_checkpoints`, and `execution_requests`. Artifacts, feed posts, attachments, shared state, and ticket events become objective-level.

4. **Realtime routing needs an extra lookup/cache.** `agent_sessions` payloads will no longer contain `ticket_id`; board and detail subscriptions need to route via `objective_id`.

5. **RLS must be updated before dropping `ticket_id`.** Current `agent_sessions` policies authorize through `ticket_id`. Dropping the column before replacing policies will break authenticated access.

6. **Connector surface should keep the returned session id stable.** CLI/MCP clients can keep treating `session.id` as the real `agent_sessions.id`; only the database ownership changes.

---

## 9. Execution checklist

- [ ] Write migration `supabase/migrations/20260521120000_agent_sessions_objective_ownership.sql`.
- [ ] Add and backfill `agent_sessions.objective_id`.
- [ ] Rewrite `agent_sessions` RLS through objectives.
- [ ] Drop `agent_sessions.ticket_id`.
- [ ] Add/backfill/drop objective-level table columns:
  - [ ] `artifacts.objective_id`, drop `artifacts.session_id`
  - [ ] `feed_posts.source_objective_id`, drop `feed_posts.session_id` and `source_session_ids`
  - [ ] drop `objective_attachments.session_id`
  - [ ] `shared_state.objective_id`, drop `shared_state.session_id`
  - [ ] backfill `ticket_events.objective_id`, drop `ticket_events.session_id`
- [ ] Keep and verify:
  - [ ] `file_changes.session_id`
  - [ ] `project_checkpoints.session_id`
  - [ ] `execution_requests.launched_session_id`
- [ ] Update protocol producers and MCP handlers.
- [ ] Update session resolution helpers.
- [ ] Update file-change and checkpoint writers to populate both objective and session ids.
- [ ] Update running-session actions and ticket detail live session queries.
- [ ] Update board/list realtime routing through `objective_id`.
- [ ] Update feed generation/actions/mobile hooks for `source_objective_id`.
- [ ] Update project file changes API and tests.
- [ ] Update `seed.ts`, run `yarn seed:sync`, and commit regenerated `supabase/seed.sql`.
- [ ] Update docs and demo/example data.
- [ ] Run `supabase db reset`, `yarn generate`, `yarn lint`, `yarn build`, and targeted tests.
- [ ] Manual smoke the multi-session objective flow.
