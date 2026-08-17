# Objective-Centric Execution Model

**Mission:** coo:756
**Status:** implementation plan (do not implement from this document until a follow-up objective is launched)
**Scope:** product behavior, data model, CLI/API, execution semantics, identifiers, UI, migration, testing
**Out of scope for this document:** writing the code

---

## 1. Goal

Evolve Overlord so the **objective is the unit of execution**, while the **mission remains the shared context, planning container, and optional scheduler**.

Adopt this distinction everywhere execution identity is shown or stored:

| Concept    | Role                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------- |
| Mission    | Shared context, Kanban/planning container, optional scheduler for its objectives             |
| Objective  | Explicit unit of execution (one agent pass / one session)                                    |
| Session    | One attached run of one objective; already has both `mission_id` and `objective_id`          |

Live/activity surfaces should identify **which objective is running**. Planning surfaces may stay mission-first.

The existing mission-oriented workflow stays: a caller who only has a mission ID still asks Overlord to pick the appropriate objective.

---

## 2. Current state (verified against the codebase)

This plan starts from what the code actually does, because the product already has an objective launch API and still *behaves* mission-centrically after that point.

### 2.1 Launch is already per-objective

Clicking **Run** on an objective already calls `POST /api/objectives/:id/launch` (`webapp/web/components/objectives/AgentLaunchButton.tsx` → `api.launchObjective`). There is **no** `POST /api/missions/:id/launch`.

`backend/execution/launch.ts` `launchObjective`:

1. Loads that objective by UUID.
2. Rejects if a **sibling** objective on the same mission is `launching` / `executing` / `pending_delivery` (or has an active execution request).
3. Flips the objective to `launching` (from `draft`) and inserts an `execution_requests` row that already stores **both** `mission_id` and `objective_id`.

Inbox, New Mission, and Quick Task Bar also call `launchObjective` with a known objective id.

### 2.2 Attach rediscovers the objective from mission state

The launched agent is told to run:

```
ovld protocol attach --mission-id coo:756
```

`packages/core/service/protocol.ts` `attachSession` then calls `resolveActiveObjective`:

```
executing → launching → pending_delivery → draft → first non-complete
```

It does **not** take `--objective-id`. `OVERLORD_EXECUTION_REQUEST_ID` is used only *after* that selection, to link the session. If rediscovery picks the wrong objective, `linkExecutionRequestToSession` 409s with `execution_request_mismatch`.

Copied prompts (`getObjectivePrompt`) and the launch context file (`cli/src/launch.ts`) tell the agent the objective UUID is “informational only; never pass it as `--mission-id`”, and that the mission display ID is the only identifier they should type.

That is the gap this plan closes: **where the product already knows the objective, execution must stay pinned to it.**

### 2.3 Persistence is mixed, identity is mission-only

Already stored with both `mission_id` and `objective_id` (do not re-derive later from mutable mission state):

- `agent_sessions`
- `execution_requests`
- `deliveries`
- `changed_files` / `change_rationales`
- `objective_attachments`
- most `mission_events` (nullable `objective_id`)
- `notifications` (nullable `objective_id`; **presentation** still uses mission `display_id` + mission title)

Mission-only identity today:

- `missions.display_id` (`{workspace.slug}:{sequence_number}`, e.g. `coo:756`)
- Latch session `name` / `title` (`cli/src/launch.ts`: `name: plan.missionDisplayId`, `title: plan.missionTitle`)
- Protocol session-key cache: `(cwd, missionId)` (`cli/src/session-key.ts`)
- Native harness session cache: `(cwd, missionId, agent)` (`cli/src/native-session.ts`)
- Active-mission pointer: one per cwd (`cli/src/active-mission.ts`)
- Launch env: `MISSION_ID` / `OVERLORD_MISSION_ID` only
- Live Activity snapshots: missions, not objectives (`backend/live-activities.ts`)
- Deep links: `overlord://missions/<missionId>`
- Mobile Home activity board: one row per mission (`OverlordMobile/.../HomeActivity.swift`)

`objectives` has no display identifier. `ObjectiveDto` has no `displayId`.

### 2.4 Mission-level “lock” is a sibling-active check, not a row lock

Not a mutex table. Enforced in three places:

1. **Service:** `launchObjective` 409 if another objective on the mission is active (`ACTIVE_SIBLING_OBJECTIVE_STATES`).
2. **Lifecycle spec:** `automations/src/objective-manager/objective-lifecycle.md` invariant 2 — at most one `executing` **or** `pending_delivery` per mission. Also at most one `draft`.
3. **UI:** `AgentLaunchButton` `hasActiveSibling` — confirm, then enable auto-advance (or park the sibling to `submitted` and launch).

There is no unique partial index enforcing one executing objective; it is service-layer + tests.

### 2.5 Mission status is singular

`missions.status_type` is one of `draft | execute | review | complete | blocked | cancelled`. Attach calls `moveMissionToExecute`; deliver (when not auto-advancing) calls `moveMissionToReview`. Parallel executing objectives cannot be expressed in that column without new rules.

### 2.6 Branch / worktree is per-mission

`missions.active_branch` is one value. `cli/src/branch-planning.ts` `canonicalMissionBranch` keys off `{ mission.title, mission.sequence }` plus `resourceKey`. Two objectives on the same resource would share (or fight over) the same worktree.

Objectives already have `resource_key` and `branch` (the branch *that objective* actually ran on). The mission-level `active_branch` is the panel’s “current” git control.

### 2.7 CLI naming is already overloaded

| Command | What it actually does |
| --- | --- |
| `ovld attach <missionId>` / `ovld execution` | Queue via `POST /api/objectives/:id/launch`. Optional `--objective-id`; otherwise **`firstObjectiveId`** (position 0), not the launchable-state picker. |
| `ovld launch` / `ovld run` / `ovld connect` / `ovld resume` | Local spawn. Optional `--objective-id`; otherwise **`launchableObjectiveId`** (`executing` → `submitted` → `launching` → `draft`). |
| `ovld protocol attach` | Create/reuse `agent_sessions`, `resolveActiveObjective`. **No `--objective-id`.** Required `--mission-id`. |
| `ovld protocol prompt` | Create mission, then attach or queue. |
| MCP `overlord_attach_session` | Same as protocol attach; `missionId` only. |

