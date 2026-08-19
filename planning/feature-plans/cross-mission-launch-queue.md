# Cross-Mission Queuing System (Launch Queue)

**Mission:** coo:786 · **Objective:** coo:786.e2s9 · **Status:** design investigation
**Date:** 2026-08-19
**Author:** agent (claude-opus-5)

---

## 1. Recommendation in one paragraph

Do **not** extend `execution_requests` into a user-managed queue. Keep it exactly what it is
today — the *launch queue*: a short-lived, runner-claimable, immediately-drainable work list.
Instead add one new durable table, **`launch_queue_entries`**, that expresses *intent* ("this
objective should run, in this position, when capacity frees up"), plus a **dispatcher** that
converts the head of that queue into an ordinary `execution_requests` row at exactly the moment
auto-advance would have created one today. Auto-advance then stops being a per-objective boolean
and becomes "this objective has a queue entry"; the existing `objectives.auto_advance` column and
its wire field survive one release as a compatibility alias mapped onto queue membership. Mission
objective `position` stays the canonical intra-mission order but becomes **derived from** the queue
by write-through renumbering, so the two orderings can never disagree.

Two queues, clearly separated:

| | **Launch queue** (existing, `execution_requests`) | **Run queue** (new, `launch_queue_entries`) |
|---|---|---|
| Meaning | "A runner should start this *now*" | "This should run when the lane frees up" |
| Drain rule | Claimed as soon as a runner is free | Head dispatched when the previous entry **delivers** |
| Lifetime | Seconds–minutes | Minutes–days |
| Ordering | `created_at` (FIFO, not user-visible) | User-mutable `position`, cross-mission |
| Owner | Runner Layer | Operator (the human) |
| Mutability | Clear-all only | Insert / remove / reorder |

The rest of this document is the evidence for that recommendation and the full design.

---

## 2. What exists today

### 2.1 Auto-advance

Auto-advance is a per-objective boolean (`objectives.auto_advance`,
`database/postgres/migrations/002_initial_core.sql:438`) that is read in exactly one hot path:
`protocolDeliver` in `packages/core/service/protocol.ts:2172-2340`.

On delivery, that code:

1. Reads the just-delivered objective's `assigned_agent` / `model` / `reasoning_effort`
   (`protocol.ts:2173`) so the next objective can inherit them.
2. Calls `ensureNextDraftObjective` (`packages/core/service/missions.ts:491`), which promotes the
   first authored `future` objective to `draft` when no authored draft exists.
3. Selects **the next objective by `position`** that is `state = 'draft'` **and** has non-blank
   `instruction_text` (`protocol.ts:2189-2196`). Blank drafts and `future` objectives are invisible
   to this query.
4. Checks `findConflictingActiveSibling` (`packages/core/service/objective-parallelism.ts:48`) —
   any active sibling objective, or any sibling holding an active execution request, aborts the
   advance unless `missions.allow_parallel_objectives` is set.
5. If `auto_advance = 1`: flips the objective to `launching`, optionally persists the inherited
   agent selection, resolves the execution target + launch config
   (`resolveLaunchExecutionTarget` / `resolveLaunchConfig`), and calls `createExecutionRequest`
   with `requestedSource: 'auto_advance'` and `idempotencyKey: 'auto_advance:<objectiveId>'`.
6. If not: writes an `awaiting_approval` mission event instead.
7. Failure to queue is swallowed into an `alert` mission event
   (`protocol.ts:2314-2334`) — the chain silently stops.

There is a pure planner mirror of this decision in the Automations Layer,
`decideAutoAdvanceAfterDelivery` (`automations/src/objective-manager/rules.ts:383`), which returns
`queue_launch | await_approval | none` and already owns the `auto_advance:<id>` idempotency key
convention. **This is the natural home for the new dispatch planner.**

Structural limits of auto-advance, all of which the new design must remove:

- **Mission-local.** The next objective is found with `WHERE mission_id = ? AND position > ?`.
  There is no concept of "what runs after this mission finishes".
- **Adjacency-only.** Only the immediately-next draft can advance. An auto-advance objective sitting
  two slots down never fires if the slot above it is not also auto-advance.
- **Invisible.** The only representation of the chain is the boolean on each card plus a derived
  read in the activity feed (`backend/activity-feed.ts:233-360`), which walks forward from a running
  objective and stops at the first `auto_advance !== 1` — "what sits behind a manual gate is not up
  next".
- **Runs inside the delivering agent's request context.** `protocolDeliver` executes with the
  delivering session's workspace and actor. It has no authority to launch work in a *different*
  workspace, which cross-mission queuing requires.

### 2.2 The launch queue (`execution_requests`)

`execution_requests` (`002_initial_core.sql:674`) is a per-workspace work list with status
`queued → claimed → launching → launched|failed` and terminal `cleared|cancelled|expired`
(closed vocabulary, `CONTRACT.md:857`).

- Created by `createExecutionRequest` (`packages/core/service/execution-requests.ts:358`), which
  **freezes** the resolved working directory, resource, execution target, agent/model, and launch
  flags at creation time.
- Claimed by `claimNextExecutionRequest` (`execution-requests.ts:568`) with
  `ORDER BY er.created_at ASC LIMIT 1` and an atomic revision CAS, gated on
  `o.state IN ('draft','submitted','launching')`. On Postgres the claim long-polls on `LISTEN`
  (`CONTRACT.md:618` Runner → REST queue surface).
- **It drains immediately.** There is no wait-for-delivery semantic anywhere in it, and per the
  objective statement that must stay true.
- Cleared wholesale by `clearExecutionRequests` (`execution-requests.ts:966`) — the "Clear" button
  in `webapp/web/components/runner/RunnerStatusModal.tsx:270`.
- Removed per objective by `dequeueObjective` (`backend/execution/launch.ts:980`) when a user
  completes, disconnects, or deletes an objective.

### 2.3 Objective ordering

- `objectives.position` is `integer NOT NULL`, unique per mission among non-deleted rows
  (`002_initial_core.sql:453`).
- `reorderFutureObjectives` (`backend/repository.ts:6662`) renumbers only the `future` group,
  starting at the lowest position that group already holds, using a temp-position pass first so
  swaps do not trip the unique index. It rejects any non-`future` objective.
- The mission panel renders three groups — executed / editable (`draft|submitted|launching`) /
  future — and only the future group is drag-sortable
  (`webapp/web/components/objectives/MissionObjectivesSection.tsx:125-215`).
- `position` is load-bearing beyond display: `protocolDeliver`'s next-objective query, the activity
  feed's upcoming chain, `ensureNextDraftObjective`, and `createExecutionRequest`'s
  "first launchable objective" fallback (`execution-requests.ts:404`) all order by it.

### 2.4 Cross-workspace ordering precedent

`my_mission_positions` (`002_initial_core.sql:403`) already solves "a personal ordering that spans
workspaces": rows are workspace-scoped (so FKs and RBAC behave), `position` is `double precision`,
and `reorderWorkspaceMyMissionsTx` (`backend/repository.ts:6418`) assigns positions **across the
whole aggregated column** after resolving the caller's membership per workspace via
`callerMembershipsInActiveOrganization` (`backend/repository.ts:6227`). The new queue should copy
this shape exactly.

### 2.5 Durable background work

`worker_jobs` + `WorkerJobPoller` (`packages/core/service/worker-jobs.ts`,
`backend/worker-job-poller.ts`) give a leased, retrying, dedupe-capable in-process job queue
(`workerJobJsonFieldPredicate` supports coalescing identical active jobs on one payload field).
This is the correct host for the dispatcher: it decouples dispatch from the delivering agent's
request context and gives it its own authorization scope and retry policy.

### 2.6 UI surfaces that touch auto-advance

| Surface | File | Role |
|---|---|---|
| Auto-advance popover (fast-forward / pause icon + switch) | `webapp/web/components/objectives/DraftObjectiveActions.tsx:92-129` | The control the objective statement wants repurposed as the **Queue** button |
| "Enable auto-advance instead of launching" confirm path | `webapp/web/components/objectives/AgentLaunchButton.tsx:130-140` | Offered when a sibling is already running |
| Auto-advance badge on collapsed objectives | `webapp/web/components/objectives/ObjectiveCollapsibleItem.tsx:200-220` | Read-only indicator |
| Runner modal queue list | `webapp/web/components/runner/RunnerStatusModal.tsx:250-345` | Shows raw `execution_requests`; diagnostic, not a plan |
| Activity feed "upcoming" chain | `webapp/web/components/activity-feed/*`, fed by `backend/activity-feed.ts:345` | Derived per-mission auto-advance chain |

### 2.7 Agent-facing surfaces

`--auto-advance` / `--no-auto-advance` and per-item `autoAdvance` on `create`, `prompt`,
`add-objectives`, and `update-objective` (`cli/src/flag-registry.ts:86`, `cli/src/commands.ts:1472`,
`backend/protocol.ts:562-600, 984-995`), hosted MCP `overlord_create_mission`,
`overlord_add_objectives`, `overlord_update_objective` (`mcp/tool-catalog.ts:157, 223, 238`), and
REST `PATCH /api/objectives/:id { autoAdvance }`. Contract versions 75 and 88 (`CONTRACT.md:54, 67`)
pin these. All must keep working.

---

## 3. Requirements

From the objective statement, restated as testable requirements:

- **R1** — One queue spanning missions. Adding an objective to it is the replacement for
  auto-advance.
- **R2** — The per-objective control becomes a **Queue** button whose popover names *the objective
  that will precede this one* and offers **Remove from queue**.
- **R3** — A separate whole-queue interface listing every entry, with drag reorder for entries that
  are **not already running**.
- **R4** — Drain semantics match auto-advance: dispatch the next entry only **after the previous one
  delivers**. Dispatch means "write an `execution_requests` row"; that row still launches as soon as
  a runner is free.
- **R5** — Objective order within a mission becomes subordinate to the queue: two queued objectives
  on one mission appear in queue order; unqueued objectives sort below queued ones.
- **R6** — Clicking **Run** skips the queue and launches immediately.
- **R7** — Existing `execution_requests` behavior is unchanged.

Derived requirements the design must also satisfy:

- **R8** — Dispatch must work across workspaces, so it cannot run inside the delivering agent's
  protocol request context (§2.1).
- **R9** — Exactly-once launch per entry, surviving retries, concurrent deliveries, and backend
  restarts.
- **R10** — An entry must degrade safely when its objective is edited, deleted, completed by hand,
  moved to another mission, or has its resource disconnected while it waits.
- **R11** — Agent-facing `autoAdvance` semantics keep working unchanged (§2.7).

---

## 4. Options considered

### Option A — Extend `execution_requests` with a "waiting" status

Add `waiting` (or `deferred`) to `execution_requests.status`, keep them out of the claim predicate,
and promote to `queued` when the previous item delivers.

**Rejected.** Reasons, in order of weight:

1. `execution_requests` **freezes launch context at creation** — working directory, resolved
   resource, execution target, launch flags, agent/model (`execution-requests.ts:430-470`). A queue
   entry may wait hours. Resolving a working directory for a repo that is not connected yet, or
   pinning launch flags before the user edits their launch config, produces stale launches. Launch
   resolution belongs at dispatch, not enqueue.
2. `execution_requests.status` is a **closed contract vocabulary** (`CONTRACT.md:857`) consumed by
   the Runner Layer *and* the Virtual Target Gateway (`CONTRACT.md:635`). Adding a value forces a
   coordinated change across two external conformance surfaces for a purely internal concept.
3. Ordering. The claim is `ORDER BY created_at ASC`; user reordering would require a new
   position column on a table whose semantics are FIFO-by-arrival, and every runner would have to be
   trusted not to claim out of order.
4. `clearRunnerQueue` and `dequeueObjective` currently mean "abandon in-flight work". They would
   silently start meaning "erase the user's plan for the next three days".
5. `execution_requests` rows are per-objective launch *attempts*; retries create new rows. A queue
   entry must survive a failed attempt without losing its slot.

### Option B — Derive the queue from `auto_advance` plus a global ordering column

Keep the boolean, add `objectives.queue_position`, compute the queue as "all auto-advance objectives
ordered by that column".

**Rejected.** It puts a cross-mission, cross-workspace, cross-project ordinal on a mission-scoped
row; there is no place to hang lane settings (concurrency, pause), no entry-level state for
"dispatched but not yet running", no record of who queued it or when, and no way to keep an entry
while its objective is deleted-and-recreated. It also can't express "queued but currently blocked",
which the UI needs.

### Option C — New `launch_queue_entries` table + dispatcher (recommended)

Intent and mechanism separated; the queue *feeds* the existing launch queue exactly as the objective
statement asks. Everything below elaborates this option.

---

## 5. Recommended design

### 5.1 Data model

```sql
-- Postgres; SQLite mirror uses text timestamps and REAL position, per the
-- database/{postgres,sqlite}/migrations convention.
CREATE TABLE launch_queue_entries (
  id text PRIMARY KEY,
  -- Lane identity. A lane is one serialized stream of work.
  organization_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  owner_profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  lane_key text NOT NULL DEFAULT 'default',

  -- Row scoping: mirrors my_mission_positions so RBAC, change-feed, and cascade
  -- behavior are identical to every other workspace-scoped row.
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id   text NOT NULL REFERENCES projects (id)   ON DELETE CASCADE,
  mission_id   text NOT NULL REFERENCES missions (id)   ON DELETE CASCADE,
  objective_id text NOT NULL REFERENCES objectives (id) ON DELETE CASCADE,

  -- Global ordinal within the lane, assigned across all workspaces in the lane.
  position double precision NOT NULL,

  state text NOT NULL CHECK (state IN ('waiting', 'dispatched', 'running', 'blocked')),
  blocked_reason text,

  -- Who queued it; dispatch re-authorizes as this member in the entry's workspace.
  enqueued_by_workspace_user_id text REFERENCES workspace_users (id) ON DELETE SET NULL,
  enqueued_at timestamptz NOT NULL,
  dispatched_at timestamptz,
  execution_request_id text REFERENCES execution_requests (id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),

  FOREIGN KEY (workspace_id, objective_id) REFERENCES objectives (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, mission_id)   REFERENCES missions   (workspace_id, id) ON DELETE CASCADE
);

-- One live entry per objective, regardless of who queued it: a launch is global.
CREATE UNIQUE INDEX idx_launch_queue_entries_objective
  ON launch_queue_entries (objective_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_launch_queue_entries_lane
  ON launch_queue_entries (organization_id, owner_profile_id, lane_key, position)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_launch_queue_entries_mission
  ON launch_queue_entries (mission_id, position) WHERE deleted_at IS NULL;

CREATE TABLE launch_queue_lanes (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  owner_profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  lane_key text NOT NULL DEFAULT 'default',
  max_concurrent integer NOT NULL DEFAULT 1 CHECK (max_concurrent >= 1),
  paused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  UNIQUE (organization_id, owner_profile_id, lane_key)
);
```

Notes on the choices:

- **`double precision position`** copies `my_mission_positions`: an insert between two neighbours is
  a midpoint write, not a renumber of the whole queue. The reorder endpoint still rewrites the full
  order with a `(index + 1) * STEP` pass, as `reorderWorkspaceMyMissionsTx` does.
- **Lane = (organization, owner profile, lane_key).** `profiles.id` is the cross-workspace identity
  (`workspace_users.profile_id`, `002_initial_core.sql:133`), so one operator gets one lane across
  every workspace they belong to in the active organization. `lane_key` is carried from day one and
  defaults to `'default'`; it is the additive hook for later per-execution-target or per-resource
  lanes, which is a schema change we should not have to make twice.
- **No `done` archive.** History already lives in `execution_requests`, `mission_events`, and
  `deliveries`. Entries are soft-deleted when they leave the queue.
- **`blocked` state** exists so the UI can say "waiting on the sibling objective running in this
  mission" rather than silently stalling.

### 5.2 Lane semantics

- **Capacity.** The lane dispatches while `inFlight < max_concurrent`, where `inFlight` counts entries
  in `dispatched` or `running`, **plus** objectives launched manually by this operator that are
  currently `launching`/`executing`/`pending_delivery`. Manual runs consuming lane capacity is a
  judgement call — see Open Question **Q1**.
- **Default `max_concurrent = 1`** reproduces auto-advance exactly.
- **`paused`** stops dispatch without dequeuing anything. This is the single most useful operation
  the current system lacks and is nearly free here.

### 5.3 The dispatcher

**Where it runs.** A durable worker job, `overlord.launch-queue.dispatch.v1`, claimed by a
`WorkerJobPoller` subclass (`backend/launch-queue-dispatch-worker.ts`), deduped on a
`laneId` payload field via `workerJobJsonFieldPredicate`. It runs with a service context built per
entry with `buildWebappServiceContextForWorkspace(entry.workspace_id, tx, entry.enqueued_by_workspace_user_id)`
— the same helper `dequeueObjective` already uses (`backend/execution/launch.ts:1006`). This
satisfies **R8**: the dispatcher acts as the operator who queued the work, in that work's own
workspace, not as the delivering agent.

**Trigger points** (each one enqueues a deduped dispatch job; none of them dispatches inline):

| Trigger | Call site |
|---|---|
| Objective delivered | `protocolDeliver`, `packages/core/service/protocol.ts` (replaces the inline auto-advance block) |
| Objective completed / disconnected / deleted by a human | `dequeueObjective`, `backend/execution/launch.ts:980` |
| Execution request failed / expired / cleared | `markExecutionFailed`, `expireStaleExecutionRequests`, `clearExecutionRequests` |
| Entry enqueued, removed, or reordered | new launch-queue service |
| Lane settings changed (unpause, raise concurrency) | new launch-queue service |
| Safety sweep | periodic tick in the poller (e.g. every 30 s) that enqueues a dispatch job per lane with a non-empty queue |

The sweep is not optional: it is what heals a lane whose triggering event was lost to a crash
between the delivery transaction and the job insert.

**Algorithm** (pure planner in the Automations Layer, alongside `decideAutoAdvanceAfterDelivery`):

```
planLaunchQueueDispatch(lane, entries, context) -> Action[]

  if lane.paused: return []
  inFlight = count(entries where state in {dispatched, running}) + context.manualRunsInLane
  slots    = lane.maxConcurrent - inFlight
  if slots <= 0: return []

  actions = []
  for entry in entries where state in {waiting, blocked} ordered by position asc:
    if slots == 0: break
    o = context.objective(entry.objectiveId)

    // R10 — degrade safely
    if o is missing or deleted or state in {complete}:            actions += drop(entry, 'objective_gone');       continue
    if trim(o.instructionText) == '':                              actions += hold(entry, 'no_instruction');       continue
    if o.state in {executing, pending_delivery}:                   actions += markRunning(entry);  slots -= 1;     continue

    // Sibling lock — reuse siblingBlocksParallelLaunch verbatim
    if context.missionHasBlockingActiveSibling(o.missionId, o.id): actions += hold(entry, 'mission_busy');         continue
    if not context.resourceConnected(o):                           actions += hold(entry, 'resource_disconnected'); continue

    actions += dispatch(entry, {
      promoteFutureToDraft: o.state == 'future',
      agent: o.assignedAgent ?? context.inheritedAgentFor(o),      // last delivered objective on the mission
      idempotencyKey: 'launch_queue:' + entry.id
    })
    slots -= 1
  return actions
```

**`hold` vs `drop`.** `hold` leaves the entry in place and sets `state='blocked'` with a reason, then
the planner **continues to the next entry** rather than blocking the whole lane. Strict head-of-line
blocking would be simpler, but it means one disconnected repo freezes every mission you queued
behind it. Skipping with a visible reason is the better default; the entry keeps its position and is
retried on the next dispatch tick. See Open Question **Q2**.

**Applying an action** (in one transaction per entry, in the entry's workspace):

1. If `promoteFutureToDraft`, update `objectives.state` `future → draft`. `future` is not in
   `LAUNCHABLE_OBJECTIVE_STATES` (`execution-requests.ts:34`), so this promotion is mandatory —
   today it is done implicitly by `ensureNextDraftObjective`; here it becomes explicit and only
   happens to the objective actually being dispatched.
2. Set `objectives.state = 'launching'`, persisting the inherited agent/model/reasoning when the
   objective has none — identical to `protocol.ts:2237-2262`.
3. Resolve `resolveLaunchExecutionTarget` + `resolveLaunchConfig` **now** (dispatch time, not
   enqueue time).
4. `createExecutionRequest({ requestedSource: 'launch_queue', idempotencyKey: 'launch_queue:<entryId>', … })`.
5. Set entry `state='dispatched'`, `dispatched_at`, `execution_request_id`.
6. `recordChange` for the entry and a `status_change` mission event carrying
   `{ launchQueue: { entryId, action: 'dispatched', position } }`.

**Exactly-once (R9).** The idempotency key is keyed on the **entry id**, not the objective id, and
`execution_requests` already enforces `UNIQUE (workspace_id, idempotency_key)`
(`002_initial_core.sql:715`) with a read-through in `createExecutionRequest`
(`execution-requests.ts:430-436`). Two concurrent dispatch jobs for the same lane therefore cannot
double-launch. Entry state transitions additionally use the standard revision CAS. Requeuing a
dropped-and-re-added objective produces a new entry id and so a new key, which is correct.

**`requested_source = 'launch_queue'`.** `execution_requests.requested_source` is an open value with
a non-empty check; note that the table also carries
`CHECK (requested_source <> 'auto_advance' OR idempotency_key IS NOT NULL)`. Mirror that guard for
`'launch_queue'` in the migration.

**Entry lifecycle:**

```
                enqueue                dispatch            runner claims + agent attaches
   (none) ─────────────▶ waiting ─────────────▶ dispatched ─────────────────────────▶ running
                            ▲  │                     │                                   │
              unblock       │  │ hold                │ request failed/expired/cleared    │ delivered
                            └──┴──▶ blocked ─────────┘                                   ▼
                                                                                    (soft-deleted)
   Manual Run on a queued objective: waiting ──────────────────────────────────────▶ running
```

`waiting → running` directly is **R6**: the manual launch path stamps the entry rather than leaving
a stale `waiting` row that would later re-dispatch the same objective.

### 5.4 Ordering subordination (R5)

**Sort contract for a mission's objective list:**

1. Executed objectives (`executing`, `pending_delivery`, `complete`) keep their historical relative
   order at the top. The queue never reorders history.
2. Then queued objectives (`waiting`/`blocked`/`dispatched` entries), in **lane position order**.
3. Then unqueued `draft`/`future` objectives, in their existing relative order.

**Implementation: write-through, not derived-at-read.** Every queue mutation that touches a mission
(enqueue, remove, reorder) recomputes that mission's non-executed tail and renumbers
`objectives.position` accordingly, reusing the two-pass temp-position technique from
`reorderFutureObjectives` (`backend/repository.ts:6717-6730`) so the
`idx_objectives_active_mission_position` unique index is never violated mid-transaction.

Write-through rather than a derived read because `position` is consumed by `protocolDeliver`'s
next-objective query, the activity feed's upcoming chain, `ensureNextDraftObjective`, and
`createExecutionRequest`'s launchable fallback (§2.3). Deriving order only in the webapp would leave
those five readers disagreeing with the visible order. With write-through, they are automatically
correct and need no changes at all.

**The inverse direction — dragging inside a mission:**

- Dragging two **queued** objectives past each other → translated into a queue reorder that swaps
  exactly those two entries' `position` values, leaving every other lane entry untouched. Then the
  normal write-through runs. The local drag stays local.
- Dragging an **unqueued** objective above a queued one → **enqueues it at that slot**. This is the
  intuitive reading of the gesture and avoids an error toast for a legal-looking drag.
- Dragging a queued objective below every queued sibling → removes it from the queue. Symmetric with
  the above; confirm via the popover's Remove instead if we find this too implicit (Open Question
  **Q3**).
- The existing `PATCH /api/missions/:id/objectives/reorder` stays, but its handler routes queued
  members through the queue service instead of renumbering them directly.

### 5.5 Skip-the-queue (R6)

`launchObjective` (`backend/execution/launch.ts:1085`) is unchanged in its core behavior — it writes
an `execution_requests` row immediately. Two additions inside its existing transaction:

1. If the objective has a live queue entry, set that entry to `running` and stamp its
   `execution_request_id`. No duplicate dispatch, no lost position.
2. If it has no entry, nothing is created — a manual run is not a queue member. It does, however,
   count toward lane capacity while it is in flight (§5.2 / Q1).

The `AgentLaunchButton` "there's already a sibling running — enable auto-advance instead?" branch
(`AgentLaunchButton.tsx:130`) becomes "…add it to the queue instead?", calling the enqueue endpoint.

### 5.6 Lifecycle edge cases (R10)

| Event | Handling |
|---|---|
| Objective deleted | FK `ON DELETE CASCADE`; soft-delete path drops the entry in `dequeueObjective` |
| Objective manually completed | `dequeueObjective` drops the entry, then enqueues a dispatch job |
| Objective's instruction text emptied | Entry held with `no_instruction`; shown greyed in the queue view |
| Objective moved to another mission/project | Entry's `mission_id`/`project_id`/`workspace_id` updated in the same transaction as the move; lane position preserved |
| Mission cancelled / blocked status | All that mission's entries dropped, one `status_change` event summarizing the count |
| Resource disconnected | Held with `resource_disconnected`; retried each dispatch tick — this is exactly the failure that today produces a silent `alert` event and a stalled chain |
| Execution request fails or expires | Entry returns to `waiting` and keeps its position, so the retry is ordered rather than lost. Cap re-dispatch attempts (`attempt_count` on the entry, 3) then hold with `dispatch_failed` |
| Agent never attaches | Existing launch-TTL expiry (`CONTRACT.md:618`) fires, which is a trigger point |
| Two operators queue the same objective | Unique index on `objective_id` — the second enqueue returns the existing entry with a 409-style typed conflict, or moves it if the caller owns the lane |
| Backend restart mid-dispatch | Worker lease expiry re-claims; idempotency key prevents a double launch |

---

## 6. API surface

### 6.1 REST (Webapp/Mobile consumers)

```
GET    /api/launch-queue                    -> LaunchQueueDto
POST   /api/launch-queue/entries            { objectiveId, afterEntryId? | position? } -> LaunchQueueEntryDto
DELETE /api/launch-queue/entries/:id        -> { removed: true }
PATCH  /api/launch-queue/order              { orderedEntryIds: string[] } -> LaunchQueueDto
PATCH  /api/launch-queue/settings           { maxConcurrent?, paused? } -> LaunchQueueLaneDto
```

Authorization mirrors My Missions: resolve `callerMembershipsInActiveOrganization`, require
`objective:read` to see an entry and `execution_request:create` on the entry's workspace to add,
remove, or reorder it.

```ts
export interface LaunchQueueEntryDto {
  id: string;
  position: number;
  state: 'waiting' | 'blocked' | 'dispatched' | 'running';
  blockedReason: string | null;
  objectiveId: string;
  objectiveDisplayId: string;   // coo:786.e2s9
  objectiveTitle: string | null;
  missionId: string;
  missionDisplayId: string;
  missionTitle: string;
  projectId: string;
  projectName: string;
  workspaceId: string;
  assignedAgent: string | null;
  enqueuedAt: string;
  executionRequestId: string | null;
}

export interface LaunchQueueLaneDto { laneKey: string; maxConcurrent: number; paused: boolean; }

export interface LaunchQueueDto {
  lane: LaunchQueueLaneDto;
  entries: LaunchQueueEntryDto[];   // position ascending
  inFlight: number;
}
```

Additive on `ObjectiveDto` (`packages/contract/src/index.ts:672`) so every objective card can render
its queue state without a second fetch:

```ts
  /** Live launch-queue membership, or null when the objective is not queued. */
  queueEntry?: {
    id: string;
    position: number;
    state: 'waiting' | 'blocked' | 'dispatched' | 'running';
    blockedReason: string | null;
    /** The entry immediately ahead of this one in the lane — powers the popover (R2). */
    precededBy: { objectiveDisplayId: string; objectiveTitle: string | null; missionTitle: string } | null;
  } | null;
```

`ObjectiveDto.autoAdvance` stays, now **derived** as `queueEntry !== null`, and is documented as
deprecated.

### 6.2 Protocol / CLI

```bash
ovld protocol queue-objective   --objective-id coo:786.e2s9 [--after coo:701.a1b2 | --front | --position N]
ovld protocol dequeue-objective --objective-id coo:786.e2s9
ovld protocol queue             [--json]        # print the lane
```

Compatibility (**R11**): `--auto-advance` on `create` / `prompt` / `add-objectives` /
`update-objective` continues to mean "queue this objective", inserting it **immediately after the
last queued entry of its own mission**, else at the tail. That reproduces the old semantic ("run
after the objective before it") exactly for the single-mission case, which is the only case that
exists today. `--no-auto-advance` dequeues.

### 6.3 MCP

`overlord_update_objective` keeps `autoAdvance` with the mapping above. Add
`overlord_queue_objective { objectiveId, after? , remove? }` for explicit control, and expose the
lane read through the existing mission-context tools rather than a new one.

---

## 7. UI design

### 7.1 Per-objective Queue button (R2)

Repurpose `DraftObjectiveActions.tsx:92-129`. Same trigger position, three states:

```
 not queued   ──  [ ⏸ ]  amber      popover: "Add to queue"
 queued       ──  [ ⏩ ]  emerald    popover: position + predecessor + Remove
 running      ──  [ ▶ ]  blue       popover: read-only, "Running now"
```

Popover when queued:

```
┌──────────────────────────────────────────┐
│ In the queue · #4 of 7                   │
│                                          │
│ Runs after                               │
│   coo:701.a1b2 — Wire up the webhook     │
│   Mission: Outbound webhooks             │
│                                          │
│ [ Move to front ]      [ Remove from ⏏ ] │
│                                          │
│ View whole queue →                       │
└──────────────────────────────────────────┘
```

Popover when not queued shows what it *would* run after (the current tail, or the item above the
insertion point) before the user commits — the statement's "indicate the objective in the queue that
will precede the one the user is trying to add".

When blocked, the popover leads with the reason: "Held — the repository for this objective is not
connected", which is a strict improvement over today's silent `alert` event.

### 7.2 Whole-queue view (R3)

A route at `/queue` plus a sheet reachable from the sidebar (next to `RunnerStatusBox`, which stays
as the *runner* diagnostic — the two are deliberately different views and should be labelled
"Queue" and "Runner"). The queue view is cross-workspace, so it belongs beside `/inbox` and `/user`
in `webapp/web/router.tsx`, not inside a project.

```
Queue                                       ⏸ Pause    Running 1 of 1  ⚙
─────────────────────────────────────────────────────────────────────────
▶ RUNNING
  ⠿  coo:701.a1b2  Wire up the webhook        Outbound webhooks   claude   12m
─────────────────────────────────────────────────────────────────────────
NEXT UP
  ⠿  coo:701.c3d4  Add retry backoff          Outbound webhooks   claude
  ⠿  coo:786.e2s9  Design the queue           Cross-mission queue codex
  ⠿  coo:712.f5g6  Migrate the fixtures       Test fixtures       claude   ⚠ repo not connected
  ⠿  coo:701.h7i8  Document the webhook       Outbound webhooks   claude
─────────────────────────────────────────────────────────────────────────
```

- dnd-kit sortable list, identical mechanics to `MissionObjectivesSection.tsx:190-215` (optimistic
  local order, resync only when the *set* of ids changes, revert on error) and
  `useMyMissionsDnd.ts`.
- Running rows are rendered with `disabled` sortable items — **R3**'s "not already running".
- Rows group visually by mission when adjacent, but the list is one flat ordered lane; grouping must
  never reorder.
- Held rows carry their reason inline with a retry affordance.
- Header controls: pause toggle and a concurrency stepper (`max_concurrent`).

### 7.3 Mission panel

The mission objective list already renders in `position` order, and §5.4 makes `position` agree with
the queue, so **no change is required** beyond the button swap and a queue-position chip
(`#4`) on queued cards. That is the payoff of write-through ordering.

---

## 8. Migration and retirement of auto-advance

**Migration step (data).** For every objective with `auto_advance = true` and
`state IN ('future','draft','submitted')`, insert a `launch_queue_entries` row. Lane owner = the
mission's `assigned_workspace_user_id`'s profile (falling back to the objective's
`created_by_workspace_user_id`). Order within a lane = mission board order, then
`objectives.position` — i.e. the order those objectives would actually have run in.

**Migration step (code).** Delete the inline auto-advance block in `protocolDeliver`
(`protocol.ts:2210-2340`, ~130 lines including launch-config resolution) and replace it with:
"if the mission's next objective is not queued, emit `awaiting_approval`; enqueue a dispatch job".
`decideAutoAdvanceAfterDelivery` is superseded by `planLaunchQueueDispatch`; keep the old function
and its tests until the column is dropped.

**Retirement schedule.**

| Release | State |
|---|---|
| N (contract 96) | Queue is authoritative. `objectives.auto_advance` is written on enqueue/dequeue for read-compat, but never read by dispatch. Wire field `autoAdvance` derived from queue membership. CLI/MCP flags map to enqueue/dequeue. |
| N+1 | `objectives.auto_advance` stops being written; `ObjectiveDto.autoAdvance` documented as deprecated in the contract. |
| N+2 (contract bump) | Column dropped; `--auto-advance` flags become aliases of `queue-objective` with a deprecation note in `ovld protocol help`. |

Nothing in the agent-facing surface breaks at any step (**R11**).

---

## 9. Contract impact

Requires a contract-version bump (next available; 95 at time of writing → **96**) and these edits to
`CONTRACT.md`:

1. **Version 96 Change Summary** entry describing the launch queue, the new REST family, the
   protocol commands, and the `autoAdvance` → queue-membership mapping.
2. **Protocol Layer** (`CONTRACT.md:173`) — add `queue-objective`, `dequeue-objective`, `queue`;
   restate `--auto-advance` as an alias.
3. **REST API Layer** (`:307`) — add the `/api/launch-queue*` family and its authorization rule.
4. **Automations Layer** (`:390`) — declare `planLaunchQueueDispatch` as a pure planner alongside the
   existing objective-manager rules.
5. **Runner → REST (Queue Surface)** (`:618`) — one clarifying sentence: `execution_requests`
   semantics are unchanged; `requested_source = 'launch_queue'` is a new open value; the runner has
   no awareness of the run queue.
6. **Controlled Vocabularies** (`:851`) — no closed vocabulary changes. `launch_queue_entries.state`
   is a new closed vocabulary of this feature and should be listed as such;
   `execution_requests.requested_source` gains an open value.
7. **Machine-readable files** — `contract/protocol-commands.yaml` (new commands),
   `contract/components.yaml` (capability on the REST and Automations components).

Database schema contract docs to update: `database/docs/09-database-schema-contract.md` (table
definition and vocabulary) and `database/docs/10-database-table-groups.md` (group placement — it
belongs with the execution group).

**No conformance-breaking change for external consumers.** Runner Layer, Virtual Target Gateway,
and every connector see an unchanged `execution_requests` contract. That is the main argument for
Option C over Option A.

---

## 10. Implementation phases

**Phase 1 — Queue engine, behavior-identical.** Migration (both dialects) + backfill;
`packages/core/service/launch-queue.ts`; `planLaunchQueueDispatch` in
`automations/src/objective-manager/`; dispatch worker + poller registration; trigger-point wiring;
`protocolDeliver` simplification; write-through ordering; REST endpoints; `ObjectiveDto.queueEntry`.
Acceptance: an existing auto-advance chain behaves exactly as before, and a queue spanning two
missions in two projects drains one at a time.

**Phase 2 — UI.** Queue popover replacing the auto-advance popover; `/queue` route + sidebar sheet
with dnd reorder, pause, concurrency; mission-panel position chips; the `AgentLaunchButton` sibling
branch; drag-into-queue in the mission panel.

**Phase 3 — Agent surfaces + retirement.** `ovld protocol queue-objective` / `dequeue-objective` /
`queue`; MCP `overlord_queue_objective`; `--auto-advance` alias mapping; docs
(`cli/docs/01-command-reference.md`, `cli/docs/04-runner-and-launch-execution.md`,
`webapp/docs/ui/03-mission-detail.md`, `webapp/docs/ui/04-execution-and-runner.md`); begin the
column retirement schedule.

**Phase 4 (optional) — Lanes.** Populate `lane_key` from execution target or project resource so an
operator with two machines drains two streams. No schema change needed; only the lane resolver and a
lane picker in the queue header.

---

## 11. Test plan

- **Pure planner** (`automations`, no DB): ordering, capacity, pause, hold-vs-drop, blocked
  reasons, inheritance of agent/model. Mirrors the existing `rules.test.ts` style.
- **Idempotency**: two concurrent dispatch jobs for one lane produce exactly one
  `execution_requests` row; assert on the `launch_queue:<entryId>` key.
- **Cross-workspace**: deliver in workspace A, dispatch lands in workspace B with B's
  `workspace_user` as `requested_by_workspace_user_id`; a member who lost access to B has their
  entry held, not dispatched.
- **Ordering write-through**: enqueue / reorder / remove each leave `objectives.position` matching
  the sort contract; `protocolDeliver`'s next-objective query and the activity feed's upcoming chain
  agree with the queue view.
- **Skip the queue**: manual Run on a queued objective marks the entry `running` and does not
  double-launch; on delivery the lane advances normally.
- **Failure paths**: request `failed` / `expired` / `cleared` return the entry to `waiting` with its
  position intact; the third failure holds it.
- **Compatibility**: `ovld protocol add-objectives --auto-advance` produces the same run order as
  today; `PATCH /api/objectives/:id { autoAdvance: false }` removes the entry.
- **Migration**: backfill of a mission with three auto-advance objectives yields three entries in
  position order.

---

## 12. Open questions

- **Q1 — Do manual runs consume lane capacity?** Recommended **yes**: capacity models a real
  constraint (your machine, your budget), so a skipped-ahead run should pause the drain rather than
  stack a second agent on top of it. The cost is that clicking Run in an unrelated mission stalls
  the queue until it delivers, which may surprise. Mitigation: the queue header states
  "Running 1 of 1 — includes 1 manual run".
- **Q2 — Hold-and-skip or strict head-of-line?** Recommended **hold-and-skip with a visible reason**,
  because one disconnected repository should not freeze unrelated missions. Strict ordering is a
  one-line change if the recommendation proves wrong.
- **Q3 — Should dragging a queued objective below its unqueued siblings dequeue it?** It is the
  symmetric inverse of drag-to-enqueue, but implicit removal of a plan is riskier than implicit
  addition. Safer first cut: allow drag-to-enqueue, require the popover for removal.
- **Q4 — Lane ownership for team workspaces.** A per-operator lane is right for a single user with
  one machine. Two people queuing work in one workspace get two independent lanes that both dispatch
  concurrently, which may over-subscribe a shared runner. If that matters, `lane_key` should resolve
  from the execution target rather than the operator (Phase 4) — the schema supports either without
  migration.
- **Q5 — Should a queued objective auto-promote `future → draft` at enqueue time instead of
  dispatch time?** Dispatch-time promotion (recommended) keeps the mission panel's future group
  meaningful; enqueue-time promotion would make queue membership visible through the existing state
  machine but flattens the future/draft distinction.
