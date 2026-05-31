# Agent Launch Pipeline Review

_Conducted: 2026-05-31 for ticket `1:1288`_

## Scope

Reviewed the agent launch pipeline across:

- Ticket and objective launch entry points in the web UI and server actions.
- Agent, model, thinking, flag, pre-command, custom-agent, execution-target, and workspace selection.
- Durable runner queue endpoints and the CLI/Desktop runner consumers.
- Agent launch command composition in the web app and CLI package.
- Attach/connect/spawn/deliver lifecycle paths that carry tickets and objectives through execution.
- Relevant schema, migrations, and tests for execution requests and execution targets.

## Flow Map

### 1. Launch Intent Enters The System

Manual Run from ticket detail:

1. `AgentSplitButton` resolves the selected built-in or custom agent, model/thinking choice, target-specific workspace, flags, pre-command, and selected execution target.
2. It calls `requestTicketObjectiveExecutionAction`.
3. The server action checks ticket access and calls `createExecutionRequest` with `requestedFrom: 'manual_run'`, `launchMode: 'run'`, launch params, and optional `targetExecutionTargetId`.

Quick Task Bar instant launch:

1. `QuickTaskBar` creates a ticket/objective, starts assignment/title generation in a background task, then optionally calls `requestTicketObjectiveExecutionAction`.
2. It passes agent/model/thinking and workspace values, but does not pass selected execution target, flags, pre-command, or custom-agent command data.

Auto-advance after delivery:

1. `deliver` marks the current objective complete and closes the session synchronously.
2. `scheduleQueuedObjectiveAfterDeliver` finds the next draft objective by position.
3. If `auto_advance !== false`, it calls `createExecutionRequest` with `requestedFrom: 'auto_advance'` and deterministic idempotency.
4. If approval is required, it writes an `awaiting_approval` event and notification instead of queueing.

CLI protocol request:

1. `ovld protocol request-execution` parses flags and posts to `/api/protocol/request-execution`.
2. The route resolves human ticket IDs to UUIDs, normalizes runner terminal profile, and calls `createExecutionRequest`.

### 2. Execution Request Creation

`createExecutionRequest`:

1. Loads the ticket by UUID and organization, rejects `for_human` tickets.
2. Resolves an explicit objective or the first launchable `draft`/`submitted` objective by `position`, then `created_at`.
3. Resolves agent/model/thinking from `objective.assigned_agent` first, then caller inputs.
4. Preserves custom agent IDs when a resolved custom command is present.
5. Moves draft objectives to `submitted` before inserting the request.
6. Inserts `execution_requests` with launch params, target fields, status `queued`, and an idempotency key.
7. Writes an `execution_requested` ticket event.

### 3. Runner Claim And Launch

Claiming:

1. Desktop `useExecutionRequestLauncher` or CLI `ovld runner` posts `claim-execution` with a device fingerprint.
2. The route upserts the caller as an execution target.
3. It scans up to 25 queued/expired-lease claimed requests for the user/org.
4. It skips requests pinned to a different execution target.
5. It resolves working directory from launch params, target resource, or primary resource directory.
6. It atomically updates one row from `queued` or stale `claimed` to `claimed`, increments `attempt_count`, and returns launch payload.
7. Per-target `user_execution_targets.agent_flags` override request-captured flags/pre-command when present.

CLI runner:

1. Builds `ovld launch <agent> --ticket-id <id> ...`.
2. Spawns it directly or through a configured terminal/tmux opener.
3. Marks the request launched on child spawn for direct launches, or after terminal opener success.
4. Marks failed only if process spawn/opener fails before successful completion.

Desktop runner:

1. Claims in response to `execution_requested` realtime events and an 8-second poll.
2. Calls Electron `launchAgent`.
3. Marks the request launched after the Electron launch call resolves, or failed if it throws.

### 4. Agent Starts And Attaches

`ovld launch`:

1. Resolves auth and organization.
2. Fetches `/api/protocol/context/[ticketId]` to get the prompt and working-directory header.
3. Starts the chosen agent binary with agent-specific context/flag formatting.
4. The prompt instructs the agent to call `ovld protocol attach` before work.

Attach:

1. `/api/protocol/attach` calls `runAttachProtocol`.
2. It marks the first submitted/draft objective executing through `markSubmittedObjectiveExecuting`.
3. It detaches prior active sessions for that objective.
4. It inserts a new `agent_sessions` row.
5. It moves the ticket to the preferred execute status, writes attach/reopen events, and returns context, history, artifacts, objectives, attachments, shared state, and pending checkpoints.

Lifecycle completion:

1. Agent calls `update`, `ask`, `request-approval-gate`, `record-work`, etc. during execution.
2. Agent calls `deliver`.
3. `deliver` writes the delivery event, checkpoint/file-change data, marks objective complete, closes session, queues or blocks the next objective, and moves the ticket to review if no next objective was queued.

## Flow Variations

