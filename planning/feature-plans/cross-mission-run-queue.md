# Cross-Mission Run Queue (and renaming the launch queue to the Delegator)

**Mission:** coo:786 · **Objective:** coo:786.e2s9 · **Status:** design investigation
**Date:** 2026-08-19
**Author:** agent (claude-opus-5)
**Supersedes:** an earlier draft that scoped the queue to a per-operator lane spanning workspaces.
That model is replaced by per-project scoping (§3.1); its file has been removed so there is one
design of record.

---

## 1. Recommendation in one paragraph

Many agents working different objectives at once is the normal posture; the Run Queue exists only for
the objectives that **must** happen in order. A project holds one or more Run Queues — one default
queue, and as many additional independent sequences as the work needs — and each queue's only job is
to enforce its own sequence: the next entry is dispatched when the previous one delivers. A queue is
not a throttle. It never limits how much a project runs, it never picks a machine, and clicking
**Run** bypasses it entirely. What it feeds is the **Delegator**, the mechanism today called the
"launch queue": the `execution_requests` table plus the runner claim loop, whose real job is
delegating runs to execution targets regardless of whether a run came from a Run Queue or straight
from a user. Build it as two new tables — `run_queues` and `run_queue_entries` — plus a dispatcher
that converts each queue's head into an ordinary `execution_requests` row at exactly the moment
auto-advance would have created one today. Auto-advance stops being a per-objective boolean and
becomes "this objective has a queue entry". Mission objective `position` stays the canonical
intra-mission order but becomes **derived from** the queue by write-through renumbering, so the two
orderings can never disagree.

```
   ┌─────────────────────────── one project ────────────────────────────┐
   │  RUN QUEUES          each enforces its own sequence                │
   │  ┌──────────────────────────┐  ┌──────────────────────────┐        │
   │  │ Run Queue (default)      │  │ Docs                     │        │
   │  │  1. coo:701.a1b2 ←running│  │  1. coo:733.j9k0 ←running│        │
   │  │  2. coo:786.e2s9         │  │  2. coo:733.l1m2         │        │
   │  │  3. coo:712.f5g6         │  └──────────────────────────┘        │
   │  └──────────────────────────┘   independent heads, in parallel     │
   └──────────────┬──────────────────────────┬──────────────────────────┘
                  │ dispatch on delivery     │ dispatch on delivery
 user clicks Run ─┤ (skips the queue)        │
                  ▼                          ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │  DELEGATOR   (existing `execution_requests` + runner claim)         │
   │  routes each run to an execution target as soon as one is free      │
   └────────┬───────────────────┬───────────────────┬───────────────────┘
            ▼                   ▼                   ▼
      local target A      local target B       virtual target
```

| | **Delegator** (existing, `execution_requests`) | **Run Queue** (new, `run_queue_entries`) |
|---|---|---|
| Job | Route a run to an execution target | Enforce the order runs happen in |
| Scope | Workspace, claimed per target | One or more per project |
| Drain rule | Claimed as soon as a target is free | Head dispatched when the previous entry **delivers** |
| Sources | Run Queue dispatch **and** direct user runs | The user's plan |
| Concurrency | Unbounded — as many targets as are free | One entry in flight **per queue**; that *is* the sequence |
| Lifetime | Seconds–minutes | Minutes–days |
| Ordering | `created_at` (FIFO, not user-visible) | User-mutable `position` |
| Mutability | Clear-all only | Insert / remove / reorder |

---

## 2. What exists today

### 2.1 Auto-advance

Auto-advance is a per-objective boolean (`objectives.auto_advance`,
`database/postgres/migrations/002_initial_core.sql:438`) read in exactly one hot path:
`protocolDeliver` in `packages/core/service/protocol.ts:2173-2340`.

On delivery, that code:

1. Reads the just-delivered objective's `assigned_agent` / `model` / `reasoning_effort`
   (`protocol.ts:2173`) so the next objective can inherit them.
2. Calls `ensureNextDraftObjective` (`packages/core/service/missions.ts:491`), which promotes the
   first authored `future` objective to `draft` when no authored draft exists.
3. Selects **the next objective by `position`** that is `state = 'draft'` **and** has non-blank
   `instruction_text` (`protocol.ts:2189-2196`). Blank drafts and `future` objectives are invisible to
   this query.
4. Checks `findConflictingActiveSibling` (`packages/core/service/objective-parallelism.ts:48`) — any
   active sibling objective, or any sibling holding an active execution request, aborts the advance
   unless `missions.allow_parallel_objectives` is set.
5. If `auto_advance = 1`: flips the objective to `launching`, persists any inherited agent selection,
   resolves the execution target and launch config (`resolveLaunchExecutionTarget` /
   `resolveLaunchConfig`), and calls `createExecutionRequest` with `requestedSource: 'auto_advance'`
   and `idempotencyKey: 'auto_advance:<objectiveId>'`.
6. If not: writes an `awaiting_approval` mission event instead.
7. Failure to queue is swallowed into an `alert` mission event (`protocol.ts:2325`) — the chain
   silently stops.

A pure planner mirror lives in the Automations Layer: `decideAutoAdvanceAfterDelivery`
(`automations/src/objective-manager/rules.ts:383`), returning `queue_launch | await_approval | none`
and already owning the idempotency-key convention. **That is the natural home for the new dispatch
planner.**

Structural limits, all of which this design removes:

- **Mission-local.** The next objective is found with `WHERE mission_id = ? AND position > ?`. There
  is no concept of "what runs after this mission finishes".
- **Adjacency-only.** Only the immediately-next draft can advance; an auto-advance objective two slots
  down never fires unless everything above it is also auto-advance.
- **Invisible.** The only representation of the plan is a boolean per card, plus a derived read in the
  activity feed (`backend/activity-feed.ts:233-360`) that walks forward from a running objective and
  stops at the first `auto_advance !== 1`.
- **No reordering, no pause, no cross-mission view.**

What auto-advance gets *right*, and this design must not lose: its chains are **per mission** and
independent, so three chained missions run three agents concurrently. See §5.7.

### 2.2 The Delegator (today's "launch queue", `execution_requests`)

`execution_requests` (`002_initial_core.sql:674`) is a per-workspace work list with status
`queued → claimed → launching → launched|failed` and terminal `cleared|cancelled|expired` (closed
vocabulary, `CONTRACT.md:857`).

- Created by `createExecutionRequest` (`packages/core/service/execution-requests.ts:358`), which
  **freezes** the resolved working directory, resource, execution target, agent/model, and launch
  flags at creation time.
- Claimed by `claimNextExecutionRequest` (`execution-requests.ts:568`), `ORDER BY created_at ASC LIMIT
  1`, atomic revision CAS, gated on `o.state IN ('draft','submitted','launching')` and on the
  request's `execution_target_id` matching the claiming runner's target. On Postgres the claim
  long-polls on `LISTEN` (`CONTRACT.md:618`).
