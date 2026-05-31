# Agent Launch Pipeline Remediation Plan

_Created: 2026-05-31 for ticket `1:1288`, objective `09cf4d00-3d5d-47d5-852c-4383ab182b8e`_

## Goal

Turn the launch-pipeline review findings into an implementation plan that makes manual Run, Quick Task Bar Run, auto-advance, runner claim/launch, REST attach, and hosted MCP attach follow one lifecycle with the same target/config semantics.

## Target Lifecycle

Use this as the desired end state for queued agent execution:

1. A launch request resolves the objective, agent/model/thinking, target, workspace, flags, pre-command, and custom-agent command through one shared request builder.
2. The objective moves from `draft` to `launching`. The old `submitted` objective state remains accepted by readers and attach for legacy rows, but new launch requests do not write it.
3. `execution_requests` has one active row per objective across `queued`, `claimed`, and `launching`.
4. Clicking Run for an objective with an active request returns/reuses that request and emits a runner wake-up event instead of inserting a duplicate row.
5. A runner claims the row, starts the terminal/agent launch, and moves the request to `launching`, not `launched`.
6. The agent calls attach. Attach creates the `agent_sessions` row, moves the objective to `executing`, and only then marks the matching execution request `launched` with `launched_session_id`.
7. If launch starts but attach never happens, a stale `launching` request becomes reclaimable/retriable instead of being silently stuck as successful.

## Phase 1: Unify Attach Objective Selection

Addresses finding 1.

Implement the objective transition once and call it from both REST attach and hosted MCP attach.

Preferred implementation:

- Add a Supabase migration with an RPC such as `public.claim_next_objective_for_execution(...)`.
- Inside the RPC, select the next objective in this order:
  - `launching`, ordered by `position`, then `created_at`
  - legacy `submitted`, ordered by `position`, then `created_at`
  - fallback `draft`, ordered by `position`, then `created_at`
  - re-attach fallback `executing` / `pending_delivery`, ordered by `position`, then `created_at`
- When moving a launchable objective to `executing`, keep current REST behavior:
  - set `agent_identifier`, `model_identifier`, and `completed_at = null`
  - promote the next `future` objective to `draft`
  - create one blank `draft` only if no future objective was promoted and no draft exists
  - seed the new draft's `assigned_agent` from the executing objective
- Update `lib/objectives.ts` so `markSubmittedObjectiveExecuting` becomes a compatibility wrapper around the shared transition. Prefer a new internal name like `markLaunchObjectiveExecuting`, but keep the old export until call sites are migrated.
- Replace the duplicated objective-selection block in `supabase/functions/mcp/handlers/attach.ts` with the same RPC call.

Verification:

- Add parity tests for REST attach and MCP attach covering:
  - oldest `launching`/legacy `submitted` objective wins by `position`, then `created_at`
  - future objective promotion
  - assigned-agent carryover to the new draft
  - idempotent re-attach to an existing `executing` objective

## Phase 2: Replace New `submitted` Writes With `launching`

Addresses finding 3 and partially finding 9.

Use objective state `launching` as the pre-attach state. Treat it identically to `submitted` in the UI and context readers for now.

Implementation steps:

- Add `launching` to the `objective_state` enum.
- Update `createExecutionRequest` in `lib/overlord/execution-requests.ts` to move `draft -> launching` for new launch requests.
- Keep `submitDraftObjective` / `discuss-objective` writing `submitted` for legacy/discussion semantics until that state is repurposed later.
- Update readers that currently look for `submitted` to also include `launching`, preferring `launching` first:
  - `lib/objectives.ts`
  - `lib/overlord/protocol-context-objective.ts`
  - `lib/overlord/protocol-load-context.ts`
  - `lib/actions/tickets/internals.ts`
  - `apps/web/components/features/TicketPanelContent.tsx`
  - `apps/web/components/features/TicketObjectivesSection.tsx`
  - `apps/web/components/features/DraftObjective.tsx`