`cli/src/flag-registry.ts` lists `--objective-id` on management `attach`, **not** on protocol `attach`. `contract/protocol-commands.yaml` `sessionLifecycle.attach` does not include `--objective-id`.

---

## 3. Target architecture

Two execution paths, one primitive.

```
run mission <mission-ref>
    → selectObjectiveForMissionLaunch(mission)
    → executeObjective(objective)

run objective <objective-ref>
    → resolve parent mission
    → load the same mission context as today
    → executeObjective(that objective)   // no rediscovery
```

`executeObjective` is the existing `launchObjective` + runner claim + `attachSession` **pinned to that objective**. Mission launch is a scheduler/convenience layer. Do not duplicate launch, branch prep, or attach.

**Selection vs pinning**

| Caller knows the objective? | Path |
| --- | --- |
| Yes (Run button, `--objective-id`, execution request, auto-advance of a specific next row) | Direct objective execution |
| No (mission card run, `ovld attach coo:756`, protocol attach with only mission id, MCP attach with only mission id) | Mission launch → select → same primitive |

### 3.1 Attach selection order (the actual primitive change)

`attachSession` must resolve the objective in this order:

1. Explicit `--objective-id` / `objectiveId` (UUID or new display id). Must belong to the mission if `--mission-id` is also present.
2. Else `OVERLORD_EXECUTION_REQUEST_ID` / `--execution-request-id` → `execution_requests.objective_id`.
3. Else today’s `resolveActiveObjective` (mission-launch / discuss-then-attach).

If (1) or (2) is present, **do not** fall through to (3).

Additive protocol shape (non-breaking):

- Keep `--mission-id` required in v1 of this change.
- Add optional `--objective-id`.
- Later (optional, see open questions): allow `--objective-id` alone; server resolves `mission_id` from the objective.

### 3.2 What “execute this objective” means

Unchanged from today, except identity and the sibling lock policy (Phase D):

1. Validate launchable state (`draft` / `submitted` / `launching`; `future` still requires promote).
2. Resolve execution target + connected resource for `objectives.resource_key`.
3. Insert/reuse `execution_requests` for **that** objective.
4. Runner claims, prepares branch, writes context file, spawns agent.
5. Agent attaches **to that objective**, session row already has `objective_id`.
6. Context assembly stays mission-wide (`previousObjectives` / `futureObjectives` / artifacts / shared state / resources).

---

## 4. Objective display IDs

### 4.1 Scheme

Persist a short **key**, compute the public id:

```
<mission.display_id>|<display_key>
```

Examples: `coo:756|k7xm`, `coo:756|n4w2`.

Properties:

- Globally readable in logs, terminals, notifications, CLI.
- Clearly tied to the parent mission (`coo:756|…`).
- Stable across reorder (`position` is not part of the id).
- Does not use `1`, `2`, `3` (those imply current order).
- Short enough for Latch names and tab titles.
- Unique **within the mission** (and therefore unique in the workspace, because `missions.display_id` is unique per workspace).

Separator is `|`, not `:`, so it cannot be confused with `slug:sequence`.

Do **not** persist the full string `coo:756|k7xm` as a second column. Mission `display_id` is assigned at create and does not change on board reorder. Compute at read time. If a future change ever rewrites mission `display_id`, objective public ids follow automatically; the key stays stable.

### 4.2 Key generation

| Decision | Choice |
| --- | --- |
| Column | `objectives.display_key` `text NOT NULL` |
| Alphabet | Crockford Base32, **lowercase**: `0123456789abcdefghjkmnpqrstvwxyz` (no `i`, `l`, `o`, `u`) |
| Length | **4** characters (`32^4 = 1,048,576` per mission) |
| Entropy | `crypto.randomBytes`; map onto the alphabet |
| When | On insert, in the same transaction as the objective row |
| Immutability | Never updated on reorder, rename, state change, or mission title change |
| Collision | Unique index; retry (cap 8). On exhaustion, lengthen to 5 (should never happen) |

Do not use nanoid with a URL alphabet that includes `-` or `_` (harder to scan in logs). Do not encode `position` or a “number of objectives so far” integer in decimal.

Rejected alternatives:

- `coo:756-1` / `coo:756.2` — encodes order.
- UUID suffix — too long for titles.
- Hash of objective UUID truncated — collisions + ugly.
- Per-mission monotonic counter encoded as `a`, `b`, `c` — still reads as creation order.

### 4.3 Persistence and uniqueness

SQLite + Postgres, same migration timestamp prefix (current datetime per repo rule):

```sql
ALTER TABLE objectives ADD COLUMN display_key text;
-- backfill, then:
-- SQLite: recreate-not-null via table rebuild if needed; Postgres: SET NOT NULL after backfill
CREATE UNIQUE INDEX idx_objectives_mission_display_key
  ON objectives (mission_id, display_key)
  WHERE deleted_at IS NULL;
```

Soft-deleted rows may keep their key; a new objective may reuse a key only after the old row is deleted (partial unique index). Prefer **never reusing** keys: include deleted rows in a second unique index on `(mission_id, display_key)` with no `deleted_at` predicate if we want permanent uniqueness. **Recommendation:** uniqueness among non-deleted rows is enough; deleted keys may be reused. Document that historical logs can theoretically collide with a new objective after delete (rare).

### 4.4 Resolver

Add `resolveObjectiveRef({ ctx, ref, missionId? })` next to `resolveMissionId` in `packages/core/service/context.ts`.

Accept:

1. Objective UUID.
2. Full display id `slug:sequence|key` (case-insensitive key; normalize to lowercase).
3. If `missionId` is already resolved and `ref` matches `^[0-9a-hjkmnp-tv-z]{4}$`, treat as key scoped to that mission.

Reject:

- Bare `coo:756` (that is a mission id) with a clear error: use mission launch, or pass a full objective display id.
- `coo:756:k7xm` (wrong separator).