- **Claim competition is target-level**: any healthy runner registered to the selected execution target
  may claim its work (`CONTRACT.md:618`). Virtual targets claim the same rows through the Virtual
  Target Queue Surface (`CONTRACT.md:635`).
- **It drains immediately** — there is no wait-for-delivery semantic anywhere in it, and per the
  objective statement that stays true.
- Cleared wholesale by `clearExecutionRequests` (`execution-requests.ts:966`) — the "Clear" button in
  `webapp/web/components/runner/RunnerStatusModal.tsx:270`.
- Removed per objective by `dequeueObjective` (`backend/execution/launch.ts:980`) when a user
  completes, disconnects, or deletes an objective.

Read plainly, this is a **delegator**, not a queue in the planning sense: it takes runs from any source
and hands each one to an execution target. It happens to hold them in a line while targets are busy,
which is what made "launch queue" a confusing name once real user-facing queues exist. §8 covers the
rename.

### 2.3 Objective ordering

- `objectives.position` is `integer NOT NULL`, unique per mission among non-deleted rows
  (`002_initial_core.sql:453`).
- `reorderFutureObjectives` (`backend/repository.ts:6662`) renumbers only the `future` group, starting
  at the lowest position that group already holds, using a temp-position pass first so swaps never
  trip the unique index. It rejects any non-`future` objective.
- The mission panel renders three groups — executed / editable (`draft|submitted|launching`) / future
  — and only the future group is drag-sortable
  (`webapp/web/components/objectives/MissionObjectivesSection.tsx:125-215`).
- `position` is load-bearing beyond display: `protocolDeliver`'s next-objective query, the activity
  feed's upcoming chain, `ensureNextDraftObjective`, and `createExecutionRequest`'s "first launchable
  objective" fallback (`execution-requests.ts:404`) all order by it.

### 2.4 Reorder mechanics worth copying

`my_mission_positions` (`002_initial_core.sql:403`) + `reorderWorkspaceMyMissionsTx`
(`backend/repository.ts:6418`) establish the house pattern for a user-mutable ordinal:
`double precision position`, a full-order `PATCH` that rewrites positions as `(index + 1) * STEP`, and
midpoint inserts between neighbours. `reorderFutureObjectives` establishes the temp-position two-pass
technique for renumbering under a unique index. The Run Queue uses both.

### 2.5 Durable background work

`worker_jobs` + `WorkerJobPoller` (`packages/core/service/worker-jobs.ts`,
`backend/worker-job-poller.ts`) give a leased, retrying, dedupe-capable in-process job queue;
`workerJobJsonFieldPredicate` coalesces identical active jobs on one payload field. This hosts the
dispatcher.

### 2.6 UI surfaces that touch auto-advance

| Surface | File | Role |
|---|---|---|
| Auto-advance popover (fast-forward / pause icon + switch) | `webapp/web/components/objectives/DraftObjectiveActions.tsx:92-129` | Becomes the **Queue** button |
| "Enable auto-advance instead of launching" confirm path | `webapp/web/components/objectives/AgentLaunchButton.tsx:130-140` | Becomes "add to the Run Queue instead" |
| Auto-advance badge on collapsed objectives | `webapp/web/components/objectives/ObjectiveCollapsibleItem.tsx:200-220` | Becomes a queue-position chip |
| Runner modal queue list | `webapp/web/components/runner/RunnerStatusModal.tsx:250-345` | Raw `execution_requests`; becomes the **Delegator** panel |
| Activity feed "upcoming" chain | `backend/activity-feed.ts:345` | Reads the Run Queue instead of the auto-advance chain |

### 2.7 Agent-facing surfaces

`--auto-advance` / `--no-auto-advance` and per-item `autoAdvance` on `create`, `prompt`,
`add-objectives`, `update-objective` (`cli/src/flag-registry.ts:86`, `cli/src/commands.ts:1472`,
`backend/protocol.ts:562-600, 984-995`), hosted MCP `overlord_create_mission`,
`overlord_add_objectives`, `overlord_update_objective` (`mcp/tool-catalog.ts:157, 223, 238`), and REST
`PATCH /api/objectives/:id { autoAdvance }`. Contract versions 75 and 88 pin these. All keep working
(§6.2, §9).

---

## 3. Requirements

- **R1** — Run Queues are **project-scoped** and span that project's missions. Adding an objective to
  one replaces auto-advance.
- **R2** — A queue enforces **sequence only**. It never selects or constrains an execution target (each
  entry resolves its own exactly as a manual run does), and it never limits how many agents a project
  may run. Parallelism is the default posture; queues are the sequential subset.
- **R3** — The per-objective control becomes a **Queue** button whose popover names *the objective that
  will precede this one* and offers **Remove from queue**.
- **R4** — A separate whole-queue interface listing every entry, with drag reorder for entries that are
  **not already running**.
- **R5** — Drain semantics match auto-advance: dispatch the next entry only **after the previous one
  delivers**. Dispatch means "hand it to the Delegator", which still launches as soon as a target is
  free.
- **R6** — Objective order within a mission is subordinate to the queue: two queued objectives on one
  mission appear in queue order; unqueued objectives sort below queued ones.
- **R7** — Clicking **Run** skips the queue and goes straight to the Delegator. It is not counted
  against any queue and never delays one.
- **R8** — Delegator behavior is unchanged; it keeps accepting runs from both sources identically.
- **R9** — Exactly-once launch per entry, surviving retries, concurrent deliveries, and restarts.
- **R10** — An entry degrades safely when its objective is edited, deleted, completed by hand, moved
  between missions, or has its resource disconnected while it waits.
- **R11** — Existing agent-facing `autoAdvance` semantics keep working.
- **R12** — A project supports **multiple independent queues**. The data model and dispatcher ship with
  that capability; the frontend for managing several queues comes later.

### 3.1 Decisions settled by the objective owner

Rulings, not open questions. Recorded so implementation does not re-litigate them.

