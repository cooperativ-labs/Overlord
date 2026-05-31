# Agent Launch Pipeline — Test Coverage Assessment

_Created: 2026-05-31 for ticket `1:1288`, objective `d238bb8e-cf36-48dc-9679-9f0bc05aed42`_

Companion to:

- `code-reviews/AGENT_LAUNCH_PIPELINE_REVIEW_2026-05-31.md` (flow map + findings)
- `code-reviews/AGENT_LAUNCH_PIPELINE_REMEDIATION_PLAN_2026-05-31.md` (10-phase plan)
- `code-reviews/AGENT_LAUNCH_PIPELINE_PLAN_REVIEW_2026-05-31.md` (plan review)

## Implementation status update (2026-05-31, objective `db05263b`)

The "Execute the plan" objective implemented and unit-tested the backend
lifecycle core. The framing below ("not yet implemented") described the state
*before* this pass. Now implemented + green (jest, plus `node --test` for the
CLI runner):

- **Phase 1 (TS):** `markSubmittedObjectiveExecuting` and the hosted MCP attach
  handler select `launching → submitted → draft`, ordered `position, created_at`
  (MCP previously ordered `created_at DESC` and ignored `launching`). The atomic
  `claim_next_objective_for_execution` RPC remains a hardening follow-up.
- **Phase 2:** `createExecutionRequest` writes `launching`; readers/UI include
  it. Migration `20260531120000_add_launching_objective_state.sql` (+ types).
- **Phase 3:** active-objective dedup + relaunch wake-up event in
  `createExecutionRequest`; partial index migration
  `20260531121000_execution_requests_active_objective_index.sql`. Partial-index
  race + new-request-after-terminal remain integration-only (need live DB).
- **Phase 4:** `complete-execution-launch` → `launching`; attach (REST + MCP)
  marks the matching request `launched` after the session exists; stale
  `launching` reclaim in `claim-execution`. Runner threads
  `OVERLORD_EXECUTION_REQUEST_ID`.
- **Phase 9:** `resolveTargetAgentLaunch` returns a discriminated result;
  `claim-execution` fails closed on `error` (no fallback flags).
- **Phase 10:** status set tightened to queued/claimed/launching/launched/failed;
  migration `20260531122000_tighten_execution_request_statuses.sql` folds
  cancelled/expired → failed preserving the original in `last_error`.

**Not implemented in this pass:** Phases 5/6 (UI Run builder + selected-target
hook + Quick Task Bar parity), Phase 7 (device→execution-target naming removal),
Phase 8 (centralized launch-args module). Also pending: applying the migrations
+ `yarn generate` against a live Supabase (this environment had none), and the
integration/component test homes those need.

## Purpose

This objective is "check tests that cover this work, then add any other tests you
will need to validate the planned functionality." This document does the first
half (an audit of what exists) and records what was added for the second half.

