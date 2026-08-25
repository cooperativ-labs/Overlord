# Run Queue flow review: waiting vs. blocked, cross-queue mission locks, and retry

Mission coo:854 · objective coo:854.9hm5 · 2026-08-25

## 1. Summary

The symptom the objective describes — a queued objective shown as **blocked** when it is really
just **waiting** for a sibling in the same mission to finish — is real, and it is not a display
problem. It is a state-machine defect with one root cause and several compounding gaps:

1. **Every hold is persisted as `blocked`, and `blocked` is never re-evaluated.** The dispatch
   worker writes `state = 'blocked'` for `mission_busy` (`backend/run-queue-dispatch-worker.ts:112-118`),
   and the planner only considers `state === 'waiting'` entries
   (`automations/src/objective-manager/rules.ts:164`). Nothing in the system returns a `blocked`
   entry to `waiting` except a human moving it (`moveRunQueueEntry`, `run-queue.ts:781`). So the
   first time a mission is busy, the entry is parked permanently, and the sibling finishing does
   not release it. The original design (`cross-mission-run-queue.md` §5.3) planned to iterate
   `state in {waiting, blocked}` every tick; the implementation narrowed that and the comment at
   `rules.ts:161-163` documents the narrowing as intentional ("a blocked entry is a
   terminal/actionable hold, not an implicit retry"). That is correct for `no_agent` and wrong for
   `mission_busy`.
2. **The worker ignores `missions.allow_parallel_objectives`.** `missionBusy` is computed as "any
   sibling in launching/executing/pending_delivery" (`run-queue-dispatch-worker.ts:77-79`) with no
   look at the mission flag, so missions that opted into parallel objectives are held exactly like
   serial ones. The direct-launch path does honor the flag
   (`backend/execution/launch.ts:1158-1174`), so the two entry points disagree.
3. **Two queues can launch two objectives of one serial mission in the same tick.** The planner is
   pure over a snapshot; `missionBusy` is computed once before any action is applied. If queue Q1
   and queue Q2 both have a mission-A head and A is idle, both get `dispatch` actions, and
   `createExecutionRequest` (`packages/core/service/execution-requests.ts`) does not enforce the
   sibling lock. The sibling lock is only enforced on the direct-Run path.
4. **Retry never happens.** `maxDispatchAttempts = 3` exists in the planner, but a dispatch
   exception (`worker:180-193`), a failed launch (`execution-requests.ts:1007`), an expired launch
   (`:1175`), or a cleared request (`:1089`) all set `blocked`, which is then never reconsidered.
   The design table (§5.6) said "entry returns to `waiting` keeping its position ... after
   `MAX_DISPATCH_ATTEMPTS` (3) it holds with `dispatch_failed`". Effective attempts today: 1.
5. **Fixing the cause of an actionable hold does not release it either.** `no_instruction` and
   `no_agent` are legitimate holds, but assigning an agent or filling in text goes through the
   objective PATCH in `backend/repository.ts`, which does not enqueue a dispatch job, and even the
   60 s sweep skips the entry because it is `blocked`.

Everything else in the queue model — one in-flight entry per queue, independent queues, direct
runs invisible to queues, lazy mission queues, ordering write-through to objective positions — is
sound and matches the design. The recommendations below keep that model and fix the state
machine around it.

## 2. How the system works today

### 2.1 Entities

- `run_queues` — per project; one `is_default` queue plus any number of named queues; a queue may be
  bound to one mission (`mission_id`) and is created lazily when that mission's objective is first
  queued without an explicit destination (`packages/core/service/run-queue.ts:137-205`). Emptying a
  mission queue retires it (`:593-612`).
- `run_queue_entries` — one live entry per objective across the whole project (unique index on
  `objective_id`), `state IN ('waiting','blocked','dispatched','running')`, `blocked_reason`,
  `attempt_count`, `execution_request_id`.
- `execution_requests` — the Delegator; created by the dispatcher with `requested_source='run_queue'`
  and an entry-scoped idempotency key `run_queue:<entryId>:attempt:<n>`.

### 2.2 The dispatch tick

`dispatchProjectRunQueues(db, projectId)` (`run-queue-dispatch-worker.ts:56`) runs as a durable
worker job deduped per project, triggered by every queue mutation, by delivery
(`protocol.ts:2655`), and by a 60 s sweep over projects with non-empty unpaused queues.

For each unpaused queue, in queue-position order:

1. If any entry is `dispatched` or `running`, skip the queue (one in flight per queue).
2. Walk `waiting` entries in position order:
   - objective missing / deleted / `complete` → **drop**
   - blank instruction → **hold** `no_instruction`, continue to next entry
   - objective already `executing`/`pending_delivery` → **mark_running**, stop
   - `missionBusy` → **hold** `mission_busy`, continue to next entry
   - `resourceConnected === false` → **hold** `resource_disconnected` (never set by the worker)
   - `attemptCount >= 3` → **hold** `dispatch_failed`
   - otherwise → **dispatch**, stop

`hold` is written as `state='blocked'`. A `blocked` entry is invisible to step 2 forever after.

### 2.3 Entry lifecycle as actually implemented

```
enqueue ──▶ waiting ──dispatch──▶ dispatched ──runner attaches──▶ running ──deliver──▶ (row deleted)
              │                       │                              │
              │ hold (any reason)     │ request failed/expired/      │ request cleared
              ▼                       │ cleared                      ▼
            blocked ◀─────────────────┴──────────────────────────────┘
              │
              └── only exit: human moves the entry (moveRunQueueEntry → waiting) or removes it
```

Compare the designed lifecycle (`cross-mission-run-queue.md` §5.3 diagram): `blocked` was meant
to flow back to `dispatched` on the next tick.

### 2.4 Who triggers a tick

| Event | Enqueues dispatch job? |
|---|---|
| enqueue / remove / move / reorder entry, create / unpause / delete queue | yes (`run-queue.ts`) |
| objective delivered via protocol | yes (`protocol.ts:2655`) |
| direct Run of an objective | no (marks a live entry `running`; no tick needed) |
| execution request failed / expired / cleared | **no** — only `reconcileLinkedRunQueueEntry`; waits for the sweep |
| human completes / disconnects / deletes an objective (`dequeueObjective`, `launch.ts:983`) | **no** — and the queue entry is not dropped either; the planner drops it only if it is `waiting` |
| objective PATCH (assign agent, edit instruction) | **no** |
| mission `allowParallelObjectives` toggled | **no** |
| 60 s sweep | yes, but it re-evaluates only `waiting` entries |

## 3. Catalogue of holds: which ones make sense

| Reason | Where produced | Nature | Verdict |
|---|---|---|---|
| `mission_busy` | worker `hold` | **transient** — clears by itself when the sibling finishes | Wrong as `blocked`. Must be a waiting condition re-checked every tick. Also wrong for parallel-enabled missions, where it should not fire at all. |
| `resource_disconnected` | planner (never reached: worker doesn't compute `resourceConnected`) | transient — clears when a device reconnects | Should be waiting. In practice today the failure surfaces as `dispatch_failed: <detail>` from `resolveLaunchExecutionTarget`/`createExecutionRequest` throwing, which is then sticky. |
| `no_instruction` | planner | actionable — needs a human edit | Correct as blocked, but must auto-release when the text is filled. |
| `no_agent` | worker (`:127-133`) | actionable — needs a human edit | Same. Also note the planner does not know about it, so it is not in the planner's reason union. |
| `dispatch_failed` / `dispatch_failed: <detail>` | planner (attempts exhausted) and worker catch block | mixed — a transient target outage looks the same as a permanently bad launch config | Should retry up to `maxDispatchAttempts` with the detail visible, then block. Today blocks on first failure. |
| request `failed` / `expired` / `cleared` (`reconcileLinkedRunQueueEntry`) | execution-requests service | mixed | Same retry policy. Note `cleared` from `dequeueObjective(reason='completed')` leaves a `blocked` entry on a `complete` objective that the planner will never drop, because it only drops `waiting` entries. |
| queue `paused` | queue flag | intentional | Fine; entries keep `waiting` and the badge reads "waiting" — this is the one case that already behaves as the objective describes. |

A second-order question: **should a held head let later entries run?** Today yes ("held entries
remain visible and do not block later work"). For actionable holds that is right. For a transient
`mission_busy` it is also acceptable — a queue mixing missions A and B should keep running B while
A is busy — but only if the head is re-evaluated first when the queue frees, so A's objective gets
priority once A is idle. With the fix in §4.1 that is the natural behaviour and no per-queue
"strict" flag is needed. Entries of the same mission behind a busy head hold for the same reason,
so intra-mission order within one queue is preserved.

## 4. Recommendations

Ordered by impact. R1–R3 are the fix for the objective; R4–R7 make the rest of the flow fluid.

### R1. Separate "waiting for a condition" from "blocked on a human"

Keep the four-state enum (no contract break for existing clients) but change what the states mean
and add a reason for waiting:

- `waiting` — eligible or waiting on a transient condition. New nullable column
  `run_queue_entries.waiting_reason` (`mission_busy`, `resource_disconnected`, `retry_pending`),
  exposed additively as `RunQueueEntryDto.waitingReason` and `ObjectiveDto.queueEntry.waitingReason`.
  Optionally `waiting_on_objective_id` so the UI can say *which* sibling it is waiting for.
- `blocked` — needs a human: `no_instruction`, `no_agent`, `dispatch_failed` after attempts are
  exhausted, `request_failed` after attempts are exhausted. `blocked_reason` keeps its meaning.
- `dispatched` / `running` unchanged.

Planner change (`rules.ts:planRunQueueDispatch`): iterate entries in `{waiting, blocked}` every
tick, exactly as §5.3 of the original plan specified. A `blocked` entry whose cause is gone
(agent assigned, text filled) is simply dispatched or downgraded to `waiting`; one whose cause
remains is re-held with the same reason (idempotent write). Replace the `hold` action with two:

```ts
| { action: 'wait';  entryId; reason: 'mission_busy' | 'resource_disconnected' | 'retry_pending'; waitingOnObjectiveId?: string }
| { action: 'block'; entryId; reason: 'no_instruction' | 'no_agent' | 'dispatch_failed' | 'request_failed' }
```

Worker change: `wait` writes `state='waiting', waiting_reason=?, blocked_reason=NULL`;
`block` writes `state='blocked', blocked_reason=?, waiting_reason=NULL`. Both guarded with
`WHERE state IN ('waiting','blocked')` as today. Move the `no_agent` decision into the planner by
passing `assignedAgent` in `RunQueuePlannerObjective` so the reason union is complete in one place.

### R2. Make the planner mission-aware and honour `allow_parallel_objectives`

Extend the planner input:

```ts
objectives: Record<string, { ..., missionId: string, assignedAgent: string | null }>;
missions:   Record<string, { allowParallelObjectives: boolean; busy: boolean }>;
```

and track per-tick claims:

```
claimedMissions = set of missionIds that are busy at snapshot time
for queue in queues ordered by position:
  ...
  if !mission.allowParallelObjectives && claimedMissions.has(o.missionId): wait(entry, 'mission_busy'); continue
  dispatch(entry); if !mission.allowParallelObjectives: claimedMissions.add(o.missionId); break
```

This closes the two-queues-one-mission race (§1.3) deterministically: the lower-positioned queue
wins the mission this tick, the other queue's head waits with `mission_busy` and is dispatched on
the tick that follows the winner's delivery — which is exactly the behaviour the objective asks
for ("the second queue may have to wait for the first queue to pass the objective from the shared
mission"). Parallel-enabled missions never enter `claimedMissions`, so their objectives in
different queues proceed independently.

Compute `busy` in the worker with the same predicate `findConflictingActiveSibling` uses
(objective state in `PARALLEL_BLOCKING_OBJECTIVE_STATES` **or** an active execution request on a
sibling), and factor that predicate into one shared helper so the direct-Run path and the
dispatcher cannot drift again. Belt-and-braces: have `createExecutionRequest` reject a
`requested_source='run_queue'` request that would violate a serial mission's lock, so a stale
snapshot can never double-launch; the worker already maps that exception to a retry (R3).

### R3. Real retry semantics

- Dispatch exception in the worker → `wait('retry_pending')` with the sanitized detail stored in
  `waiting_reason_detail` (or reuse `blocked_reason` text while state is `waiting`), `attempt_count + 1`.
- `reconcileLinkedRunQueueEntry` on `failed` / `expired` / `cleared` → `state='waiting'`,
  `waiting_reason='retry_pending'`, `execution_request_id=NULL`, `attempt_count + 1` (today the
  worker increments only on dispatch; request-level failures should count too, otherwise a runner
  that keeps failing to attach loops forever). Then **enqueue a dispatch job** — this path currently
  relies on the sweep.
- Planner: `attemptCount >= maxDispatchAttempts` → `block('dispatch_failed')` (or
  `request_failed`), reason text = last detail.
- Add an explicit **Retry** operation (`PATCH /api/run-queues/entries/:id { retry: true }`,
  protocol `retry-queue-entry`, MCP via `overlord_manage_run_queue`) that resets `attempt_count`
  to 0 and state to `waiting`. Today the only retry is "drag it somewhere", which also changes the
  order and does not reset attempts — after three drags the idempotency key still advances but the
  planner blocks it on `attemptCount >= 3`.

### R4. Close the trigger gaps

Enqueue a (deduped, cheap) dispatch job from:

- `dequeueObjective` (`launch.ts:983`) — and drop the objective's live queue entry there in the
  same transaction instead of leaving a `blocked` entry on a complete/deleted objective. The
  planner's `drop` should also apply to non-in-flight entries in any state.
- objective PATCH when `assigned_agent`, `instruction_text`, `state`, or `resource_key` changes
  and the objective has a live queue entry (`repository.ts` ~`:7584` already touches the queue for
  the `autoAdvance` compatibility path; same place).
- mission PATCH when `allow_parallel_objectives` changes (`repository.ts:5525`).
- execution-request `failed` / `expired` / `cleared` transitions (R3).
- runner/device connection events, so `resource_disconnected` waits clear promptly rather than on
  the next sweep.

With these, the 60 s sweep becomes the safety net it was designed to be rather than the primary
release mechanism.

### R5. Planner drop rule and objective-state edge cases

- Drop entries whose objective is `complete` or deleted regardless of entry state.
- An entry whose objective is `launching` with no live request (the "stuck launching" case
  `force`-removal exists for) should be `wait('retry_pending')` after the launch TTL expires, not
  require a manual force. `expireStaleExecutionRequests` already fires on the TTL; with R3 it
  returns the entry to `waiting`, but the objective stays `launching` and is refused by
  `LAUNCHABLE` checks in the worker's `UPDATE ... WHERE state IN ('draft','submitted')`. Reset the
  objective to `draft` there (mirroring what forced removal does at `run-queue.ts:587-592`) so the
  retry can actually launch.

### R6. UI: say "waiting", show what it is waiting for

`RunQueuePanel.tsx:127-131,160` and `DraftObjectiveActions.tsx:175-178` render every
`blockedReason` as amber "Held: …". Render:

- `waiting` + `waitingReason='mission_busy'` → neutral badge **Waiting**, secondary line
  "Waiting for coo:854.abcd to finish" (link to the sibling), no amber.
- `waiting` + `retry_pending` → "Retrying (2/3): <detail>".
- `blocked` → amber **Blocked** with the reason phrased as the action needed ("Assign an agent",
  "Add instructions", "Launch failed 3× — Retry") and a Retry button for the failure cases.
- `RunQueueDto.running` is unchanged; consider an additive `RunQueueDto.head` (first non-blocked
  entry) so the mission panel can say "Next up in Run Queue" without recomputing.

### R7. Smaller consistency fixes found on the way

- Sort queues by `position` in the planner explicitly (the worker relies on the SQL `ORDER BY`;
  make the pure planner deterministic on its own).
- `mission_busy` today counts a sibling in `launching` even when that sibling's execution request
  has already expired — the R2 shared predicate fixes this by also requiring an active request for
  `launching` siblings, matching `findConflictingActiveSibling`.
- `enqueueRunQueueEntry` sets `auto_advance = true` and removal sets it `false`; that compatibility
  column is still the source for `autoAdvance` when `queue_entry_id` is undefined
  (`repository.ts:1795-1796`). Fine for now, but the contract already marks it deprecated; once
  R1 lands, `autoAdvance` should be derived only from live membership.
- The worker computes `missionBusy` with one query per objective; with R2 compute one
  `busy`/`allowParallel` row per distinct mission in the project instead.

## 5. Contract impact

Additive only; proposed as contract bump **v122**:

- `run_queue_entries.waiting_reason text NULL` (+ optional `waiting_on_objective_id`), migrations
  for Postgres and SQLite.
- `RunQueueEntryDto.waitingReason: 'mission_busy' | 'resource_disconnected' | 'retry_pending' | null`
  and `waitingOnObjectiveId: string | null`; same on `ObjectiveDto.queueEntry`.
- Semantic narrowing: `state='blocked'` now means "needs a human"; `blockedReason` values are
  `no_instruction | no_agent | dispatch_failed | request_failed` (free-text detail may follow a
  colon, as today).
- `PATCH /api/run-queues/entries/:entryId` accepts additive `{ retry?: boolean }`; protocol
  `retry-queue-entry`; `overlord_manage_run_queue` action `retry_entry`. Authorization
  `execution_request:create`, same as other entry mutations.
- Dispatcher guarantee added to the Run Queue boundary paragraph: "A serial mission
  (`allowParallelObjectives=false`) has at most one dispatched/running Run Queue entry across all
  queues in the project; a parallel mission has no such limit."

Modules affected: `automations` (planner + tests), `packages/core/service/run-queue.ts`,
`execution-requests.ts`, `backend/run-queue-dispatch-worker.ts`, `backend/execution/launch.ts`
(`dequeueObjective`), `backend/repository.ts` (PATCH triggers), `packages/contract`, `mcp`
(`tool-catalog.ts`, `run-queue-detail.ts`), `cli/src/protocol-help.ts`, webapp Run Queue panel and
objective actions, `CONTRACT.md`. No runner/virtual-target wire change.

## 6. Suggested phases

1. **Planner + worker** (R1, R2, R5, R7): pure planner change with tests for: busy serial mission →
   `wait`; busy parallel mission → dispatch; two queues, one serial mission → one dispatch and one
   `wait`; `blocked` entry re-evaluated and released when cause clears; drop in any state. Worker
   writes the new states; migration adds `waiting_reason`. Contract v122.
2. **Retry + triggers** (R3, R4): reconcile-to-waiting, attempt accounting, dispatch triggers from
   request failures, `dequeueObjective`, objective/mission PATCH; Retry endpoint/protocol/MCP.
3. **UI** (R6): badge and copy changes in `RunQueuePanel`, `DraftObjectiveActions`,
   `MissionCardBody`; Retry button.

Phase 1 alone resolves the reported symptom: `mission_busy` becomes a `waiting` condition that is
re-checked on every delivery-triggered tick, and a second queue's head from a shared serial mission
proceeds as soon as the first queue's objective delivers.

## 7. Files referenced

- `automations/src/objective-manager/rules.ts:115-202` — `planRunQueueDispatch`
- `backend/run-queue-dispatch-worker.ts:56-195` — `dispatchProjectRunQueues`
- `packages/core/service/run-queue.ts` — queue/entry service
- `packages/core/service/execution-requests.ts:57-87` — `reconcileLinkedRunQueueEntry`
- `packages/core/service/objective-parallelism.ts` — `missionAllowsParallelObjectives`, `findConflictingActiveSibling`
- `backend/execution/launch.ts:983-1079,1140-1174,1311-1319` — `dequeueObjective`, direct-launch sibling lock, direct-run entry marking
- `packages/core/service/protocol.ts:2580-2586,2655` — delivery drops the entry and triggers a tick
- `webapp/web/components/run-queue/RunQueuePanel.tsx:127-165`, `webapp/web/components/objectives/DraftObjectiveActions.tsx:175-182` — "Held" rendering
- `planning/feature-plans/cross-mission-run-queue.md` §5.2–5.7 — original design this review is measured against