| Decision | Consequence in this design |
|---|---|
| **Run Queues are project-scoped.** *(Amended: one queue per project was the original ruling; see the multi-queue row. One queue is now the default, not the limit.)* | No lane table, no owner column, no cross-workspace membership aggregation. A project belongs to one workspace (`002_initial_core.sql:152`), so queues are single-workspace by construction and ordinary project RBAC covers them. |
| **Entries may execute on any selected execution target; a queue enforces execution sequence only.** | `run_queue_entries` carries **no target column**. Target resolution stays where it already is and happens at dispatch, so consecutive entries can run on different machines, including virtual targets. This is also the decisive argument against storing queue intent in `execution_requests`, whose rows are target-bound and context-frozen at creation (§4, Option A). |
| **Parallelism is the goal; queues are only for objectives that must be sequential. Clicking Run goes straight to the Delegator.** | No `maxConcurrent`, no capacity accounting anywhere. A queue holds one entry in flight because that is what a sequence means, not to limit the project. Direct runs are invisible to queues (§5.2, §5.5). |
| **A project needs several queues. Ship the groundwork now; the multi-queue frontend is a later step.** | `run_queues` is a real table from Phase 1, `run_queue_entries.queue_id` is `NOT NULL`, and the dispatcher runs the head of **each** queue concurrently (§5.7). Every project gets one default queue, and until the management UI lands every enqueue targets it. The §9 backfill uses the capability immediately, to preserve today's per-mission concurrency instead of merging chains. |
| **Blocked entries hold and skip; they do not freeze the queue.** | A held entry keeps its position and records a visible reason; the planner continues to the next entry (§5.3). Accepted cost: execution can depart from displayed order while an entry is held. |
| **Dragging across the queue boundary confirms, in both directions.** | No implicit enqueue and no implicit dequeue — a modal in each direction (§5.4, §7.1). Reordering *within* the queued block still needs no confirmation. |
| **`future → draft` is promoted at dispatch time.** | Only the objective actually being dispatched is promoted, so the mission panel's future group stays meaningful (§5.3). |
| **The existing launch queue is the Delegator**: it delegates runs to execution targets regardless of source. | The Delegator is not modified — it gains one new `requested_source` value and nothing else. The rename runs through prose, UI, and contract titles (§8); both dispatch paths converge on `createExecutionRequest` exactly as today. |

---

## 4. Options considered

### Option A — Extend `execution_requests` (the Delegator) with a "waiting" status

**Rejected:**

1. The Delegator's rows are **target-bound and context-frozen**: working directory, resolved resource,
   execution target, launch flags, agent/model are all resolved at creation
   (`execution-requests.ts:430-470`). A queue entry may wait hours or days, and per **R2** its target
   must not be decided until it actually runs. Freezing a target at enqueue time is exactly the wrong
   semantic.
2. `execution_requests.status` is a **closed contract vocabulary** (`CONTRACT.md:857`) consumed by the
   Runner Layer *and* the Virtual Target Gateway (`CONTRACT.md:635`). A new value drags two external
   conformance surfaces into an internal planning concept.
3. Claim order is `created_at ASC`. User reordering would require a position column on a table whose
   contract is FIFO-by-arrival, and every runner and gateway would have to be trusted to honor it.
4. `clearRunnerQueue` and `dequeueObjective` mean "abandon in-flight work". They would silently start
   meaning "erase the user's plan for the next three days".
5. Delegator rows are per-attempt; a retry writes a new row. A queue entry must survive a failed
   attempt without losing its slot.
6. There is nowhere to express "this project has three independent sequences" (**R12**).

### Option B — Derive queues from `auto_advance` plus an ordering column on `objectives`

**Rejected.** No per-entry state (`waiting` vs `blocked` vs `running`), no blocked reason, no record of
who queued it, no survival across an objective being deleted and recreated, a project-wide ordinal
living on a mission-scoped row, and no way to name or pause an individual sequence.

### Option C — `run_queues` + `run_queue_entries` + dispatcher (recommended)

Planning intent and delegation mechanism stay separate; queues *feed* the Delegator exactly as the
objective statement asks.

---

## 5. Recommended design

### 5.1 Data model

```sql
-- Postgres; the SQLite mirror uses text timestamps and REAL position, per the
-- database/{postgres,sqlite}/migrations convention.

-- A project has one default queue and may have more. Queues within a project are
-- independent sequences that advance in parallel (§5.7).
CREATE TABLE run_queues (
  id text PRIMARY KEY,
  project_id   text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) > 0),
  -- Display order of queues within the project.
  position double precision NOT NULL,
  paused boolean NOT NULL DEFAULT false,
  -- Exactly one per project; the target of "add to queue" until the picker ships.
  is_default boolean NOT NULL DEFAULT false,
  created_by_workspace_user_id text REFERENCES workspace_users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  UNIQUE (project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_run_queues_project_default
  ON run_queues (project_id) WHERE is_default AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_run_queues_project_name
  ON run_queues (project_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX idx_run_queues_project_position
  ON run_queues (project_id, position) WHERE deleted_at IS NULL;

CREATE TABLE run_queue_entries (
  id text PRIMARY KEY,

  -- Which sequence this entry belongs to. No lane column and no owner column:
  -- a queue belongs to a project, not to a person.
  queue_id     text NOT NULL REFERENCES run_queues (id) ON DELETE CASCADE,
  project_id   text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  mission_id   text NOT NULL REFERENCES missions (id) ON DELETE CASCADE,
  objective_id text NOT NULL REFERENCES objectives (id) ON DELETE CASCADE,

  -- User-mutable ordinal within its queue. Midpoint inserts; full renumber on reorder.
  position double precision NOT NULL,

  state text NOT NULL CHECK (state IN ('waiting', 'blocked', 'dispatched', 'running')),
  blocked_reason text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),

  -- Who queued it; dispatch re-authorizes as this member.
  enqueued_by_workspace_user_id text REFERENCES workspace_users (id) ON DELETE SET NULL,
  enqueued_at    timestamptz NOT NULL,
  dispatched_at  timestamptz,
  execution_request_id text REFERENCES execution_requests (id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),

  FOREIGN KEY (project_id, queue_id)       REFERENCES run_queues (project_id, id)  ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, project_id)   REFERENCES projects   (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, mission_id)   REFERENCES missions   (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, objective_id) REFERENCES objectives (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, mission_id)     REFERENCES missions   (project_id, id)   ON DELETE CASCADE
);

-- One live entry per objective, across every queue in the project.
CREATE UNIQUE INDEX idx_run_queue_entries_objective
  ON run_queue_entries (objective_id) WHERE deleted_at IS NULL;
-- The dispatcher's per-queue head lookup.
CREATE INDEX idx_run_queue_entries_queue_position
  ON run_queue_entries (queue_id, position) WHERE deleted_at IS NULL;
-- The project-wide read that renders every queue in one view.
CREATE INDEX idx_run_queue_entries_project_position
  ON run_queue_entries (project_id, position) WHERE deleted_at IS NULL;
-- The mission panel's write-through renumber.
CREATE INDEX idx_run_queue_entries_mission_position
  ON run_queue_entries (mission_id, position) WHERE deleted_at IS NULL;
```

`paused` lives on `run_queues`, not on the project: pausing is per queue, so one sequence can be held
while the others keep advancing. An earlier draft put it in `projects.settings_json` behind a
`readProjectRunQueueSettings` accessor; with a real queue row that indirection buys nothing and
`ProjectDto` needs no new field.

There is deliberately **no concurrency setting** on either table (§5.2).

**Every project gets a default queue**, created lazily on first enqueue (and by the §9 backfill), named
"Run Queue", `is_default = true`. The partial unique index guarantees at most one per project. Until
the multi-queue frontend ships, every enqueue targets it — so the system behaves exactly like a
single-queue design while the groundwork is already in place.

Notes on the other choices:

- **No lane, owner, or organization column.** Queues belong to projects. Everything the first draft
  needed cross-workspace machinery for — membership aggregation, a profile-scoped ordinal, a lane
  settings table — disappears.