- Update docs and diagrams that describe `draft -> submitted -> attach` so new queued launch docs say `draft -> launching -> executing`.

Verification:

- Unit tests for `createExecutionRequest` should expect `launching`, not `submitted`.
- UI tests or focused component tests should verify `launching` renders with the same affordances as the old `submitted` state.
- Existing `submitted` fixtures should still attach and render.

## Phase 3: Prevent Duplicate Manual Runs And Support Relaunch

Addresses finding 2.

Manual Run should be idempotent for an objective while a launch is active, but a repeated click must wake/relaunch the already queued work.

Implementation steps:

- Define active request statuses as `queued`, `claimed`, and `launching`.
- Add a partial unique index on `execution_requests(objective_id)` for active statuses.
- Change manual-run idempotency to be deterministic at the objective level while active. Do not include a random UUID for `manual_run`.
- Before inserting a manual request, query for an active request on the same `objective_id`.
  - If one exists, return it with a flag such as `reused: true`.
  - Insert a new `execution_requested` ticket event with payload `{ reused_execution_request: true }` so Desktop's runner listener wakes up.
  - If the existing row is stale `claimed` or stale `launching`, reset it to `queued` before emitting the event.
- Do not reuse `failed` or `launched` rows. A new click after a real failure should create a new request.
- Update `requestTicketObjectiveExecutionAction` and the protocol route response to expose whether the request was reused.
- Keep the user-facing behavior simple: the Run button still says queueing/launching; repeated clicks do not create duplicate agents.

Verification:

- Unit test duplicate manual Run returns the same request and writes a wake-up event.
- API test double-click / two-tab insertion race hits the unique index and returns the existing active row.
- Runner test verifies a re-emitted `execution_requested` event causes a queued row to be claimed.

## Phase 4: Make Runner Success Attach-Aware

Addresses finding 3.

`complete-execution-launch` should no longer mean "work has started"; attach is the source of truth for successful launch.

Implementation steps:

- Keep the `complete-execution-launch` protocol operation as a compatibility alias for now, but change its behavior to mark the request `launching`.
- Add or reuse a launch-session identifier:
  - Runner generates `OVERLORD_EXECUTION_REQUEST_ID` and `OVERLORD_LAUNCH_SESSION_ID` before starting `ovld launch`.
  - `ovld launch` accepts/preserves `--launch-session-id` or env `OVERLORD_LAUNCH_SESSION_ID` instead of always generating a hidden ID.
  - `ovld protocol attach` automatically includes `executionRequestId` and `launchSessionId` from env in metadata.
- In REST attach and hosted MCP attach, after creating the `agent_sessions` row, update the matching execution request to:
  - `status = 'launched'`
  - `launched_session_id = session.id`
  - `launched_at = now()`
  - `lease_expires_at = null`
- Update claim logic so stale `launching` rows become claimable again after a bounded timeout.
- Add a ticket event when a `launching` row times out or is reset for relaunch, so the UI can explain why Run is available again.
- Update Desktop `useExecutionRequestLauncher` and CLI `runner.mjs` so terminal opener success marks `launching`, not `launched`.

Verification:

- CLI runner tests should expect the first post-spawn call to set `launching`.
- Attach route tests should assert the request becomes `launched` only after session creation.
- Add stale `launching` claim tests.
- Add a failure test where context fetch or agent binary startup fails and the row becomes `failed` or remains retryable, not `launched`.

## Phase 5: Carry Selected Execution Target Everywhere

Addresses finding 4.

Make selected target lookup independent of `ProjectSettingsProvider`.

Implementation steps:

- Rename the local storage key and context fields from device-oriented names to execution-target names:
  - `SELECTED_DEVICE_KEY` -> `SELECTED_EXECUTION_TARGET_KEY`
  - `selectedDeviceId` -> `selectedExecutionTargetId`
  - `setSelectedDevice` -> `setSelectedExecutionTarget`