REST: existing `/api/objectives/:id` already uses UUID. Accept display id in the same param (same pattern as `/api/missions/:id` with `display_id`). Protocol/CLI: `--objective-id` accepts UUID or display id.

Workspace scoping: resolve inside `ctx.workspace.id`, same as missions. Objective UUIDs are globally unique; display ids are workspace-unique via the parent mission.

### 4.5 DTO / protocol surface

Additive on `ObjectiveDto` and `ObjectiveSummary`:

- `displayKey: string`
- `displayId: string` — computed `${missionDisplayId}|${displayKey}`

Mission detail already embeds objectives; include both fields there. List endpoints that already return objectives (`includeObjectives`) get them for free.

Attach / load-context `agentInstructions` should show:

```
Mission ID: coo:756
Objective ID: coo:756|k7xm
```

and instruct agents to pass `--mission-id coo:756` **and** `--objective-id coo:756|k7xm` on attach when both exist. Until protocol attach accepts `--objective-id`, the launch wrapper must pass it (env + argv), not rely on the model.

### 4.6 Migration of existing objectives

One forward migration (SQLite + Postgres):

1. Add nullable `display_key`.
2. Backfill every existing row (including soft-deleted) with a unique-per-mission key.
3. Set `NOT NULL`.
4. Create the unique index.

Backfill in application SQL or a small Node script run from the migration helper if the SQL dialect cannot loop easily — keep it deterministic and batched. Empty/draft slots get keys too (they are real rows).

No user-visible downtime: keys are additive; old clients ignore unknown DTO fields.

### 4.7 Shell / URL quoting

`|` is special in shells and some URLs.

- CLI: document quoting (`--objective-id 'coo:756|k7xm'`). Prefer accepting unquoted if the shell allows it; zsh/bash will pipe if unquoted — **always quote in generated copy-paste commands**.
- Deep links: if we add `overlord://objectives/...`, percent-encode `|` as `%7C` on the wire, decode in the desktop handler. Existing `overlord://missions/<id>` charset is `[A-Za-z0-9:_-]{1,64}` — `|` is **not** in that class. Objective deep links are a **new** URL shape (see §9.6), not a tweak of the mission pattern.

---

## 5. CLI, API, protocol, MCP — entry-point inventory

Classify every mission-id execution entry point as **keep as mission launch** or **migrate to objective execution**.

### 5.1 Keep as mission launch (select, then primitive)

| Surface | Today | Change |
| --- | --- | --- |
| `ovld attach <missionId>` without `--objective-id` | Queues `firstObjectiveId` | **Fix selection** to the same `resolveActiveObjective` / launchable rules as the server (not “first row”). Then call `launchObjective`. |
| `ovld launch` / `run` / `connect` / `resume` without `--objective-id` | `launchableObjectiveId` | Keep as mission launch. Align picker with server `resolveActiveObjective` so CLI and attach cannot disagree. |
| `ovld protocol attach --mission-id` without `--objective-id` | Rediscover | Keep as mission launch **only** when no execution request id is in env. If `OVERLORD_EXECUTION_REQUEST_ID` is set, pin (see §3.1). |
| MCP `overlord_attach_session` `{ missionId }` | Rediscover | Keep; add optional `objectiveId`. |
| `ovld protocol prompt` / `ovld prompt` | Create + queue first objective | Still mission create + launch of the **created** first objective (caller knows it — pass that id into the primitive). |
| Auto-advance after deliver | Queues the **next** objective by id | Already objective execution. |
| Future `POST /api/missions/:id/launch` | Does not exist | Add as convenience: select + `launchObjective`. Used by any “Run mission” control. |

### 5.2 Already know the objective — pin them

| Surface | Today | Change |
| --- | --- | --- |
| Objective **Run** button | `POST /api/objectives/:id/launch` | Keep. After this work it is the canonical UI path. |
| `ovld attach --objective-id` / `ovld launch --objective-id` | Already passed through | Keep; accept display ids. |
| Runner claim → spawn | Has `execution_requests.objective_id` | Context file + `ovld protocol attach` must include `--objective-id` and/or rely on execution-request pin. |
| `getObjectivePrompt` / copy CLI command | Attach by mission only | Generate attach with `--objective-id <displayId>`. |
| Inbox / New Mission / Quick Task | `launchObjective(created.id)` | Keep. |
| `ovld runner clear <objective_id>` | Already objective-scoped | Accept display ids. |

### 5.3 Proposed command naming

Do **not** replace existing verbs in the first ship. Add a documented mapping and thin aliases.

Conceptual operations:

```
run mission <mission-ref>
run objective <objective-ref>
```

Concrete, compatible mapping:

```
# Mission launch (select + queue or local spawn)
ovld attach <mission-ref> [--agent]
ovld launch <agent> --mission-id <mission-ref>
ovld protocol attach --mission-id <mission-ref>

# Direct objective execution
ovld attach --objective-id <objective-ref> [--mission-id <mission-ref>]
ovld launch <agent> --objective-id <objective-ref>
ovld protocol attach --mission-id <mission-ref> --objective-id <objective-ref>

# Optional later aliases (non-breaking)
ovld run-mission <mission-ref>
ovld run-objective <objective-ref>
```

Avoid a nested `ovld run mission` that collides with today’s `ovld run` (alias of `launch` with positional agent). If we want the conceptual names in the CLI, use `run-mission` / `run-objective` or `ovld mission run` / `ovld objective run` (new noun groups), not a breaking reinterpretation of `ovld run`.

**Recommendation:** first ship = flags and attach pin only. Second ship = `ovld objective run` / `ovld mission run` noun groups if the CLI-first spec is being rewritten anyway (`cli/docs/02-cli-first-product-surface.md`).

### 5.4 REST

| Method | Path | Role |
| --- | --- | --- |
| `POST` | `/api/objectives/:id/launch` | **Primitive** (exists). `:id` accepts UUID or display id. |
| `POST` | `/api/missions/:id/launch` | **New convenience.** Body same as objective launch (`agent`, `model`, …). Server selects objective, then calls `launchObjective`. 409 with the same sibling message until Phase D. |
| `GET` | `/api/objectives/:id` | Exists; accept display id. |
| `GET` | `/api/objectives/:id/launch-command` | Exists; copied command must include `--objective-id`. |