- **`double precision position`** so an insert between two neighbours is a midpoint write, not a
  renumber. Reorder still rewrites the full order with `(index + 1) * STEP`.
- **No `done` archive.** History lives in `execution_requests`, `mission_events`, and `deliveries`.
  Entries are soft-deleted when they leave a queue.
- **`blocked` state** so the UI can say "held: the repository for this objective is not connected"
  instead of stalling silently, which is what happens today.
- **No target column**, per **R2**. Target selection stays in the objective's own `launch_config_json`
  / resource key, the project's execution target preference, and the user's defaults, all resolved at
  dispatch by `resolveLaunchExecutionTarget` + `resolveLaunchConfig`.

### 5.2 Queue semantics — a sequencer, not a throttle

**Parallelism is the normal posture.** Many agents working different objectives at once is the point of
the product; queues exist only for the subset of objectives that *must* happen in order. Everything
follows from that:

- **Sequence, not placement.** A queue answers "what runs next", never "where". Consecutive entries may
  resolve to different execution targets, including virtual ones; the Delegator routes each.
- **Sequence, not capacity.** Each queue holds exactly one entry in flight at a time. That is the
  *definition of a sequence*, not a limit on the project — it is how "the next one starts when the
  previous one delivers" is expressed. It says nothing about how many agents may run in the project.
- **Queues within a project are independent.** Each advances on its own head (§5.7). Three queues means
  up to three agents in flight from the Run Queue system, plus however many direct runs the user starts
  alongside them.
- **No `maxConcurrent`.** An earlier draft carried one, inherited from a model where the queue was a
  capacity throttle for a single operator's machine. Under this model it has no job: it would either
  mean "run N unrelated chains at once", which separate queues now express properly, or "throttle the
  project", which is not a queue's concern. It is removed rather than defaulted.
- **Direct runs are invisible to queues.** Clicking **Run** goes straight to the Delegator. It is not
  counted, not gated, and does not delay any head by one second. The *only* way a direct run can affect
  a queue is the pre-existing mission-level sibling lock: if a direct run and a queue head are
  objectives of the same mission, that head holds with `mission_busy` until the mission is free —
  today's `findConflictingActiveSibling` behavior, not a queue rule, and mission-scoped rather than
  project-scoped.
- **`paused`** stops one queue's dispatch without dequeuing anything and without touching the project's
  other queues — the one useful knob, and nearly free.
- **Projects are independent.** Every project's queues advance on their own; the Delegator arbitrates
  for targets, which is precisely its job.

Independent sequences are what make this a replacement for auto-advance rather than a trade: today's
chains are per mission and run concurrently, and §5.7 preserves that.

### 5.3 The dispatcher

**Where it runs.** A durable worker job, `overlord.run-queue.dispatch.v1`, claimed by a
`WorkerJobPoller` subclass (`backend/run-queue-dispatch-worker.ts`), deduped on a `projectId` payload
field via `workerJobJsonFieldPredicate` — one job covers every queue in the project. It builds its
service context with
`buildWebappServiceContextForWorkspace(entry.workspace_id, tx, entry.enqueued_by_workspace_user_id)`,
the helper `dequeueObjective` already uses (`backend/execution/launch.ts:1006`).

Project scoping means dispatch is single-workspace, so it *could* run inline in `protocolDeliver`. It
should still not:

1. Delivery is user-visible and latency-sensitive; a failed target resolution must not fail or slow a
   delivery. Today it does not fail the delivery — it silently swallows the error into an `alert` event
   (`protocol.ts:2325`), which is the same bug from the other direction.
2. Delivery is only one of six triggers. The other five have no protocol session at all.
3. A worker job gets leases, bounded retries, and the periodic sweep that heals a queue whose trigger
   was lost to a crash between the delivery transaction and the job insert.

**Trigger points** — each enqueues a deduped dispatch job; none dispatches inline:

| Trigger | Call site |
|---|---|
| Objective delivered | `protocolDeliver`, `packages/core/service/protocol.ts` (replaces the inline auto-advance block) |
| Objective completed / disconnected / deleted by a human | `dequeueObjective`, `backend/execution/launch.ts:980` |
| Execution request failed / expired / cleared | `markExecutionFailed`, `expireStaleExecutionRequests`, `clearExecutionRequests` |
| Entry enqueued, removed, moved, or reordered | new run-queue service |
| A queue unpaused, created, or deleted | new run-queue service |
| Safety sweep | periodic poller tick enqueuing a job per project holding any non-empty queue |

**Algorithm** — a pure planner in the Automations Layer, beside `decideAutoAdvanceAfterDelivery`:

```
planRunQueueDispatch(project, entriesByQueue, context) -> Action[]

  actions = []
  for queue in project.queues:
    if queue.paused: continue
    // One in flight per queue: the sequence. Direct runs are NOT counted here.
    if any(entriesByQueue[queue] where state in {dispatched, running}): continue
    actions += planOneQueue(entriesByQueue[queue], context)
  return actions


planOneQueue(entries, context) -> Action[]

  actions = []
  for entry in entries where state in {waiting, blocked} ordered by position asc:
    o = context.objective(entry.objectiveId)

    // R10 — degrade safely
    if o is missing or deleted or o.state == complete:              actions += drop(entry, 'objective_gone');        continue
    if trim(o.instructionText) == '':                                actions += hold(entry, 'no_instruction');        continue
    if o.state in {executing, pending_delivery}:                     actions += markRunning(entry); return actions

    // Mission-level sibling lock — reuse siblingBlocksParallelLaunch verbatim
    if context.missionHasBlockingActiveSibling(o.missionId, o.id):   actions += hold(entry, 'mission_busy');          continue
    if not context.resourceConnected(o):                             actions += hold(entry, 'resource_disconnected'); continue
    if entry.attemptCount >= MAX_DISPATCH_ATTEMPTS:                  actions += hold(entry, 'dispatch_failed');       continue

    actions += dispatch(entry, {
      promoteFutureToDraft: o.state == 'future',
      agent: o.assignedAgent ?? context.inheritedAgentFor(o),  // last delivered objective on the mission
      idempotencyKey: 'run_queue:' + entry.id
    })
    return actions       // exactly one dispatch per queue per pass — the sequence
  return actions
```

**`hold` vs `drop` — settled: hold-and-skip.** `hold` leaves the entry in place with a visible reason
and the planner **continues to the next entry** rather than freezing the queue. Strict head-of-line
blocking is simpler but means one disconnected repository stalls every mission behind it. The accepted
cost is that execution can depart from the displayed order while an entry is held, which the queue view
shows rather than hides.

**Applying an action** — one transaction per entry:

1. If `promoteFutureToDraft`, update `objectives.state` `future → draft`. `future` is not in
   `LAUNCHABLE_OBJECTIVE_STATES` (`execution-requests.ts:34`), so this is mandatory. **Settled:
   promotion happens at dispatch time**, only to the objective actually being dispatched, so the
   mission panel's future group keeps meaning "not scheduled to run next". Today the equivalent happens
   implicitly and more broadly via `ensureNextDraftObjective`.