- Provide a shared hook, e.g. `useSelectedExecutionTargetPreference(projectId)`, that works inside and outside `ProjectSettingsProvider`.
- Have `useWorkspacePreference` return `selectedExecutionTargetId`.
- Update `AgentSplitButton` to use the shared hook instead of reading `projectSettingsCtx?.selectedDeviceId`.
- If only the target ID is available outside the provider, pass `targetExecutionTargetId` and let `claim-execution` resolve the primary resource directory for that target.

Verification:

- Component test or manual repro from side panel: choose execution target on project page, open the same ticket outside provider, click Run, and confirm the request is pinned to the chosen target.

## Phase 6: Make Quick Task Bar Use The Same Run Builder

Addresses finding 5.

Quick Task Bar `cmd+enter` should be equivalent to clicking Run on the created ticket.

Implementation steps:

- Extract the request-building branch from `AgentSplitButton` into a shared client helper/hook, for example:
  - `resolveExecutionLaunchInput(...)`
  - `queueObjectiveExecution(...)`
- Include these fields in the shared builder:
  - built-in/custom agent identifier
  - resolved custom-agent command
  - model and thinking
  - flags and pre-command
  - workspace/SSH fields
  - selected execution target
  - objective ID
- Use the helper from both `AgentSplitButton` and `QuickTaskBar`.
- Ensure Quick Task Bar waits for assignment/custom-agent resolution needed by the launch request before queueing.

Verification:

- Test both surfaces produce the same `requestTicketObjectiveExecutionAction` payload for the same selected agent/target/config.
- Manual test `cmd+enter` from Quick Task Bar with a non-default execution target and per-target agent config.

## Phase 7: Remove Legacy Device Terminology From Launch Surfaces

Addresses finding 6.

Make execution target the only launch-surface term. Do not keep deprecated public aliases for this cleanup pass.

Implementation steps:

- Replace request-execution API field:
  - remove `targetDeviceId`
  - add `targetExecutionTargetId`
- Replace CLI flag:
  - remove `--target-device-id`
  - add `--target-execution-target-id`
- Replace local MCP shim args:
  - remove `target_device_id`
  - add `target_execution_target_id`
- Rename public/user-facing "device" labels where they represent execution targets:
  - `ProjectExecutionWorkspaceSelector.tsx`
  - execution-target settings pages
  - runner/workflow docs
  - plugin reference docs
  - CLI README/help
- Keep true low-level fingerprint concepts only where unavoidable, but prefer `execution-target fingerprint` in public help and docs. If time allows, rename CLI flags like `--device-fingerprint` to `--execution-target-fingerprint`; otherwise document that as a follow-up because it touches runner identity, project-resource, and setup commands broadly.
- Regenerate plugin output if source templates under `plugins/_source` change.

Verification:

- `rg "target-device|targetDevice|selectedDevice|Execution device| device"` should have no launch-surface hits except deliberate low-level fingerprint compatibility notes.
- CLI protocol tests should cover `--target-execution-target-id`.
- Local MCP shim tests/catalog checks should cover `target_execution_target_id`.

## Phase 8: Centralize Launch Flag Parsing And Command Construction

Addresses finding 7.

Make adding a launch flag a one-file change plus tests.

Implementation steps:

- Add CLI shared modules such as:
  - `packages/overlord-cli/bin/_cli/args.mjs`
  - `packages/overlord-cli/bin/_cli/launch-args.mjs`
- Move repeated parsing helpers into the shared module:
  - `parseFlags`
  - repeated `--flag`
  - boolean/string coercion
  - environment fallback helpers
- Move runner launch argument construction out of `runner.mjs` into the shared launch module.
- Use the same launch argument schema to validate:
  - `ovld launch`
  - `ovld runner`
  - `ovld protocol request-execution`
  - app command previews in `lib/overlord/launch-commands.ts`
- Add golden tests for agent/model/thinking/flag/pre-command/custom-agent/SSH combinations.

Verification:

- Existing CLI protocol, runner, direct launch, and launch-command tests pass.
- Add snapshot/golden tests comparing app-rendered commands and CLI-parsed launch inputs for representative agents.

## Phase 9: Fail Safely On Target Config Load Errors

Addresses finding 8.

Do not silently fall back to request-captured flags when target config lookup fails.

Implementation steps:

- Change `resolveTargetAgentLaunch` to return a discriminated result:
  - `{ kind: 'configured', flags, preCommand }`
  - `{ kind: 'not_configured' }`
  - `{ kind: 'error', error }`
- In `claim-execution`, treat `error` as a claim failure before returning launch payload.
- Write a ticket event and structured log/Sentry context for config lookup errors.
- Keep fallback to request-captured flags only for `not_configured`.
- Prefer resolving target config before the atomic claim update so a transient config failure does not leave a request leased without a launch payload.

Verification:

- Claim route test for DB error returns an error or skips the candidate without fallback flags.
- Claim route test for no config still falls back to request flags.

## Phase 10: Tighten Execution Request Statuses

Addresses finding 9.

Use only statuses that the runtime writes.

Final runtime set:

- `queued`
- `claimed`
- `launching`
- `launched`
- `failed`

Implementation steps:

- Remove `cancelled` and `expired` from validation and docs.
- Add a migration that maps any existing `expired` rows to `failed` with `last_error = 'Execution request expired.'` and any `cancelled` rows to `failed` or a future explicit cancellation implementation.
- Replace the DB check constraint with the final runtime set.
- Update generated types after migration.
- Update docs in `apps/web/app/docs/workflow/agent-execution/page.tsx`, protocol docs, CLI help, and plugin references.

Verification:

- Type generation succeeds.
- No tests or docs reference `cancelled` / `expired` as active execution-request statuses.

## Cross-Surface Checklist

Because these changes touch connector and protocol surfaces, update all affected surfaces in the same implementation pass:

- API routes under `apps/web/app/api/protocol/*`
- CLI protocol and runner in `packages/overlord-cli/bin/_cli/*`
- Local MCP shims in `plugins/_source/agents/overlord/scripts/overlord-mcp.mjs`, rendered plugin copies, and Antigravity shim if applicable
- Hosted MCP handler and tool definitions under `supabase/functions/mcp/*`
- Agent plugin skills under `plugins/_source`, rendered `plugins/*`, and `packages/overlord-cli/plugins/*`
- `ai/guidence/CONNECTOR_SURFACES.md`
- `.claude/skills/drift-review/SKILL.md` only if surface categories or naming conventions change
- User-facing docs under `apps/web/app/docs`, `docs/public`, and `packages/overlord-cli/README.md`

## Suggested Implementation Order

1. Add migrations for objective `launching`, execution-request active uniqueness, and status cleanup.
2. Update `createExecutionRequest`, duplicate/relaunch handling, and tests.
3. Update REST/MCP attach parity and attach-aware request completion.
4. Update CLI/Desktop runner behavior to set `launching` and pass request/session metadata.
5. Update UI shared Run builder, selected target hook, and Quick Task Bar.
6. Remove legacy device naming across protocol/CLI/MCP/docs.
7. Centralize launch parsing/command construction.
8. Run drift review and update connector-surface docs.

## Definition Of Done

- Manual Run, Quick Task Bar `cmd+enter`, protocol `request-execution`, and auto-advance enqueue through one shared lifecycle.
- Double-clicking Run does not create a second active execution request.
- Clicking Run again for an already queued/stale active request wakes the runner and reuses/requeues that request.
- No execution request becomes `launched` until an agent session is created by attach.
- REST attach and hosted MCP attach execute the same objective in the same order.
- Selected execution target is preserved from all UI launch surfaces.
- Public launch/protocol surfaces use execution-target naming.
- Claim-time target config errors do not silently fall back to request flags.
- The only active execution-request statuses are `queued`, `claimed`, `launching`, `launched`, and `failed`.