- Web ticket detail launch is the richest path: selected execution target, effective workspace, flags, pre-command, custom agents, model, and thinking can all flow into the request.
- Quick Task Bar launch is a narrower path: it omits selected execution target and launch flag/pre-command/custom-agent handling.
- Auto-advance intentionally omits flags, pre-command, model, and target from the request input and relies on objective assignment plus claim-time target config.
- CLI `request-execution` uses explicit flags and legacy `target-device-id` naming even though the DB now uses execution targets.
- Desktop and CLI runners share the same claim endpoints but differ in when they mark a launch as successful.
- REST attach uses shared TypeScript logic. Hosted MCP attach reimplements that lifecycle in Deno and currently differs in objective ordering and queue promotion behavior.
- `connect` is a lightweight attach variant with no full context return.
- `spawn` creates a ticket and immediately creates a session, bypassing the durable runner queue.

## Findings

### High: Hosted MCP attach can execute objectives out of queue order and diverges from REST attach

**Location:** `supabase/functions/mcp/handlers/attach.ts:89`, `supabase/functions/mcp/handlers/attach.ts:101`, `supabase/functions/mcp/handlers/attach.ts:160`; compare with `lib/objectives.ts:512` and `lib/objectives.ts:599`

The REST attach path delegates objective state transitions to `markSubmittedObjectiveExecuting`, which selects by `position` then `created_at`, promotes the next future objective into the draft slot, and seeds the next draft with the executing objective's `assigned_agent`.

The MCP attach handler reimplements this logic by ordering submitted and draft objectives by newest `created_at`, inserting a blank draft unconditionally, and never calling the future-objective promotion logic. That can cause MCP-launched agents to execute the newest objective instead of the next queued objective, skip or strand future objectives, and lose the assigned-agent continuity that the REST path preserves.

**Impact:** Sequential objective behavior varies by connector surface. This is especially risky for MCP-capable agents because ticket/objective lifecycle order is core product behavior.

**Recommendation:** Remove or sharply reduce the duplicate Deno implementation. If shared TypeScript cannot be imported into the edge function, mirror the REST semantics exactly in a focused MCP helper and add parity tests covering objective order, future promotion, assigned-agent carryover, and re-attach fallback.

### High: Manual runs can queue duplicate executions for the same objective

**Location:** `lib/overlord/execution-requests.ts:147`, `lib/overlord/execution-requests.ts:166`, `tests/lib/overlord/execution-requests.test.ts:281`

Auto-advance uses deterministic idempotency (`auto_advance:<objectiveId>`), but manual requests without an explicit key generate `manual_run:<objectiveId>:<randomUUID>`. There is no check for an existing queued/claimed/launched request for the same objective before inserting another request.

**Impact:** Double-clicks, two browser tabs, or a UI retry can queue multiple agents for the same objective. The second attach will disconnect the first active session for that objective, so duplicate queue rows can cause confusing session takeovers and lost work context.

**Recommendation:** Make manual-run idempotency deterministic for the objective/agent/target while the objective is launchable, or add a database/server-side guard that rejects or returns an existing active execution request for the same objective.

### High: Runner success is recorded before an agent has actually attached

**Location:** `packages/overlord-cli/bin/_cli/runner.mjs:309`, `packages/overlord-cli/bin/_cli/runner.mjs:327`, `packages/overlord-cli/bin/_cli/launcher.mjs:435`

The CLI runner marks direct launches `launched` on child process spawn. At that point `ovld launch` may still fail resolving auth, fetching context, changing directories, starting the agent binary, or reaching the agent's first `attach`. Terminal-profile launches are marked launched when the terminal opener exits successfully, not when the nested agent attaches.

**Impact:** A request can leave the durable queue as `launched` even though no session exists and no objective work began. The objective has already been moved to `submitted`, so this becomes a silent stuck state rather than a retryable launch failure.

**Recommendation:** Introduce a `launching` state and complete the request when the expected `OVERLORD_LAUNCH_SESSION_ID`/ticket attach is observed, or have the launcher report failure/success after context fetch and agent command startup. At minimum, add a stale launched-without-session watchdog/event so users can retry.

### Medium: Selected execution target is lost outside the project settings context

**Location:** `apps/web/components/features/AgentSplitButton.tsx:308`, `apps/web/components/features/projects/useWorkspacePreference.ts:18`, `apps/web/components/features/projects/ProjectSettingsContext.tsx:105`

`AgentSplitButton` only passes `targetExecutionTargetId` from `useProjectSettings()`. `useWorkspacePreference` explicitly supports panels rendered outside `ProjectSettingsProvider`, but that fallback returns workspace data only, not `selectedDeviceId`. In those fallback render locations, manual Run queues an unpinned request that any compatible runner can claim.

**Impact:** A user can select a specific execution device in the project page and still have a side-panel launch go to a different runner. This undermines the execution target selector and makes launch behavior location-dependent.

**Recommendation:** Move selected execution target lookup into a shared hook that works both inside and outside `ProjectSettingsProvider`, or include the selected device in `useWorkspacePreference`'s fallback return value.