2. Set `objectives.state = 'launching'`, persisting inherited agent/model/reasoning when the objective
   has none — identical to `protocol.ts:2237-2262`.
3. Resolve `resolveLaunchExecutionTarget` + `resolveLaunchConfig` **now**, at dispatch. This is where
   **R2** is honored: the target is whatever the objective and project resolve to at run time, not
   something a queue decided when the user dragged a card.
4. `createExecutionRequest({ requestedSource: 'run_queue', idempotencyKey: 'run_queue:<entryId>', … })`
   — hand it to the Delegator.
5. Set entry `state='dispatched'`, `dispatched_at`, `execution_request_id`, `attempt_count += 1`.
6. `recordChange` for the entry plus a `status_change` mission event carrying
   `{ runQueue: { queueId, entryId, action: 'dispatched', position } }`.

**Exactly-once (R9).** The idempotency key is keyed on the **entry id**, not the objective id.
`execution_requests` already enforces `UNIQUE (workspace_id, idempotency_key)`
(`002_initial_core.sql:715`) with a read-through in `createExecutionRequest`
(`execution-requests.ts:430-436`), so two concurrent dispatch jobs for one project cannot double-launch.
Entry transitions additionally use the standard revision CAS. A dequeued-and-requeued objective gets a
new entry id and therefore a new key, which is correct.

**`requested_source = 'run_queue'`.** An open value; note the table also carries
`CHECK (requested_source <> 'auto_advance' OR idempotency_key IS NOT NULL)` — mirror that guard for
`'run_queue'` in the migration.

**Entry lifecycle:**

```
                enqueue                dispatch            delegator → target → agent attaches
   (none) ─────────────▶ waiting ─────────────▶ dispatched ─────────────────────────▶ running
                            ▲  │                     │                                   │
              unblock       │  │ hold                │ request failed/expired/cleared    │ delivered
                            └──┴──▶ blocked ─────────┘                                   ▼
                                                                                    (soft-deleted)
   Direct Run on a queued objective: waiting ──────────────────────────────────────▶ running
```

### 5.4 Ordering subordination (R6)

**Sort contract for a mission's objective list:**

1. Executed objectives (`executing`, `pending_delivery`, `complete`) keep their historical relative
   order at the top. Queues never reorder history.
2. Then queued objectives, in queue position order. When a mission's objectives sit in *different*
   queues, they are ordered by (queue display position, entry position) so the mission list is still a
   total order.
3. Then unqueued `draft`/`future` objectives, in their existing relative order.

**Implementation: write-through, not derived-at-read.** Every queue mutation touching a mission
(enqueue, remove, move between queues, reorder) recomputes that mission's non-executed tail and
renumbers `objectives.position`, reusing the two-pass temp-position technique from
`reorderFutureObjectives` (`backend/repository.ts:6717-6730`) so
`idx_objectives_active_mission_position` is never violated mid-transaction.

Write-through rather than a derived read because `position` is consumed by `protocolDeliver`'s
next-objective query, the activity feed's upcoming chain, `ensureNextDraftObjective`, and
`createExecutionRequest`'s launchable fallback (§2.3). With write-through those four readers are
automatically correct and need no changes; a webapp-only sort would leave them disagreeing with the
visible order.

**The inverse direction — dragging inside a mission (settled: confirm across the boundary):**

- Two **queued** objectives dragged past each other → a queue reorder swapping exactly those two
  entries' `position` values, leaving every other entry untouched. **No confirmation**: it only changes
  order, which is the gesture's obvious meaning. (If the two sit in different queues, the drag is a
  move — see the confirm case below.)
- An **unqueued** objective dragged into the queued block → **confirmation modal**: "Add *Add retry
  backoff* to Run Queue, after *Wire up the webhook*?" Then enqueued at that slot.
- A **queued** objective dragged below the queued block → **confirmation modal**: "Remove *Add retry
  backoff* from Run Queue? It will no longer run automatically." Then dequeued.
- Crossing the queue boundary changes the plan in either direction, so both directions confirm.
  Cancelling reverts the optimistic local order — the same path an API error already takes.
- `PATCH /api/missions/:id/objectives/reorder` stays, but routes queued members through the run-queue
  service instead of renumbering them directly.

### 5.5 Skip the queue (R7)

`launchObjective` (`backend/execution/launch.ts:1085`) keeps its behavior — it writes an
`execution_requests` row immediately, i.e. it goes straight to the Delegator. Two additions inside its
existing transaction:

1. If the objective has a live queue entry, mark that entry `running` and stamp its
   `execution_request_id`. No duplicate dispatch, no lost position. When it delivers, its queue advances
   from it normally — running an entry early is a legitimate way to move a queue along.
2. If it has no entry, none is created. A direct run is not a queue member, is **not** counted against
   any queue, and does not delay any head. Run is the parallel path; queues are the sequential one.

The only interaction between the two is the pre-existing mission-level sibling lock: a direct run and a
queue head belonging to the *same mission* still collide, and that head holds with `mission_busy` until
the mission is free. That is `findConflictingActiveSibling`
(`packages/core/service/objective-parallelism.ts:48`) doing exactly what it does today — mission-scoped,
so a direct run in mission A never blocks a queue head in mission B.

The `AgentLaunchButton` "a sibling is already running — enable auto-advance instead?" branch
(`AgentLaunchButton.tsx:130`) becomes "…add it to the Run Queue instead?".

### 5.6 Lifecycle edge cases (R10)

| Event | Handling |
|---|---|
| Objective deleted | FK cascade; the soft-delete path drops the entry in `dequeueObjective` |
| Objective manually completed | `dequeueObjective` drops the entry, then enqueues a dispatch job |
| Instruction text emptied | Held with `no_instruction`; greyed in the queue view |
| Objective moved to another mission | Entry's `mission_id` updated in the same transaction; queue and position preserved |
| **Mission moved to another project** | The entry moves with it: `project_id`/`workspace_id` rewritten and the entry appended to the destination project's **default** queue. Cross-project position and queue identity are meaningless, so neither can be preserved — surface a toast saying where it landed |
| Mission cancelled / blocked status | That mission's entries dropped, one `status_change` event summarizing the count |
| Resource disconnected | Held with `resource_disconnected`, retried each tick — today this is the failure that produces a silent `alert` and a stalled chain |
| Execution request fails / expires | Entry returns to `waiting` keeping its position, so the retry is ordered rather than lost; after `MAX_DISPATCH_ATTEMPTS` (3) it holds with `dispatch_failed` |
| Agent never attaches | The existing launch-TTL expiry (`CONTRACT.md:618`) fires, which is a trigger |
| Two users queue the same objective | Unique index on `objective_id` spans every queue in the project; the second enqueue returns the existing entry rather than erroring |
| Queue deleted with entries in it | Rejected unless the caller passes `moveEntriesTo`; the default queue cannot be deleted |
| Project archived | Dispatch skipped; queues and entries retained so unarchiving restores the plan |
| Backend restart mid-dispatch | Worker lease expiry re-claims; the idempotency key prevents a double launch |