**Important framing:** the remediation plan is *not yet implemented*. The current
code still uses the `submitted` objective state (not `launching`), marks
`execution_requests` `launched` at runner spawn (not at attach), dedups manual
runs only by `idempotency_key` (no active-by-`objective_id` index), and exposes
`targetDeviceId` / `--device-fingerprint` at the public boundary. Because the
behavior the plan describes does not exist yet, tests that assert it cannot pass
today. The new tests added for those behaviors are therefore committed as
**pending (`describe.skip`) specs** that are written to compile and to be
activated phase-by-phase as each implementation lands. See
[Pending specs added](#pending-specs-added).

## Test infrastructure findings (read this first)

Two infrastructure facts materially affect how much of this work is actually
gated by CI today:

1. **The CLI / runner `.mjs` suites are not run by `yarn test` or CI.**
   `jest.config.js` sets `testMatch: ['<rootDir>/tests/**/*.test.ts']`, and the
   only test script is `"test": "jest"`. The Node-native suites
   (`tests/cli-runner.test.mjs`, `tests/cli-protocol.test.mjs`,
   `tests/cli-direct-launch.test.mjs`, `tests/cli-launcher.test.mjs`, plus the
   auth/credentials/new-ticket/update CLI suites and
   `tests/lib/helpers/cli-versioning.test.mjs`) match `*.test.mjs`, **not**
   `*.test.ts`, so jest never collects them. There is no `node --test`
   invocation anywhere in `package.json` or `.github/workflows/quality-gates.yml`.
   They pass when run manually (`node --test tests/cli-runner.test.mjs`), but they
   are **not a gate**. Much of the launch pipeline (runner claim→launch,
   `buildLaunchArgs`, `complete-execution-launch` behavior, device fingerprint,
   protocol flag wiring) lives only in these ungated suites.
   - **Recommendation:** add a `test:cli` script (`node --test "tests/**/*.test.mjs"`)
     and run it in the Quality Gates workflow alongside `yarn test`. Phases 4, 7,
     and 8 of the plan all add `.mjs` coverage that will otherwise never run in CI.

2. **`tests/supabase/*.test.ts` require a live local Supabase.**
   `execution-requests-idempotency.test.ts` and the trigger tests connect to
   `127.0.0.1:54321` / `54322`. With no stack running they fail with
   `TypeError: fetch failed` rather than skipping. They are matched by jest's
   `testMatch`, so a developer running `yarn test` without `supabase start` gets
   red suites that are environmental, not real failures. Phase 3's relaunch /
   double-click-race tests are best written here (they need the real partial
   unique index), so this gap compounds: those tests will only run where a stack
   is up. Consider gating these behind an env probe that `it.skip`s when the
   stack is unreachable, so the file is honest about being integration-only.

## Per-phase coverage matrix

Legend: **Covered** = an existing test asserts this. **Changes** = an existing
test asserts the *current* behavior and must be updated when the phase lands.
**Gap** = no test today; a pending spec was added (or is recommended).

### Phase 1 — Unify attach objective selection

| Verification criterion (plan) | Status | Test |
|---|---|---|
| Selection order prefers oldest `submitted`/`draft` by `position` then `created_at` | Covered (current order) / **Changes** for `launching`-first | `tests/lib/objectives.test.ts` (`markSubmittedObjectiveExecuting`, `promoteNextFutureDraft`) |
| Future-objective promotion on launch | Covered | `tests/lib/objectives.test.ts` `promoteNextFutureDraft`, `computePromotedObjectivePositions` |
| Assigned-agent carryover to the new seeded draft | **Gap** (logic exists at `lib/objectives.ts:629`, untested) | pending spec |
| Idempotent re-attach to an existing `executing` objective | **Gap** (logic at `lib/objectives.ts:547-572`, untested) | pending spec |
| Model resolved from attach-time metadata matches across REST/connect/spawn/MCP | Partially covered for REST (`stores agent_identifier from the objective assignment, not the attach payload`); **Gap** for connect/spawn/MCP parity | pending spec |
| MCP attach uses the same selection as REST | **Gap** — MCP handler (`supabase/functions/mcp/handlers/attach.ts:89-205`) is a separate reimplementation with **no test**; it also orders by `created_at desc` (newest), the opposite of REST's `position asc, created_at asc` | pending spec (documents the divergence the phase removes) |

### Phase 2 — Replace new `submitted` writes with `launching`

| Verification criterion | Status | Test |
|---|---|---|
| `createExecutionRequest` writes `launching` (not `submitted`) | **Changes** — current tests explicitly assert `submitted` | `tests/lib/overlord/execution-requests.test.ts` (`promotes a draft objective to submitted...`, `sets auto_advanced_at...`) |
| `resolveObjectiveForExecution` treats `launching` as launchable | **Gap** — currently filters `['draft','submitted']` (`execution-requests.ts:92,104`) | pending spec |
| Readers/UI render `launching` with the same affordances as `submitted` | **Gap** — no component tests for `TicketPanelContent`/`TicketObjectivesSection`/`DraftObjective` state rendering | recommended (component) |
| Existing `submitted` fixtures still attach/render | Covered | `tests/lib/objectives.test.ts`, `execution-requests.test.ts` (`returns the existing row...` uses `state: 'submitted'`) |

### Phase 3 — Prevent duplicate manual runs and support relaunch

| Verification criterion | Status | Test |
|---|---|---|
| Manual `idempotency_key` stays non-deterministic | Covered (format, mocked UUID) | `execution-requests.test.ts` `generates a manual idempotency key...` |
| Duplicate manual Run returns the same active request + wake-up event | **Gap** — no active-by-`objective_id` pre-check exists yet | pending spec |
| Insert race resolves on the **partial `objective_id`** index (not the idempotency key) | **Gap** | pending spec (integration; needs the new index) |
| Click after `failed`/`launched` inserts a NEW request (relaunch) | **Gap** | pending spec |
| Idempotency collision currently returns the existing row | Covered (current `23505`→lookup-by-key path) / **Changes** | `execution-requests.test.ts` `returns the existing row when idempotency collides`; integration `execution-requests-idempotency.test.ts` |
| Re-emitted `execution_requested` causes a queued row to be claimed | **Gap** — runner reacts to events; `runOnce`/`launchClaimedRequest` tested but not the re-emit→reclaim path | pending spec (`.mjs`, recommended) |

### Phase 4 — Make runner success attach-aware

| Verification criterion | Status | Test |
|---|---|---|
| First post-spawn call sets `launching` (not `launched`) | **Changes** — runner test asserts `complete-execution-launch` is called on spawn; route test asserts it writes `status: 'launched'` | `tests/cli-runner.test.mjs` (`launchClaimedRequest ... marks the request launched on spawn`); `tests/app/api/protocol/complete-execution-launch/route.test.ts` |
| Attach marks the request `launched` only after session creation | **Gap** — REST attach (`lib/overlord/protocol-attach.ts`) and MCP attach have no test that links session creation → request `launched` | pending spec |
| Matching rule: prefer `executionRequestId` metadata, fall back to active `launching`/`claimed` by `objective_id` | **Gap** | pending spec |
| Non-runner manual launch (no request) is a no-op; attach still succeeds | **Gap** | pending spec |
| Stale `launching` rows become reclaimable after timeout (watchdog) | Partially — claim route reclaims expired **`claimed`** leases (`reclaims an expired claimed request...`); **Gap** for `launching` | `tests/app/api/protocol/claim-execution/route.test.ts` + pending spec |
| Failure path leaves the row `failed`/retryable, not `launched` | Covered (spawn error → `fail-execution-launch`) | `cli-runner.test.mjs` `marks failure when the child emits error`; `fail-execution-launch/route.test.ts` |

### Phase 5 — Carry selected execution target everywhere

| Verification criterion | Status | Test |
|---|---|---|
| Selected target survives outside `ProjectSettingsProvider`; Run pins to it | **Gap** — no test for `AgentSplitButton` / `useWorkspacePreference` / selected-target hook | recommended (component) |
| Key/field rename `SELECTED_DEVICE_KEY`→`SELECTED_EXECUTION_TARGET_KEY` etc. | **Gap** | recommended (component) |

### Phase 6 — Quick Task Bar uses the same Run builder

| Verification criterion | Status | Test |
|---|---|---|
| Quick Task Bar `cmd+enter` and ticket Run produce the same `requestTicketObjectiveExecutionAction` payload | **Gap** — no shared-builder test; `QuickTaskBar` and `AgentSplitButton` untested for payload parity | recommended (extract `resolveExecutionLaunchInput` then golden-compare) |

### Phase 7 — Remove legacy device terminology

| Verification criterion | Status | Test |
|---|---|---|
| API accepts `targetExecutionTargetId` (not `targetDeviceId`) | **Changes** — schema still has `targetDeviceId` (`validation.ts:494`), route maps it (`request-execution/route.ts:45`) | `tests/cli-protocol.test.mjs` `request-execution posts local launch payload...` |
| CLI flag `--target-execution-target-id` (not `--target-device-id`) | **Gap** | pending spec (`.mjs`, recommended) |
| `--device-fingerprint` → `--execution-target-fingerprint` | **Changes** — current test posts `--device-fingerprint` | `tests/cli-protocol.test.mjs` `claim-execution posts device fingerprint from flag`; `tests/cli-runner.test.mjs` `readOrCreateDeviceFingerprint*` |
| Local MCP shim arg `target_execution_target_id` | **Gap** | recommended (catalog/shim) |
| No launch-surface `device` hits remain (`rg` guard) | **Gap** — could be a meta-test/lint | recommended |

### Phase 8 — Centralize launch flag parsing / command construction

| Verification criterion | Status | Test |
|---|---|---|
| `buildLaunchArgs` maps local/ssh/feed-post claims | Covered (ungated `.mjs`) | `tests/cli-runner.test.mjs` `buildLaunchArgs ...` (3 cases) |
| App command preview matches CLI-parsed launch input (golden) | Partially — app side covered | `tests/lib/overlord/launch-commands.test.ts`; **Gap**: no cross-surface golden comparing app preview vs CLI parse |
| Shared schema validates `ovld launch`/`runner`/`request-execution`/app preview | **Gap** (module doesn't exist yet) | recommended once `_cli/launch-args.mjs` exists |

### Phase 9 — Fail safely on target config load errors

| Verification criterion | Status | Test |
|---|---|---|
| Target config DB **error** → claim failure / skip candidate, no fallback flags | **Gap** — `resolveTargetAgentLaunch` has no error-discriminant today | pending spec |
| No config (`not_configured`) → still falls back to request flags | Covered | `tests/app/api/protocol/claim-execution/route.test.ts` `falls back to launch_params flags when the target has no config` |
| Target config present → overrides request flags/preCommand | Covered | same file, `overrides launch_params flags/preCommand with the claiming target config` |

### Phase 10 — Tighten execution-request statuses

| Verification criterion | Status | Test |
|---|---|---|
| Active status set is exactly `queued/claimed/launching/launched/failed` | **Gap** — no test asserts the constraint set | recommended (migration/constraint test) |
| `expired`/`cancelled` rows migrate to `failed` with original status preserved in `last_error` | **Gap** | recommended (migration test) |
| Generated types succeed; no docs reference `cancelled`/`expired` | **Gap** | recommended (doc/lint guard) |

## Pending specs added

`tests/lib/overlord/launch-pipeline-remediation.planned.test.ts` — a jest file of
`describe.skip(...)` blocks, one per phase, encoding the plan's verification
criteria as concrete assertions against the existing function/route signatures.
They are written to **compile cleanly** (loose mock typing, same patterns as the
neighboring suites) but stay skipped so CI stays green while the behavior is
unbuilt.

**Activation guide:** as each phase is implemented, remove the `.skip` from that
phase's `describe` (and adjust the few "Changes" assertions called out above in
`execution-requests.test.ts`, `objectives.test.ts`,
`complete-execution-launch/route.test.ts`, `cli-runner.test.mjs`, and
`cli-protocol.test.mjs`). The pending specs intentionally mirror the existing
mock builders so they can be lifted into the real suites with minimal edits.

Specs that genuinely need a live Supabase (Phase 3 partial-index race / relaunch)
are stubbed in the pending file with a pointer to add the real integration
version in `tests/supabase/execution-requests-idempotency.test.ts`, because the
partial unique index cannot be exercised by the in-memory `from()` mocks.

## Summary of recommended (non-pending) follow-ups

1. **Wire `.mjs` suites into CI** (`test:cli` + Quality Gates step). Highest-value
   gap: today the runner/CLI launch path is not gated at all.
2. **Make `tests/supabase/*` skip gracefully** when no local stack is reachable.
3. Add component-level coverage for Phases 5 and 6 (selected-target persistence
   and Quick Task Bar ↔ Run payload parity) once the shared client helper exists.
4. Add migration/constraint tests for Phase 10's status set and the
   `expired`/`cancelled` → `failed` data migration.