### Medium: Quick Task Bar launch omits target and launch-config data used by ticket detail Run

**Location:** `apps/web/components/features/QuickTaskBar.tsx:382`

The instant-launch path sends agent/model/thinking and workspace data but omits `targetExecutionTargetId`, custom-agent command resolution, and request-time flags/pre-command. The ticket detail Run path handles these in `AgentSplitButton`.

**Impact:** Two UI paths that both appear to "Run" a task can launch with different agent configuration and target selection semantics. Per-target config may still be applied at claim time, but target pinning and custom-agent behavior are inconsistent.

**Recommendation:** Extract a shared `buildExecutionRequestInput` helper for UI launch surfaces. Use it from both `AgentSplitButton` and `QuickTaskBar`, with explicit decisions for any intentionally unsupported Quick Task Bar behavior.

### Medium: Execution-target naming still exposes legacy device terminology

**Location:** `lib/overlord/validation.ts:493`, `apps/web/app/api/protocol/request-execution/route.ts:45`, `packages/overlord-cli/bin/_cli/protocol.mjs:1995`, `supabase/migrations/20260523150000_drop_devices_table.sql:1`

The database and product model migrated from devices to execution targets, but the protocol request schema and CLI still accept/send `targetDeviceId` / `--target-device-id`, which is mapped to `target_execution_target_id`.

**Impact:** The public API/CLI surface teaches an outdated model and makes it easy to pass the wrong ID type. It also increases future migration cost because "device" survives in launch protocol contracts after the devices table was dropped.

**Recommendation:** Add `targetExecutionTargetId` / `--target-execution-target-id` as the canonical field and keep `targetDeviceId` / `--target-device-id` as deprecated aliases with docs migration.

### Medium: Launch flag parsing and command construction are duplicated across surfaces

**Location:** `packages/overlord-cli/bin/_cli/protocol.mjs:15`, `packages/overlord-cli/bin/_cli/runner.mjs:35`, `packages/overlord-cli/bin/_cli/launcher.mjs:338`, `packages/overlord-cli/bin/_cli/direct-launch.mjs:101`, `lib/overlord/launch-commands.ts:177`, `packages/overlord-cli/bin/_cli/runner.mjs:123`

There are several local flag parsers and repeated launch-argument builders. The app also builds display launch commands in TypeScript while the CLI independently maps model/thinking/agent-specific arguments.

**Impact:** New flags and launch behavior must be updated in multiple places, and the current implementation already has several intentionally similar but subtly different paths (`--flag`, passthrough after `--`, `--thinking`, Antigravity model omission, custom agent handling).

**Recommendation:** Centralize CLI argument parsing helpers inside the CLI package and add golden tests for launch argument composition. For app/CLI drift, maintain a single machine-readable launch contract or snapshot tests that compare app-generated commands against CLI parsing expectations.

### Low: Claim-time target config failures silently fall back to captured request flags

**Location:** `lib/overlord/target-agent-flags.ts:28`

`resolveTargetAgentLaunch` returns `null` both when no config exists and when the query errors. Claim then silently falls back to request-captured flags/pre-command.

**Impact:** A transient DB/read issue can launch an agent without target-specific safety flags or pre-command, with no event or log at the claim route.

**Recommendation:** Distinguish "no config" from "failed to load config"; log/report the failure and consider failing the claim when target config is expected but unavailable.

### Low: Unused execution-request statuses make lifecycle harder to reason about

**Location:** `lib/overlord/validation.ts:467`, `supabase/migrations/20260521113000_add_execution_requests.sql:33`

The status enum includes `launching`, `cancelled`, and `expired`, but the reviewed launch pipeline only writes `queued`, `claimed`, `launched`, and `failed`.

**Impact:** The state machine is broader than the implementation, which makes operational debugging and future changes less clear.

**Recommendation:** Either implement the missing transitions explicitly or document them as reserved states. The suggested `launching` state for attach-confirmed launch success would make this enum more useful.

## Positive Observations

- `createExecutionRequest` is the right central point for queue creation and keeps manual/API/auto-advance behavior mostly aligned.
- Claiming uses an atomic status update and lease expiry, which protects runners from claiming the same queued row concurrently.
- Per-target agent flags overriding request-captured flags at claim time is the right model for remote/local target variation.
- Auto-advance queues the next objective synchronously during delivery, which avoids losing the next run if deferred work is interrupted.
- Tests cover idempotency, target-resource working-directory fallback, and target-specific flag override behavior.

## Recommended Fix Order

1. Fix MCP attach parity with REST attach or add a shared/parity-tested objective transition helper.
2. Add duplicate manual-run protection for active execution requests per objective.
3. Make runner launch completion attach-aware, or add watchdog recovery for launched-without-session requests.
4. Normalize selected execution-target lookup so every UI launch surface can pin the same target.
5. Rename protocol/CLI target-device fields to execution-target aliases and deprecate old names.
6. DRY the launch argument/flag parsing layers after the behavioral fixes are covered by tests.