### 5.7 Multiple queues within a project (R12)

A project may hold several queues. Each is an independent sequence with its own head, its own `paused`
flag, and its own order, and they advance in parallel. This is what keeps the Run Queue a strict
improvement on auto-advance rather than a trade: today's chains are per *mission* and run concurrently,
so three chained missions run three agents at once. A single serial queue per project would have
collapsed that to one.

**Phase 1 ships the groundwork, not the management UI.** The `run_queues` table, `queue_id` on every
entry, and a dispatcher that runs the head of each queue are all in the first release, because the
schema and the backfill both depend on them. The service layer supports create, rename, pause,
delete-with-move, and move-entry-between-queues from day one; the REST endpoints ship with it. Creating,
renaming, merging, and dragging work between queues *in the interface* is a later step. In between, the
system behaves like a single-queue design: every project has one default queue, "add to queue" targets
it, and the queue view renders whatever queues exist without offering to make more.

The one thing the v1 UI must **not** do is hide a queue. The backfill can create several (§9), and a
plan the user cannot see is worse than one they cannot reorganize — so the whole-queue view renders one
section per queue from day one (§7.2), even though only reordering within a section is interactive.

Why a `run_queues` table rather than the nullable `chain_key` column an earlier draft reserved: a bare
string has nowhere to put per-queue `paused`, no display name for the later UI, no stable identity
across a rename, and no way to express an empty queue. The table costs one migration now instead of
two, and every one of those needs is already on the roadmap.

---

## 6. API surface

### 6.1 REST

```
GET    /api/projects/:id/run-queues              -> ProjectRunQueuesDto   (every queue, with entries)
POST   /api/projects/:id/run-queues/entries      { objectiveId, queueId?, afterEntryId? | position? } -> RunQueueEntryDto
DELETE /api/run-queues/entries/:entryId          -> { removed: true }
PATCH  /api/run-queues/entries/:entryId          { queueId?, afterEntryId? | position? } -> RunQueueEntryDto
PATCH  /api/run-queues/:queueId/order            { orderedEntryIds: string[] } -> RunQueueDto
PATCH  /api/run-queues/:queueId                  { name?, paused? } -> RunQueueDto
POST   /api/projects/:id/run-queues              { name } -> RunQueueDto
DELETE /api/run-queues/:queueId                  { moveEntriesTo?: string } -> { removed: true }
```

All eight ship in Phase 1; the last four get UI only in Phase 4. Authorization is ordinary
project-scoped RBAC — no cross-workspace aggregation: `objective:read` to read,
`execution_request:create` to add, remove, move, or reorder entries, and the existing project settings
permission to create, rename, pause, or delete a queue.

```ts
export interface RunQueueEntryDto {
  id: string;
  queueId: string;
  position: number;
  state: 'waiting' | 'blocked' | 'dispatched' | 'running';
  blockedReason: string | null;
  objectiveId: string;
  objectiveDisplayId: string;    // coo:786.e2s9
  objectiveTitle: string | null;
  missionId: string;
  missionDisplayId: string;
  missionTitle: string;
  assignedAgent: string | null;
  /** Logical project resource the objective runs in; null inherits the primary. */
  resourceKey: string | null;
  enqueuedAt: string;
  executionRequestId: string | null;
}

export interface RunQueueDto {
  id: string;
  projectId: string;
  name: string;
  isDefault: boolean;
  paused: boolean;
  position: number;
  entries: RunQueueEntryDto[];   // position ascending
  /** The entry this queue is currently running, if any. Direct runs never appear here. */
  running: RunQueueEntryDto | null;
}

export interface ProjectRunQueuesDto {
  projectId: string;
  /** Queue display order; the default queue sorts first. Always at least one. */
  queues: RunQueueDto[];
}
```

Additive on `ObjectiveDto` (`packages/contract/src/index.ts:672`) so every objective card renders its
queue state without a second fetch:

```ts
  /** Live Run Queue membership, or null when the objective is not queued. */
  queueEntry?: {
    id: string;
    queueId: string;
    queueName: string;
    position: number;          // 1-based rank within its queue, for display
    state: 'waiting' | 'blocked' | 'dispatched' | 'running';
    blockedReason: string | null;
    /** The entry immediately ahead of this one in the same queue — powers the popover (R3). */
    precededBy: { objectiveDisplayId: string; objectiveTitle: string | null; missionTitle: string } | null;
  } | null;
```

`ObjectiveDto.autoAdvance` stays, now **derived** as `queueEntry !== null`, documented as deprecated.

### 6.2 Protocol / CLI

```bash
ovld protocol queue-objective   --objective-id coo:786.e2s9 [--queue <name|id>] [--after coo:701.a1b2 | --front | --position N]
ovld protocol dequeue-objective --objective-id coo:786.e2s9
ovld protocol run-queue         [--project-id <id>] [--json]
```

Compatibility (**R11**): `--auto-advance` on `create` / `prompt` / `add-objectives` /
`update-objective` continues to mean "queue this objective", inserting it **immediately after the last
queued entry of its own mission** — in that entry's queue — else at the tail of the default queue. That
reproduces today's semantic exactly for the single-mission case, which is the only case that currently
exists. `--no-auto-advance` dequeues.

### 6.3 MCP

`overlord_update_objective` keeps `autoAdvance` with the mapping above. Add
`overlord_queue_objective { objectiveId, queue?, after?, remove? }`; expose the queue read through
existing mission-context tools rather than a new one.

---

## 7. UI design

### 7.1 Per-objective Queue button (R3)

Repurpose `DraftObjectiveActions.tsx:92-129` — same trigger position, three states:

```
 not queued   ──  [ ⏸ ]  amber      popover: "Add to Run Queue"
 queued       ──  [ ⏩ ]  emerald    popover: queue name + position + predecessor + Remove
 running      ──  [ ▶ ]  blue       popover: read-only, "Running now"
```

```
┌──────────────────────────────────────────┐
│ In Run Queue · #4 of 7                   │
│                                          │
│ Runs after                               │
│   coo:701.a1b2 — Wire up the webhook     │
│   Mission: Outbound webhooks             │
│                                          │
│ [ Move to front ]      [ Remove from ⏏ ] │
│                                          │
│ View the whole queue →                   │
└──────────────────────────────────────────┘
```

The heading names the queue, so the popover already reads correctly once several exist; a queue picker
joins it when the management UI ships. When not queued, the popover shows what it *would* run after —
the tail of the default queue — before the user commits, which is the statement's "indicate the
objective in the queue that will precede the one the user is trying to add". When blocked, it leads
with the reason ("Held — the repository for this objective is not connected"), a strict improvement
over today's silent `alert` event.