No new required fields on existing bodies. Additive `displayId` / `displayKey` on objective DTOs.

### 5.5 Protocol contract (`contract/protocol-commands.yaml`)

`sessionLifecycle.attach`:

- `requiredFlags`: still `--mission-id` (v1).
- `optionalFlags`: add `--objective-id`.
- Notes: when `--objective-id` or `--execution-request-id` is present, attach must not rediscover.

`loadContext` / `connect` / `discuss-objective`: remain mission-scoped (planning/discussion). Optional later: `load-context --objective-id` to highlight one objective without changing session semantics.

`resume-follow-up`: already has optional `--objective-id` in CLI help. Confirm protocol YAML and pin to that objective (today it may rediscover).

Not a contract version bump: additive optional flag + additive DTO fields.

### 5.6 MCP

`overlord_attach_session`: add optional `objectiveId` (UUID or display id). Description: use when the user named a specific objective; otherwise mission attach selects.

Hosted MCP still should not spawn local terminals; queueing remains `launchObjective` via REST where that path exists.

### 5.7 Launch environment and context file

Add:

| Variable | Availability | Value |
| --- | --- | --- |
| `OVERLORD_OBJECTIVE_ID` | `plan_build`, `terminal_env` | Objective **display** id (`coo:756|k7xm`) |
| `OVERLORD_OBJECTIVE_UUID` | `terminal_env` only (optional) | Stable UUID if we need it for scripts; prefer not advertising UUID to the model |

Keep `MISSION_ID` / `OVERLORD_MISSION_ID` as the mission display id.

Context file (`cli/src/launch.ts` `loadMissionContext` / launch markdown):

- Title line can remain mission for the file name `mission-coo-756.md` **or** become `mission-coo-756-k7xm.md`. **Recommendation:** `objective-coo-756-k7xm.md` (hyphen, not pipe, in filenames).
- Body lists Mission ID and Objective ID.
- Attach instruction: `ovld protocol attach --mission-id coo:756 --objective-id 'coo:756|k7xm'`.
- Objectives list in the briefing can show display ids instead of `1. 2. 3.` so the agent does not treat position as identity.

`packages/contract/src/launch-variables.ts`: document the new vars. `{OVERLORD_OBJECTIVE_ID}` available at `plan_build` so pre-commands can use it.

`packages/contract/src/agent-launch-flags.ts`: any generated `ovld launch …` string includes `--objective-id`.

---

## 6. Data model and execution records

### 6.1 Already correct — keep both FKs

Historical integrity already records `objective_id` on sessions, execution requests, deliveries, file changes, rationales. **Do not** start deriving “which objective ran” from the mission’s current draft.

Retain **both** `mission_id` and `objective_id` on those tables (convenient query + integrity if an objective is later deleted — prefer `ON DELETE RESTRICT` which already exists for most of these).

`mission_events.objective_id` is nullable. New execution-related events (`execution_requested`, session updates, delivery, ask) must continue to stamp it. Backfill is not required for this plan; new writes must be complete.

### 6.2 New / changed columns

| Table | Change |
| --- | --- |
| `objectives` | `display_key text NOT NULL` + unique `(mission_id, display_key)` among live rows |
| `missions` | **Phase D only:** `allow_parallel_objectives boolean NOT NULL DEFAULT false` (name bikeshed in open questions) |

No change to `execution_requests` schema for pinning; it already has `objective_id`.

### 6.3 Derived “current objective” is presentation, not history

`deriveObjectiveLifecycleView` (`automations/src/objective-manager/rules.ts`) exposes a single `activeObjective`. That is valid for **planning UI** while the one-active invariant holds.

Once parallel is allowed:

- Replace `activeObjective` with `activeObjectives: T[]` (or keep `activeObjective` as “primary” = newest executing, plus `activeObjectives`).
- `MissionDto.hasExecutingObjective` stays a boolean (any executing); add `executingObjectiveCount` if activity surfaces need it.
- Disconnect / Latch “current card” must take an objective id, not `objectives.find(executing)`.

### 6.4 Shared context

`shared_context_entries` is unique on `(mission_id, key)`. That is **mission shared memory** and should stay that way: parallel objectives on one mission share it, last-writer-wins, same as two sequential objectives today.

Do not unique-index on `(mission_id, objective_id, key)` unless we introduce objective-private context (out of scope). Optional later: `write-context --objective-id` as provenance only (column already exists).

### 6.5 Schema contract and Kysely

Per database AGENTS.md:

1. Update `database/docs/09-database-schema-contract.md` `objectives` table.
2. SQLite + Postgres migrations with datetime-prefixed filenames.
3. `yarn generate` for Kysely types.
4. DTO in `packages/contract`.

Not a closed-vocabulary change. Not a contract version bump unless we later change `objectives.state` or drop the one-active invariant from a documented stable interface.

---

## 7. Parallel objective execution

**Do not ship unconstrained parallelism in the same change as identity.** Identity + pinned attach is useful with the current one-active rule. Parallelism is a separate phase with real data races.

### 7.1 What is locked today

| Resource | Scope today | Parallel-safe? |
| --- | --- | --- |
| Sibling launch 409 | Mission | No — this **is** the lock |
| `resolveActiveObjective` | Mission | Races if two launching |
| `ensureNextDraftObjective` | Mission (at most one draft) | Draft refill is OK if we keep one draft; two attaches both calling it need to stay transactional |
| `moveMissionToExecute` / `ToReview` | Mission status | **No** — one column |
| `missions.active_branch` | Mission | **No** for two agents on the same checkout |
| Worktree path | Mission title + sequence + resourceKey | **No** for same `resource_key` |
| Session-key cache | `(cwd, missionId)` | **No** — second attach overwrites |
| Native session cache | `(cwd, missionId, agent)` | **No** |
| Active-mission pointer | One per cwd | **No** |
| Latch `name` | Mission display id | Collision / indistinguishable |
| `findBindableChannelForMission` fallback | Unbound channel by mission | Can bind the wrong channel |
| Shared context keys | Mission | Last-writer-wins (acceptable if documented) |
| `changed_files` unique | `(session_id, objective_id, file_path)` | Yes, different sessions |
| Live Activity `running[]` | Missions, max 2 | Wrong grain; cap is account-level |
| `validateObjectiveLifecycle` `multiple_active_objectives` | Mission | Would fire |

