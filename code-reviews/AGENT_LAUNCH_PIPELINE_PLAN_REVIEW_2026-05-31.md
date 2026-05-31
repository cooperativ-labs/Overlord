# Review of the Agent Launch Pipeline Remediation Plan

_Reviewed: 2026-05-31 for ticket `1:1288`, objective `31b3bcd1-3e70-48b7-b77e-15aa6825f51d`_

Reviews `code-reviews/AGENT_LAUNCH_PIPELINE_REMEDIATION_PLAN_2026-05-31.md` against the
current codebase and the nine decisions captured in objective
`09cf4d00-3d5d-47d5-852c-4383ab182b8e`.

## Overall Assessment

The plan is strong: well-structured, sequenced sensibly (migrations → request
creation → attach parity → runner → UI → naming → DRY), and it correctly honors
each of the nine decisions — including the places where the user overrode the
original review (Decision 3 "launching replaces submitted", Decision 6 "remove
device terminology entirely, no aliases"). The Definition of Done and
Cross-Surface Checklist are good guardrails.

The findings below are not reasons to reject the plan. One is a real correctness
gap that should be resolved before Phase 3 is implemented; the rest are clarity
and completeness gaps that will save rework if addressed in the plan now.

## Decision Coverage Check

| # | Decision | Plan phase | Honored? |
|---|----------|-----------|----------|
| 1 | MCP attach parity, your recommendation | 1 | Yes |
| 2 | Dedupe manual runs + allow relaunch of queued job | 3 | Yes (but see Finding A) |
| 3 | `launching` mirrors and replaces `submitted`; keep `submitted` in code | 2 | Yes |
| 4 | Carry selected target outside settings context | 5 | Yes |
| 5 | Quick Task Bar `cmd+enter` == Run button | 6 | Yes |
| 6 | Remove legacy device terminology entirely (no aliases) | 7 | Yes (but see Finding E) |
| 7 | DRY launch flag parsing/command construction | 8 | Yes |
| 8 | Fail safely on target config load errors | 9 | Yes |
| 9 | Tighten execution-request statuses | 10 | Yes |

## Findings

### A. (Blocking for Phase 3) Deterministic manual-run idempotency key collides with the existing uniqueness constraint and breaks relaunch-after-failure

Phase 3 says two things that are in tension given the schema that already
exists:

1. "Change manual-run idempotency to be deterministic at the objective level…
   Do not include a random UUID for `manual_run`."
2. "Do not reuse `failed` or `launched` rows. A new click after a real failure
   should create a new request."

Today `createExecutionRequest` builds the key as
`manual_run:<objectiveId>:<randomUUID>` (`lib/overlord/execution-requests.ts:142`),
and the table has `unique (organization_id, idempotency_key)`
(`supabase/migrations/20260521113000_add_execution_requests.sql:32`). The insert
path already catches `23505` and **returns the existing row**
(`execution-requests.ts:186`).

If the key becomes fully deterministic (`manual_run:<objectiveId>`), then after a
request reaches `failed` or `launched`, the old row still owns that key. A new
click will hit `unique(org, idempotency_key)`, fall into the 23505 handler, and
return the stale `failed`/`launched` row instead of creating a new request —
directly contradicting requirement (2) and Decision 2's relaunch intent.

The plan's new *partial* unique index on `(objective_id) WHERE status IN
(active)` correctly handles the "no duplicate **active** request" case, but it
does not resolve the conflict with the pre-existing **full** `(org,
idempotency_key)` uniqueness.

**Recommendation:** Make the plan explicit about reconciling the two
constraints. Options:
- Rely on the new partial-unique-on-active-status index for dedup, and **keep a
  varying component** in the manual-run idempotency key (or make
  `idempotency_key` nullable for manual runs) so a post-terminal-state relaunch
  can insert a fresh row. The active-state partial index, not the key, becomes
  the dedup mechanism.
- Or scope the `(org, idempotency_key)` constraint so it doesn't apply to
  terminal-state rows.

Either is fine, but the plan currently implies a fully deterministic key, which
the schema will reject on relaunch.

### B. (Clarity) `launching` is overloaded — it names both an objective state and an execution-request status

Phase 2 adds `launching` to the **`objective_state`** enum (currently `future,
draft, submitted, executing, complete` —
`supabase/migrations/20260513143000_objective_state_enum.sql:8`). Phase 4 uses
`launching` as an **`execution_requests.status`** value (that status already
exists in the check constraint —
`supabase/migrations/20260521113000_add_execution_requests.sql:34`).

So after this plan, the same word means two different things on two different
tables with two different lifespans:
- Objective `launching`: the entire pre-attach window (set at request creation).
- Execution-request `launching`: only the post-spawn / pre-attach window (set by
  the runner after spawn).

That is a real readability/debugging hazard ("why is the objective `launching`
but the request still `queued`?"). The decisions don't require the names to
match.

**Recommendation:** Either (a) explicitly document in the plan that the two
`launching` values are distinct and enumerate their lifecycles side by side
(simplest, keeps Decision 3's wording), or (b) pick a distinct objective-state
name (e.g. `queued`/`pending`) so the objective and request vocabularies don't
collide. At minimum, add a "Naming" note so an implementer doesn't assume they
are the same flag.

### C. (Completeness) Phase 1 omits two existing callers and underspecifies the SQL port of model resolution

Phase 1 says to make `markSubmittedObjectiveExecuting` a wrapper and call the new
RPC "from both REST attach and hosted MCP attach." But that function has **four**
callers today, not two:
- `lib/overlord/protocol-attach.ts:154`
- `lib/overlord/protocol-connect.ts:46`
- `lib/overlord/protocol-spawn.ts:145` (note: `spawn` bypasses the runner queue
  and creates a session immediately)

Changing the selection order (now preferring `launching` first) silently changes
`connect` and `spawn` behavior too. The plan should name these callers and state
the intended behavior, especially for `spawn`.

Separately, porting the transition into a Postgres RPC means re-implementing
non-trivial TypeScript in PL/pgSQL: `promoteNextFutureDraft`,
`requireExecutionAgentFromAssignment`, and especially
`resolveObjectiveModelIdentifier`, which derives the model from the attach-time
`metadata`/`selection` payload (`lib/objectives.ts:592-598`). An RPC can't see
that metadata unless it's passed as parameters. The plan's RPC sketch lists
`agent_identifier`/`model_identifier` but not how the metadata-derived model
reaches the RPC.

**Recommendation:** Add the `connect`/`spawn` callers to Phase 1's scope, and
either (a) pass the resolved model/agent into the RPC as parameters (compute in
TS, persist in SQL) rather than re-deriving metadata logic in PL/pgSQL, or
(b) explicitly accept the metadata params in the RPC signature. Calling out this
TS→SQL boundary is important because moving tested logic into SQL is itself a new
maintainability cost that partially trades one form of duplication for another.

### D. (Edge case) Phase 4's attach→`launched` linkage depends on env threading; specify the matching fallback and the non-runner path

Phase 4 marks the execution request `launched` only after attach creates the
session, matched via `OVERLORD_EXECUTION_REQUEST_ID` / `OVERLORD_LAUNCH_SESSION_ID`
threaded runner → `ovld launch` → `ovld protocol attach` → metadata. Two cases
need an explicit answer:
- **Runner launch where env threading is missing/dropped:** attach can't match
  the request, so it stays `launching` until the stale-timeout watchdog reclaims
  it. That's acceptable (the watchdog exists), but the plan should say attach
  falls back to matching the active `launching` request by `objective_id` so the
  happy path doesn't depend solely on env propagation.
- **Manual `ovld launch` with no runner / no execution request:** there is no row
  to mark; the plan should note attach simply skips request completion in that
  case (today's manual-launch flows must keep working).

**Recommendation:** Add the fallback matching rule (by objective_id + active
`launching`) and an explicit "no execution request → no-op" note to Phase 4.

### E. (Minor) Phase 7's `--device-fingerprint` hedge is a partial deviation from Decision 6

Decision 6 is "remove the legacy terminology entirely. We don't need to keep it."
Phase 7 fully removes `targetDeviceId` / `--target-device-id` (good), but hedges
on `--device-fingerprint` ("if time allows… otherwise document as a follow-up").

This is defensible — a fingerprint is a genuinely lower-level runner/hardware
identity concept, not an execution-target alias — but it is a scope carve-out
against a decision that said "entirely." Make it an explicit, justified decision
in the plan rather than a time-permitting maybe, so it isn't read later as
incomplete execution of Decision 6.

### F. (Minor) Phase 10 maps `cancelled` → `failed`, conflating cancellation with failure

Decision 9 was "do what you think is best," so this is within bounds. But folding
existing `cancelled` rows into `failed` loses the distinction between
user-cancelled and genuinely-failed launches, which can muddy operational
metrics later. The plan already flags "or a future explicit cancellation
implementation"; just make sure the data migration records the original status
(e.g. in `last_error` or a note) so the cancel/fail distinction is recoverable if
cancellation is reintroduced.

## Smaller Notes

- Phase 2's reader list should include the objective resolver used at request
  creation (`resolveObjectiveForExecution`, `execution-requests.ts:78`), which
  filters launchable objectives by state and must accept `launching`.
- Phase 3's "reset stale `claimed`/`launching` → `queued` before re-emitting"
  correctly covers the Decision 2 relaunch scenario, because Phase 4 moves the
  post-spawn state to `launching` rather than `launched`. Good internal
  consistency between Phase 3 and Phase 4 — worth keeping that dependency
  explicit in the implementation order.
- The Suggested Implementation Order leads with migrations (objective
  `launching`, active-uniqueness, status cleanup). Given Finding A, the
  manual-run key strategy should be settled before the active-uniqueness
  migration is written.

## Verdict

Approve with revisions. The phasing and decision coverage are sound. Before
implementation, update the plan to (A) reconcile manual-run idempotency with the
existing `(org, idempotency_key)` constraint and the relaunch-after-failure
requirement, (B) disambiguate the two `launching` meanings, (C) include the
`connect`/`spawn` callers and specify how the RPC receives the resolved model,
and (D) specify Phase 4's fallback matching and non-runner behavior. Findings E
and F are minor and can be handled inline during implementation.