**Remove** confirms, matching the drag-out confirmation (§5.4) so the same action carries the same
weight whichever way the user reaches it.

### 7.2 Whole-queue view (R4)

Project-scoped, so it belongs in the project shell: a route at `/projects/$projectId/queue` plus a
sheet from the board header (`webapp/web/pages/ProjectBoardShell.tsx`). It is a sibling of the board
and calendar views, not a global page. It renders **one section per queue** from day one, even before
queues can be created in the UI.

```
Run Queues · Overlord
──────────────────────────────────────────────────────────────────────────────────────────
Run Queue                                                    ⏸ Pause   Running: coo:701.a1b2
  ▶  coo:701.a1b2  Wire up the webhook          Outbound webhooks    claude   primary  12m
  ⠿  coo:701.c3d4  Add retry backoff            Outbound webhooks    claude   primary
  ⠿  coo:786.e2s9  Design the queue             Cross-mission queue  codex    primary
  ⠿  coo:712.f5g6  Migrate the fixtures         Test fixtures        claude   mobile  ⚠ repo not connected
──────────────────────────────────────────────────────────────────────────────────────────
Docs                                                         ⏸ Pause   Running: coo:733.j9k0
  ▶  coo:733.j9k0  Rewrite the CLI reference    Docs refresh         claude   primary   4m
  ⠿  coo:733.l1m2  Regenerate the screenshots   Docs refresh         claude   primary
──────────────────────────────────────────────────────────────────────────────────────────
```

- dnd-kit sortable list per section, same mechanics as `MissionObjectivesSection.tsx:190-215` and
  `useMyMissionsDnd.ts`: optimistic local order, resync only when the *set* of ids changes, revert on
  error.
- Running rows render as `disabled` sortable items — **R4**'s "not already running".
- Reordering **within** a section is interactive in Phase 2. Dragging **between** sections is disabled
  until Phase 4, with the affordance visibly absent rather than failing on drop.
- Each section header carries its own pause toggle and names what that queue is running. There is no
  concurrency control — a queue is a sequence, and anything the user wants running alongside it they
  start with **Run**.
- The resource column matters for a multi-repo project: it shows *what* an entry will touch without
  implying the queue chose *where* it runs.
- Rows group visually by mission when adjacent, but each section is one flat order; grouping never
  reorders.

### 7.3 Mission panel

The objective list already renders in `position` order, and §5.4 makes `position` agree with the
queues, so no change is needed beyond the button swap, a `#4` position chip on queued cards, and the
queue name in the chip's tooltip once a project has more than one. That is the payoff of write-through
ordering.

### 7.4 Delegator panel

`RunnerStatusModal` becomes the **Delegator** panel (§8): same content, renamed sections, and one line
of copy explaining the split — "Run Queues decide what runs next. The Delegator decides where it runs."
Its "Queue" heading becomes "In flight", and its Clear button gets copy clarifying that it abandons
in-flight runs and does **not** empty any Run Queue.

---

## 8. Renaming the launch queue to the Delegator

Worth doing precisely because real user-facing queues now exist; two things called "queue" would be a
permanent source of confusion.

**Rename now — user-facing and prose (no contract break):**

| Where | Today | Becomes |
|---|---|---|
| `RunnerStatusModal.tsx:282-294` | "Queued work and the persistent runner that launches it." / "Queue" | "Delegator" / "In flight" |
| `RunnerStatusBox.tsx` tooltip and `lib/runner-status.ts` copy | "runner queue" | "delegator" |
| `CONTRACT.md:618` | "Runner → REST (Queue Surface)" | "Runner → REST (Delegation Surface)" — keep the old title as a parenthetical for one version |
| `cli/docs/04-runner-and-launch-execution.md`, `webapp/docs/ui/04-execution-and-runner.md` | "launch queue" | "Delegator" |
| `mcp/README.md`, `cli/README.md` prose | "queue" | "delegator" where it means `execution_requests` |

**Do not rename — schema and wire identifiers:**

- The `execution_requests` table, its columns, `ExecutionRequestDto`, and `execution_requests.status`. A
  table rename touches the Runner Layer, the Virtual Target Gateway's versioned
  `/api/virtual-targets/v1/*` family, every conformance manifest, and both migration dialects, for zero
  behavioral gain.
- `POST /api/runner/claim` and the rest of the runner endpoints; they are external contract surface.
- `clearRunnerQueue` stays as the API method name until a broader deprecation pass; its **label**
  changes.

**Optionally rename — internal TypeScript:** `hasRunnerQueueError` → `hasDelegatorError`,
`runnerQueueErrorMessage` → `delegatorErrorMessage` (`webapp/web/lib/runner-status.ts`), and the
`queue` field of the runner status DTO → `inFlight`. Cheap, contained to the webapp, worth folding into
Phase 2.

Net: "Delegator" is the name in every place a human reads; `execution_requests` stays the name in every
place a machine parses.

---

## 9. Migration and retirement of auto-advance

**Queues.** Create one default queue per project that has anything to backfill (`name = 'Run Queue'`,
`is_default = true`). Then, because auto-advance chains are per mission and run concurrently,
**preserve that concurrency rather than merging it**:

- The first mission with a chain of two or more auto-advance objectives goes into the default queue.
- Every *additional* mission with a chain of two or more gets its own queue, named after the mission
  (deduplicated against `idx_run_queues_project_name`).
- Missions contributing a single auto-advance objective go into the default queue — one entry is not a
  chain, and giving it a queue of its own would be noise.

The result runs exactly as many agents after the migration as before it, and the §7.2 view shows every
queue that was created, so nothing is hidden. Order within each queue = mission board order, then
`objectives.position`.

This is the concrete reason the multi-queue groundwork ships in Phase 1: with a single queue the
backfill would have to merge N parallel chains into one serial line — a throughput regression users
would feel immediately and could not undo without the very feature being deferred.

**Code.** Delete the inline auto-advance block in `protocolDeliver` (`protocol.ts:2210-2340`, ~130
lines including launch-config resolution) and replace it with: "if the mission's next objective is not
queued, emit `awaiting_approval`; enqueue a dispatch job". `decideAutoAdvanceAfterDelivery` is
superseded by `planRunQueueDispatch`; keep it and its tests until the column is dropped.

**Retirement schedule.**

| Release | State |
|---|---|
| N (contract 96) | Queues are authoritative. `objectives.auto_advance` still written on enqueue/dequeue for read-compat, never read by dispatch. Wire field `autoAdvance` derived from queue membership. CLI/MCP flags map to enqueue/dequeue. |
| N+1 | `objectives.auto_advance` stops being written; `ObjectiveDto.autoAdvance` marked deprecated in the contract. |
| N+2 (contract bump) | Column dropped; `--auto-advance` becomes a documented alias of `queue-objective`. |

Nothing in the agent-facing surface breaks at any step (**R11**).

---

## 10. Contract impact

Contract-version bump (next available; 95 at time of writing → **96**) with these `CONTRACT.md` edits:

1. **Version 96 Change Summary** — project Run Queues, the new REST family, the protocol commands, the
   `autoAdvance` → queue-membership mapping, and the Delegator rename.
2. **Protocol Layer** (`:173`) — add `queue-objective`, `dequeue-objective`, `run-queue`; restate
   `--auto-advance` as an alias.
3. **REST API Layer** (`:307`) — add `/api/projects/:id/run-queues*` and `/api/run-queues/*` with their
   authorization rule.
4. **Automations Layer** (`:390`) — declare `planRunQueueDispatch` as a pure planner.
5. **Runner → REST (Queue Surface)** (`:618`) — retitle to the Delegation Surface, state that
   `execution_requests` semantics are unchanged, that `requested_source = 'run_queue'` is a new open
   value, and that the Delegator has no awareness of Run Queues.
6. **Controlled Vocabularies** (`:851`) — no closed-vocabulary changes. `run_queue_entries.state` is a
   new closed vocabulary of this feature and should be listed; `execution_requests.requested_source`
   gains an open value.
7. **Machine-readable files** — `contract/protocol-commands.yaml` (new commands),
   `contract/components.yaml` (REST + Automations capabilities).

Database schema contract docs: `database/docs/09-database-schema-contract.md` (both tables +
vocabulary) and `database/docs/10-database-table-groups.md` (execution group).

**No conformance-breaking change for external consumers.** The Runner Layer, the Virtual Target
Gateway, and every connector see an unchanged `execution_requests` contract — the rename is prose only.
That remains the strongest argument for Option C over Option A.

---

## 11. Implementation phases

**Phase 1 — Queue engine, behavior-preserving.** Migration (both dialects) for `run_queues` +
`run_queue_entries`, plus the §9 backfill; `packages/core/service/run-queue.ts` with full
create/rename/pause/delete-with-move/move-entry support; `planRunQueueDispatch` in
`automations/src/objective-manager/`; dispatch worker + poller registration; trigger wiring;
`protocolDeliver` simplification; write-through ordering; all eight REST endpoints;
`ObjectiveDto.queueEntry`. Acceptance: an existing auto-advance chain behaves exactly as before; a
project with three chained missions still runs three agents after migration; and a queue spanning three
missions drains one at a time across two different execution targets.

**Phase 2 — UI + rename.** Queue popover replacing the auto-advance popover;
`/projects/$projectId/queue` route and board-header sheet rendering one section per queue, with
per-section dnd reorder and pause; both drag-boundary confirmation modals; mission-panel position
chips; the `AgentLaunchButton` sibling branch; the Delegator rename of §8.

**Phase 3 — Agent surfaces + retirement.** `ovld protocol queue-objective` / `dequeue-objective` /
`run-queue`; MCP `overlord_queue_objective`; `--auto-advance` alias mapping; docs
(`cli/docs/01-command-reference.md`, `cli/docs/04-runner-and-launch-execution.md`,
`webapp/docs/ui/03-mission-detail.md`, `webapp/docs/ui/04-execution-and-runner.md`); begin the column
retirement schedule.

**Phase 4 — Multi-queue management UI.** Create, rename, delete, and reorder queues; drag entries
between queues; a queue picker in the objective popover and in `--queue` autocomplete. The service and
REST layers already support all of it from Phase 1, so this is presentation work.

**Phase 5 (optional) — Cross-project rollup.** A read-only "everything queued" view beside `/inbox`
listing each project's queues in one scroll. Strictly a projection: reordering still happens inside one
queue, because sequence is only meaningful within a queue.

---

## 12. Test plan

- **Pure planner** (`automations`, no DB): per-queue independence, ordering, pause, hold-vs-drop,
  blocked reasons, agent/model inheritance. Mirrors the existing `rules.test.ts` style.
- **Multiple queues**: two queues in one project each dispatch their own head concurrently; pausing one
  does not stall the other; an empty queue is inert.
- **Sequence, not placement (R2)**: two consecutive entries resolving to different execution targets
  both dispatch in order; a queue whose head targets an offline machine holds that entry and the next
  entry still runs.
- **Direct runs never gate a queue**: with a queue head running, direct Runs on three other missions all
  launch immediately; with the queue idle, a direct run elsewhere does not delay the next dispatch. The
  one exception is asserted too: a direct run and a queue head in the *same* mission hold that head
  with `mission_busy`.
- **Idempotency**: two concurrent dispatch jobs for one project produce exactly one `execution_requests`
  row per queue; assert on the `run_queue:<entryId>` key.
- **Project isolation**: two projects with full queues drain concurrently and neither blocks the other.
- **Ordering write-through**: enqueue / reorder / remove / move-between-queues each leave
  `objectives.position` matching the sort contract; `protocolDeliver`'s next-objective query and the
  activity feed's upcoming chain agree with the queue view.
- **Drag confirmations**: cancelling either boundary modal leaves both the queue and
  `objectives.position` untouched and reverts the optimistic order.
- **Dispatch-time promotion**: a queued `future` objective stays `future` until it is the entry being
  dispatched; the mission's other future objectives are untouched.
- **Skip the queue**: a direct Run on a queued objective marks the entry `running`, does not
  double-launch, and its queue advances from it on delivery.
- **Failure paths**: request `failed` / `expired` / `cleared` return the entry to `waiting` with its
  position intact; the third failure holds it.
- **Mission moved between projects**: entry follows the mission into the destination project's default
  queue.
- **Compatibility**: `ovld protocol add-objectives --auto-advance` produces the same run order as today;
  `PATCH /api/objectives/:id { autoAdvance: false }` removes the entry.
- **Migration**: a project with three chained missions backfills into three queues and still runs three
  agents; a project with one chain plus two single auto-advance objectives backfills into one queue.

---

## 13. Decisions log

Every question from the previous revision has been answered; §3.1 carries them as rulings. For the
record, with where each landed:

| Question | Answer | Where |
|---|---|---|
| Does a project need more than one queue? | **Yes.** Ship the groundwork now — schema, service, REST, dispatcher — and defer only the management frontend. | §5.7, §5.1, §11 Phases 1 and 4 |
| Hold-and-skip or strict head-of-line? | **Hold-and-skip**, with a visible reason on the held entry. | §5.3 |
| Should dragging across the queue boundary act implicitly? | **No** — a confirmation modal in both directions. Reordering within the queued block still needs none. | §5.4, §7.1 |
| Promote `future → draft` at enqueue or dispatch? | **Dispatch time**, and only for the objective being dispatched. | §5.3 |

Two smaller calls are left to the implementer unless stated otherwise:

- **Default queue name.** "Run Queue" is assumed throughout; it is user-renameable from Phase 1 at the
  service layer.
- **Depth of the Delegator rename.** §8 renames prose, UI, and contract titles and leaves
  `execution_requests` and the runner endpoints alone. Say so if you want the schema renamed too — it is
  a large, purely cosmetic change across the Runner Layer, the versioned virtual-target API, every
  conformance manifest, and both migration dialects.