### 7.2 Recommended lock move

| Concern | New scope |
| --- | --- |
| “Is this objective already queued/running?” | Keep per-objective (already: reuse active `execution_requests` for that objective) |
| “May another objective on this mission start?” | Mission policy flag, default **deny** |
| Git working tree | `(execution_target, resource_key, worktree)` — **not** mission |
| Protocol session key | `(cwd, objectiveId)` or `(cwd, sessionKey)` |
| Latch name / title | Objective display id |
| Session channel bind | Prefer execution-request id, then objective id; **stop** using mission-only fallback when multiple unbound channels exist |
| Live Activity / Home | Objective snapshots, not mission snapshots |

### 7.3 Shared mission state under parallel runs

Safe enough:

- Appending `mission_events` (include `objective_id`).
- Artifacts with `objective_id`.
- File changes per session/objective.
- Reading mission context.

Unsafe without extra design:

- Two agents in the **same git checkout** (including the same mission worktree).
- `missions.active_branch` / panel git actions.
- Mission `status_type` transitions (deliver → review while a sibling is still executing).
- `ensureNextDraftObjective` interacting with a human editing the draft while another objective attaches.
- Auto-advance firing while a sibling is still executing (today blocked by the sibling check; keep that unless the flag is on **and** the next objective’s `resource_key` is isolated).

### 7.4 Mission status under parallelism

Proposal when `allow_parallel_objectives` is true:

- `execute` if **any** objective is `launching` / `executing` / `pending_delivery`.
- `review` only when **no** objective is in those states and the latest delivery requested review (current auto-advance-off behavior).
- `blocked` if **any** attached session posted `ask` that is unanswered (or keep mission blocked only when the asking session is the “primary” — worse UX). **Recommendation:** mission is blocked if any objective is blocked; Home shows per-objective blocked rows.

Deliver of objective A while B is executing: do **not** `moveMissionToReview`. Park A as `complete`; mission stays `execute`.

### 7.5 Draft / current selection races

Keep **at most one `draft`** even when parallel executing is allowed. Draft is the planning “next up” slot, not an execution lock.

Mission launch while siblings are running:

- Flag **off** (default): keep today’s 409 + UI auto-advance prompt.
- Flag **on**: select the next launchable objective that is **not** already `launching`/`executing`/`pending_delivery`. If none, 409 `no_idle_launchable_objective` (do not start a second session on an already-executing objective).

`resolveActiveObjective` for unpinned attach: if multiple executing, **do not guess**. 409 `ambiguous_active_objective` and require `--objective-id`. Pinned attach is the happy path for runner-launched agents.

### 7.6 When a mission should prohibit parallelism

Default **off**. Reasons to keep off (and maybe omit the flag entirely until a customer needs it):

- Same `resource_key` / same worktree.
- Human-operated Kanban missions where “the” current job is a feature.
- Auto-advance pipelines (A then B) — parallelism would skip the sequence.

Force-serial when:

- Any active objective shares `resource_key` with the candidate **and** worktree automation would reuse `missions.active_branch`.
- Or always force-serial on the same resource until per-objective worktrees exist.

**Phase D should not invent per-objective worktrees in the same slice** unless we already need them. Safer Phase D: allow parallel only when `resource_key` differs (different repos). Same-resource parallel waits on per-objective worktrees (Phase E).

### 7.7 UI while still serial

Even before parallel, Run-on-objective must not be described as “launch this mission”. Copy on the sibling popover can stay until Phase D.

Disconnect (`DisconnectActivityButton`) currently finds `objectives.find(state === 'executing')` and parks **that one**. With parallel, disconnect must be per Latch card / per objective.

---

## 8. Latch, terminals, sessions

### 8.1 Session model

`agent_sessions` already has `objective_id` + `mission_id`. Latch `TerminalSessionDto` already has `objectiveId`. The bug is **display and routing**, not the FK.

Use **objective as primary execution identity**:

| Use | Today | After |
| --- | --- | --- |
| Latch `display.name` | `coo:756` | `coo:756\|k7xm` |
| Latch `display.title` | Mission title | `{objectiveDisplayId} — {objective.title \|\| truncated instruction}` |
| iTerm/Terminal window title | Whatever Latch/open flags set from the above | Same as Latch title |
| `execution_requests.metadata_json.providerSession` | Mapping by request (already per objective) | Unchanged |
| Reconnection / `latch open` | `providerSessionId` | Unchanged (id is Latch’s, not ours) |
| Persistence of mapping | Request metadata | Unchanged |
| Process env | Mission id | Mission + objective display ids |
| Logs / `latch inspect` name | Mission display id | Objective display id |
| Mission panel Latch card | Newest session for `activeObjective`, else newest | Newest session for **this** objective when rendering an objective; for mission-level card, newest among executing objectives, others in accordion (already has `others`) |
| `selectLatchSessionDisplay` | One current + others | Same helper; pass the objective id of the card, not “the” mission active objective when multiple exist |

### 8.2 What stays a mission id

- Kanban / mission panel URL `/user/missions/<missionId>`
- `overlord://missions/<missionId>` (planning deep link)
- Mission search, webhooks’ `missionId` (keep; they already optionally include `objectiveId`)
- Project/board filters
- Shared context reads
- `MISSION_ID` env (keep; add objective env)

### 8.3 Client caches that must re-key before parallel (can re-key earlier)

| Cache | Today | Change |
| --- | --- | --- |
| `cli/src/session-key.ts` | `(cwd, missionId)` | `(cwd, missionId, objectiveId)` — include objective display id or UUID. **Must** change before two sessions in one cwd. Harmless to change earlier: one executing objective → one key. |
| `cli/src/native-session.ts` | `(cwd, missionId, agent)` | Add `objectiveId`. |
| `cli/src/active-mission.ts` | One pointer per cwd | Either “active execution pointer” with `{ missionId, objectiveId, displayId }` or allow a list. For serial execution, storing both ids is enough. |
| Channel fallback | Mission-only last unbound channel | Never bind mission-only when `objectiveId` is known; if multiple unbound, require `executionRequestId`. |

`findBindableChannelForMission` already prefers execution request, then objective, then mission. Tighten: if `objectiveId` is provided, **do not** fall back to a channel whose `objective_id` is a different objective; mission fallback only when `objectiveId` is null.

### 8.4 Filename and tmp paths

`.overlord/tmp/mission-<displayId>.md` — `|` is awkward in paths. Use `objective-coo-756-k7xm.md` (hyphens). Keep writing under `.overlord/tmp/`.

---

## 9. Product / UI

### 9.1 Planning vs activity

| Surface | Grain |
| --- | --- |
| Mission Kanban, My Missions, calendar, mission search, inbox | **Mission-first** |
| Mission panel (detail) | Mission frame; objectives first-class **inside** it |
| Objective Run | Objective execution |
| Latch / terminal titles | Objective-first |
| In-app notification list, APNs body | Objective-first when `objective_id` is set |
| Mobile Home, Desktop activity, Live Activity, Dynamic Island | Objective-first |
| Mission card shimmer (`hasExecutingObjective`) | Can stay mission-level “this card is live” |

### 9.2 Mission panel

Keep Kanban and the mission header (`coo:756` + title).

Changes:

- Show each objective’s `displayId` in the objective list (mono, copyable), not only implicit order.
- Run remains on the objective (already). After attach pin, a second Run on a **different** objective still 409s until Phase D.
- Latch section: accordion already supports multiple sessions. Title each card with objective display id + objective title. Disconnect is per session/objective.
- `Disconnect mission activity?` → `Disconnect this objective?` when we know which one.

### 9.3 Notifications

Rows already have `objective_id`. Presentation (`backend/notifications.ts`):

```
coo:756: Title started working
```

Change when `objective_id` is present:

```
coo:756|k7xm: Objective title started working
```

Mission title as secondary in the payload if the client has room (iOS subtitle / desktop secondary line). Do not put user-authored instruction text unbounded into APNs (existing `presentationTitle` / `bounded` helpers).

`agent_started` catalog copy already says “on an objective”; the body still leads with mission id — fix that.

Consider additive types later (`objective_awaiting_review`) vs reusing `mission_awaiting_review` with objective presentation. **Recommendation:** keep type ids (no closed-vocab churn); change presentation only.

### 9.4 Live Activity (iOS)

`LiveActivityContentState.running` is `LiveActivityMissionSnapshot[]` (max 2). Change snapshot to objective grain:

- `displayId` = objective display id
- `title` = objective title (fallback mission title)
- `missionDisplayId` / `missionTitle` secondary
- `id` = objective UUID (or keep mission id + add `objectiveId` — **add `objectiveId`**, keep mission id for navigation)

Account-level cap of 2 **running objectives** (not 2 missions) matches “what is happening” better. Completions: completing one objective should not end the activity if a sibling is still running (today: mission-level).

Mobile Home (`HomeActivityItem`) is one row per mission with `executingObjectivePosition`. Change to one row per **running objective** (mission as subtitle). Finished/review buckets can remain mission-level (planning).

### 9.5 Desktop / web activity

Web `LiveActivityFeed` is the mission-panel event feed — stays on the mission (planning/history).

Desktop has no separate org-wide “what is happening” home in this repo; mobile Home is the template. If a future org activity view is added, use the same objective-first running list.

### 9.6 Deep links

Keep `overlord://missions/<missionId>` for push that opens the mission.

Add (Phase C, optional same ship as notifications):

```
overlord://objectives/<objectiveUuid>
overlord://missions/<missionId>?objective=<objectiveUuid>
```

Do not put `|` in the custom-scheme path without encoding. Desktop handler currently allows mission ids matching `[A-Za-z0-9:_-]{1,64}`. Extend or add a second route; do not silently drop objective URLs (that was the coo:502 bug for missions).

SPA route can stay `/user/missions/$missionId` with scroll/highlight to the objective (`?objective=`).

### 9.7 Mobile mission detail

`executingObjective` is a single optional. Copy: “is attached to this mission” → “is attached to this objective”. Latch section already prefers the executing objective’s session (`LatchSessionDisplay.swift`).

---

## 10. Backwards compatibility

| Area | Policy |
| --- | --- |
| `POST /api/objectives/:id/launch` | Unchanged path and body |
| `ovld attach <missionId>` | Still queues a selected objective |
| `ovld protocol attach --mission-id` | Still works; rediscovers **only** when no objective/request pin |
| `ovld launch --mission-id` | Still works |
| MCP attach `missionId` | Still works |
| Deep links to missions | Unchanged |
| Persisted Latch sessions | Old names stay `coo:756` until recreated; new launches get `coo:756\|k7xm` |
| Execution records | Already have `objective_id`; no backfill of “which objective” |
| Objectives without keys | Migration backfills before NOT NULL |
| External callers with only mission ids | Mission launch path |
| Session-key cache | Re-key is additive; old cache miss → agent passes `--session-key` or re-attaches |
| Agent instructions in flight | Old prompts still attach by mission; rediscovery remains the fallback |
| `hasExecutingObjective` | Remains valid |
| Auto-advance | Unchanged (already objective-targeted) |
| Webhooks | `mission.delivered` / `objective.completed` already have optional `objectiveId`; include `displayId` in full envelopes when convenient (open vocab, additive JSON) |

Breaking (avoid in v1): requiring `--objective-id` on protocol attach; renaming `ovld run`; changing Latch reconnection keys (`providerSessionId` stays).

---

## 11. Contract and cross-module impact

Invoke **component-contract** before implementation. Contract-first for:

| Change | Files |
| --- | --- |
| `objectives.display_key` | `database/docs/09-database-schema-contract.md`, SQLite+Postgres migrations, Kysely |
| Additive `ObjectiveDto.displayId` / `displayKey` | `packages/contract`, REST schema comments in CONTRACT.md REST section if DTOs are listed |
| Protocol `--objective-id` on attach | `contract/protocol-commands.yaml` (optionalFlags). No `contractVersion` bump |
| `POST /api/missions/:id/launch` | `CONTRACT.md` REST API Layer + `backend/AGENTS.md` checklist |
| Launch variables | `packages/contract/src/launch-variables.ts` |
| MCP `objectiveId` | MCP catalog + CONTRACT MCP tool list if enumerated |
| Phase D invariant change | `automations/.../objective-lifecycle.md`, `rules.ts`, CONTRACT only if we document “at most one executing” as a stable interface (today it is spec+service, not a DB CHECK) |
| Phase D `allow_parallel_objectives` | schema contract + Objective/Mission DTO |

`cli/docs/03-agent-protocol.md`, `docs/.../mission-launch-lifecycle.mdx`, `cli/docs/04-runner-and-launch-execution.md`, `cli/docs/06-core-domain-and-lifecycle.md` must be updated in the same ship as attach pin so agents stop being told the objective id is informational-only.

Conformance: no new component. Connector adapters do not need a capability flag.

---

## 12. Sequencing

Ship in slices that can each merge and sit in production.

### Phase A — Identifiers (schema + DTOs + resolver)

**Goal:** every objective has a stable display id; nothing execution-related changes yet.

- Migrations + backfill + unique index
- `resolveObjectiveRef`
- DTO fields on read paths
- Show/copy display id on mission panel objectives (optional UI, low risk)
- Tests: generate, collide, migrate, resolve UUID vs display id vs mission-id mistaken as objective

**Exit:** `GET` mission detail includes `objectives[].displayId`.

### Phase B — Pin execution identity (the core behavior change)

**Goal:** if the caller knew the objective, attach/run cannot rediscover another one.

- `attachSession` selection order (§3.1)
- Protocol optional `--objective-id`; CLI + MCP pass-through
- Runner launch: env `OVERLORD_OBJECTIVE_ID`; context file; generated attach argv includes `--objective-id`
- `getObjectivePrompt` / launch-command copy
- Latch name/title = objective display id + objective title
- Session-key / native-session cache include objective id
- Align `ovld attach` without `--objective-id` with server selection (stop using `firstObjectiveId`)
- Docs for agents

**Still serial.** Sibling 409 unchanged.

**Exit:** launching objective B’s runner cannot attach to objective A; Latch titles distinguish two sequential runs of the same mission.

### Phase C — Activity surfaces

**Goal:** live UI matches the new identity.

- Notification presentation
- Live Activity snapshot grain
- Mobile Home running rows
- Mission panel Latch cards / disconnect copy
- Optional objective deep link
- Webhook full envelopes include objective `displayId`

Can overlap B. Do not block B on App Store Live Activity attribute changes — if ActivityKit attributes are frozen, add fields carefully or keep mission `id` as the activity’s identity and put objective text in content state only.

### Phase D — Opt-in parallelism (same resource **not** required)

**Goal:** two objectives on **different** `resource_key`s may execute at once when `missions.allow_parallel_objectives` is true.

- Column + mission setting (default false)
- Relax `launchObjective` sibling check when flag on **and** resource keys differ
- Relax `validateObjectiveLifecycle` accordingly (or only when flag on)
- Mission status rules (§7.4)
- Unpinned attach with two executing → 409 ambiguous
- Channel bind: no mission-wide fallback
- UI: Run on a second objective does not force auto-advance when flag on and resources differ
- Tests: two queued requests, two claims, two attaches, deliver A while B runs

**Exit:** documented, off by default.

### Phase E — Same-resource parallelism (optional, later)

Per-objective worktrees or explicit “share dirty checkout” (almost certainly a bad default). Revisit `canonicalMissionBranch` / `active_branch`. Out of scope until D has a user.

### Suggested first implementation objective after this plan

**Phase A + B only.** That delivers the user’s “Run this objective” semantics and distinguishable sessions without unlocking shared-git races.

---

## 13. Testing

### 13.1 Identifiers

- Key alphabet/length; uniqueness retry
- Backfill on a fixture with N objectives, including deleted
- `resolveObjectiveRef`: UUID, display id, wrong separator, mission id passed as objective, cross-workspace 404
- DTO includes `displayId` on protocol attach response `objective`

### 13.2 Pinned attach (extend `backend/launch.test.ts`, `packages/core/service/protocol*.test.ts`, `cli/test/launch.test.ts`)

- Launch objective 2 while 1 is draft: attach with `--objective-id` of 2 never selects 1
- Launch with `OVERLORD_EXECUTION_REQUEST_ID` and **omit** `--objective-id`: still pins via request
- Mismatched `--objective-id` vs request → 409
- Unpinned attach still selects launching/executing/draft as today
- Context file and copied prompt contain quoted `--objective-id 'coo:…|…'`
- Latch create manifest `display.name` is the objective display id (`cli/test/launch.test.ts` / latch tests)
- Session key cache path differs per objective
- `ovld attach missionId` without flag selects launchable, not `objectives[0]` if those differ

### 13.3 Compatibility

- Existing `ovld protocol attach --mission-id coo:N` e2e (`cli/test/e2e/ovld-protocol.e2e.test.ts`)
- Runner claim → launch → attach still links `launched_session_id`
- Management `ovld attach --objective-id` UUID still works; display id works

### 13.4 Phase D (when built)

- Flag off: existing 409 sibling tests stay green (`backend/launch.test.ts`)
- Flag on, different `resource_key`: two `queued` requests, two sessions
- Flag on, same `resource_key`: still 409 (until Phase E)
- Deliver A while B executing: A complete, mission stays `execute`, B session healthy
- Unpinned attach with two executing: 409 `ambiguous_active_objective`

### 13.5 UI (lightweight)

- `selectLatchSessionDisplay` with two running sessions and a specified objective id
- Notification presentation helper unit test (mission-only vs with objective)

No need for a full mobile UI test in A/B; snapshot tests for presentation helpers are enough.

---

## 14. Affected systems (checklist)

| Area | Paths |
| --- | --- |
| Schema | `database/{sqlite,postgres}/migrations`, `database/docs/09-database-schema-contract.md` |
| Contract | `packages/contract` (`ObjectiveDto`, launch variables, agent-launch-flags), `contract/protocol-commands.yaml` |
| Core | `packages/core/service/context.ts`, `protocol.ts`, `missions.ts` (insert key), `latch-launch.ts` (manifest name/title), `agent-session/channels.ts`, `notifications/*`, `live-activity-jobs.ts`, `webhook-events.ts` |
| Automations | `objective-manager/rules.ts` + `objective-lifecycle.md` (Phase D) |
| REST | `backend/execution/launch.ts`, `backend/protocol.ts`, `backend/index.ts` (new mission launch route), `backend/notifications.ts`, `backend/live-activities.ts`, `backend/push-notifications.ts` |
| CLI | `cli/src/launch.ts`, `commands.ts` (`firstObjectiveId` vs launchable), `session-key.ts`, `native-session.ts`, `active-mission.ts`, `latch-launch.ts`, `protocol-help.ts`, `flag-registry.ts` |
| MCP | `mcp/tool-catalog.ts`, `mcp/server.ts` |
| Webapp | `AgentLaunchButton` (copy only until D), `MissionPanel` Latch/disconnect, `ObjectiveCollapsibleItem` display id, `latch-session-display.ts` |
| Desktop | deep-link parser if Phase C URLs land |
| Mobile | `HomeActivity.swift`, Live Activity snapshots, `MissionDetailContentView.swift`, `LatchSessionDisplay.swift` — **sibling repo** `OverlordMobile`; do not report those files as Overlord-repo changes |
| Docs | `docs/src/content/docs/docs-for-agents/mission-launch-lifecycle.mdx`, `cli/docs/03-agent-protocol.md`, `cli/docs/04-runner-and-launch-execution.md`, `cli/docs/01-command-reference.md`, `cli/docs/02-cli-first-product-surface.md` |
| Tests | listed in §13 |

---

## 15. Risks

1. **Agents ignore `--objective-id`** and attach with only `--mission-id`. Mitigation: runner always sets `OVERLORD_EXECUTION_REQUEST_ID` (already) and attach pins on that **before** rediscovery; do not trust the model.
2. **`|` in shells** breaks copy-paste. Mitigation: generated commands always quote; filename uses hyphens.
3. **Session-key cache re-key** looks like “lost session” mid-upgrade. Mitigation: read new key then fall back to old `(cwd, missionId)` once.
4. **Live Activity attribute / content-state change** may need an App Store client. Mitigation: Phase C can change content-state strings without changing the activity type name; add `objectiveId` additively.
5. **Parallelism on one git checkout** will corrupt work. Mitigation: default serial; Phase D only across `resource_key`; Phase E explicit.
6. **`firstObjectiveId` vs launchable** is already a footgun; fixing it in Phase B changes `ovld attach <mission>` behavior when position 0 is complete and a later draft exists. That is a **bugfix**, but it is user-visible. Call it out in changelog.
7. **Mission-only channel fallback** can attach harness events to the wrong session once two launches overlap. Tighten in B even while serial (cheap, prevents a class of bugs during relaunch windows).
8. **Display key reuse after delete** could confuse old logs. Accept or unique including deleted rows.

---

## 16. Open questions

Record decisions in a follow-up before Phase D; A/B can proceed on the recommendations below.

1. **Protocol attach without `--mission-id`?**  
   Recommendation: not in v1. Optional later.

2. **CLI noun `ovld objective run` in the first ship?**  
   Recommendation: no; flags + docs first.

3. **`allow_parallel_objectives` vs always-on for different resources?**  
   Recommendation: explicit flag, default false.

4. **Should mission launch while a sibling is running queue the next objective instead of 409?**  
   Recommendation: no (keep 409 / auto-advance). Queueing a second job without the flag recreates hidden parallelism.

5. **Live Activity grain vs App Store freeze?**  
   Needs a mobile owner. Plan assumes content-state can show objective text; attribute type stays `OverlordActivityAttributes`.

6. **Objective deep links in the same ship as B?**  
   Recommendation: Phase C. Notifications can still open the mission.

7. **Include soft-deleted keys in the unique index?**  
   Recommendation: live rows only.

8. **Filename `objective-coo-756-k7xm.md` vs keeping `mission-coo-756.md`?**  
   Recommendation: include the key so two sequential context files on disk are distinguishable.

9. **Should `GET /api/missions` `includeObjectives` be required for board display ids?**  
   No; only mission panel needs them initially. Board can stay mission-first.

10. **Disconnect + park to `submitted`:** keep as the way to release the sibling lock?  
    Yes, until Phase D.

---

## 17. Implementation notes for the next agent

- Do not implement from this plan until a dedicated objective says to.
- Start with **component-contract** + schema contract + migrations (Phase A).
- `display_key` generation belongs in `createMissionWithObjectives` / `add-objectives` / any other insert path in `packages/core/service/missions.ts` (single insert helper — do not generate only in REST).
- `attachSession` in `packages/core/service/protocol.ts` is the one pin implementation; REST/CLI/MCP must not fork selection.
- `launchObjective` stays the one queue implementation; mission launch is a wrapper.
- Never revert concurrent worktree files from other missions when testing locally.
- Mobile/Latch repos: read for context; only change them when the objective’s project resource is that repo (this Overlord checkout is `primary`).

---

## 18. Success criteria

Phase A+B are done when:

1. Every objective has a stable `displayId` of the form `coo:756|xxxx`.
2. Objective Run still calls `POST /api/objectives/:id/launch`, and attach of that run cannot bind a different objective.
3. Mission-only attach/launch still selects the current launchable objective.
4. Latch/session titles show the objective display id (and title), not only `coo:756`.
5. Existing mission-id CLI/API/MCP callers keep working.
6. One-active-objective sibling rule is unchanged.
7. Tests in §13.1–13.3 pass.
