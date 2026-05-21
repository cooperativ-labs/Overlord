# Auto-Advance Terminal Runner Plan

## Problem

The current auto-advance flow is split across two concerns:

1. The backend marks the next objective `submitted` and writes an `auto_advance` event.
2. A mounted Electron renderer observes that event and calls Electron IPC to open the next terminal.

That means auto-advance only launches the next objective when the desktop app is open and subscribed. The actual agent process does not need Electron after launch, but the transition from "objective is ready" to "terminal process starts" currently does.

Manual Run has the same architectural issue in a different shape. `DraftObjective.tsx` ultimately calls `submitTicketObjectiveAction(...)` and then `window.electronAPI.terminal.launchAgent(...)` when Electron is available. In a browser-only or CLI-only environment it falls back to copying a command.

## Recommendation

Introduce a durable **execution request** mechanism and make all launch triggers write to it. Then run one or more local runners that claim requests and execute them with the existing `ovld launch` primitive.

The browser, Electron, auto-advance scheduler, mobile app, and future remote controls should not directly spawn terminals. They should request execution. A machine that is capable of running agents should claim the request and launch the assigned agent/model in the correct working directory.

## Proposed Architecture

### 1. Add an `execution_requests` table

This table is the durable queue and idempotency boundary.

Recommended fields:

- `id uuid primary key`
- `organization_id integer not null`
- `ticket_id uuid not null`
- `objective_id uuid not null`
- `project_id uuid null`
- `requested_by uuid null`
- `requested_from text not null` such as `manual_run`, `auto_advance`, `api`, `ssh`
- `agent_identifier text not null` such as `claude`, `codex`, `cursor`, `antigravity`, `opencode`, `pi`
- `model_identifier text null`
- `thinking_level text null`
- `launch_mode text not null default 'run'`
- `target_device_id uuid null`
- `target_resource_id uuid null`
- `target_kind text not null default 'any'` such as `local`, `ssh`, `any`
- `status text not null default 'queued'` such as `queued`, `claimed`, `launching`, `launched`, `failed`, `cancelled`, `expired`
- `claimed_by_device_id uuid null`
- `claimed_at timestamptz null`
- `lease_expires_at timestamptz null`
- `launched_session_id uuid null`
- `last_error text null`
- `attempt_count integer not null default 0`
- `idempotency_key text not null`
- timestamps

Use a unique constraint on `(organization_id, idempotency_key)` so auto-advance and repeated Run clicks cannot create duplicate launches. A good auto-advance idempotency key is `auto_advance:<objective_id>`. A manual Run key can include the objective id plus a client-generated request id if repeated manual launches should be allowed.

### 2. Add protocol/API operations

Add a protocol operation that writes execution requests:

```text
POST /api/protocol/request-execution
ovld protocol request-execution
MCP tool request_execution
```

It should:

- Validate the ticket/objective belongs to the organization.
- Move a draft objective to `submitted` when needed, or verify an already-submitted objective is launchable.
- Resolve assigned agent/model/thinking from the objective first, then user defaults only when appropriate.
- Optionally resolve a target device/resource from project resources.
- Insert or return the existing execution request by idempotency key.
- Emit an `execution_requested` ticket event for UI visibility.

Add runner operations:

```text
POST /api/protocol/claim-execution
POST /api/protocol/complete-execution-launch
POST /api/protocol/fail-execution-launch
```

Expose these through CLI and MCP if remote/headless runners are first-class. At minimum, expose them through the CLI because the runner should be a CLI process.

### 3. Add `ovld runner`

Add a long-running CLI process:

```text
ovld runner start
ovld runner status
ovld runner once
```

`ovld runner start` should:

- Authenticate with normal `~/.ovld` credentials.
- Register/touch the current device via existing device APIs.
- Discover local project resources for this device.
- Subscribe to Supabase Realtime for `execution_requests`, or poll with backoff as a fallback.
- Claim only requests it can satisfy.
- Launch with the existing `ovld launch <agent> --ticket-id ...` implementation.
- Mark the launch as `launched` after the child process has started.

This runner should be installable as:

- Foreground terminal process for CLI-only users.
- macOS LaunchAgent or systemd user service for always-on workstations.
- Remote server process over SSH.
- Electron-managed helper for desktop users who want the app to keep its current behavior.

The first version can support `ovld runner once` and `ovld runner start` in the foreground before adding service installers.

### 4. Reuse `ovld launch` as the execution primitive

Do not duplicate the per-agent launch matrix in the backend. The backend cannot safely spawn processes on a user's machine and should not know local shell details.

The runner should shell into the same local primitive users already trust:

```text
ovld launch <agent> --ticket-id <ticket_id> \
  --organization-id <org_id> \
  --working-directory <path> \
  --model <model> \
  --thinking <thinking> \
  --flag <flag>
```

For SSH targets, use the already-supported remote launch shape:

```text
ovld launch <agent> --ticket-id <ticket_id> \
  --ssh-command <ssh command> \
  --remote-working-directory <remote path> \
  --server-multiplexer tmux
```

Longer term, prefer running `ovld runner start` directly on the remote host. That is more robust than a local machine sending an SSH command for every launch because the remote host owns its own credentials, PATH, tmux, and working directories. (ACTION: create a new ticket for this, with an acceptance criteria for remote runner, and a second objective that lets the user call ovld runner start on the remote host from the desktop app.)

### 5. Change auto-advance to enqueue, not launch

`scheduleQueuedObjectiveAfterDeliver(...)` should keep deciding whether the next objective is eligible. When it is eligible, it should create an `execution_request` instead of relying on an Electron-only `auto_advance` listener.

It can still write a ticket event, but the event should be informational. The request row becomes the source of truth.

### 6. Change Run button to request execution

`DraftObjective.tsx` should not decide whether to spawn a terminal directly. Its primary action should call the execution-request path.

Recommended behavior:

- Electron open and a local runner available: request execution and let the local runner claim it.
- Browser-only with no runner: request execution, then show "Waiting for a runner" with the copyable `ovld launch` command.
- Explicit "copy for CLI/cloud" options can remain.
- If users want immediate desktop behavior, Electron can run an embedded runner or claim the request immediately through the same queue path.

This gives manual Run and auto-advance one shared path.

## Remote and SSH Triggering

This architecture directly supports remote execution:

- A remote machine runs `ovld runner start`.
- The remote runner registers a device and project resource directory.
- A user clicks Run from the web app, mobile app, or desktop app and targets that device/resource.
- The remote runner claims the request and runs the assigned agent/model in its local terminal/tmux context.

For cases where no persistent remote runner exists, keep a fallback "launch over SSH" mode:

- A local runner claims the request.
- It executes `ovld launch ... --ssh-command ... --remote-working-directory ...`.
- The remote host starts the target agent under the configured shell/tmux wrapper.

The persistent remote runner is the better long-term default because it works even when the user's laptop is closed and avoids repeated SSH quoting, PATH, and interactivity failures.

## Why This Is Better Than Moving Electron Logic Into The Backend

The backend should coordinate execution, not perform execution. Launching a user's terminal is host-local state: credentials, PATH, shell rc files, terminal settings, tmux preferences, working directories, and SSH keys all live on the executing machine.

A durable request queue keeps the backend authoritative about what should happen while letting the correct device decide how it happens.

## Rollout Plan

1. Add the database table and protocol operations for execution requests.
2. Implement `ovld runner once` that claims and launches one queued request with `ovld launch`.
3. Add `ovld runner start` with Realtime subscription and polling fallback.
4. Change auto-advance scheduler to enqueue `auto_advance:<objective_id>` requests.
5. Change `AgentSplitButton` / `DraftObjective` Run to enqueue execution requests.
6. Keep Electron IPC as a compatibility adapter by having Electron claim requests through the same queue, then remove direct auto-advance launching.
7. Add runner setup/status UI and CLI docs.
8. Add remote runner targeting using existing `devices` and `project_resource_directories`.

## Risks and Mitigations

- Duplicate launches: use idempotency keys, request leases, and active-session checks before claim and before launch.
- Stale claimed requests: expire leases and allow retry after `lease_expires_at`.
- Wrong machine claims a request: require target resource matching when the request specifies a device or directory.
- Runner offline: keep request queued and surface "waiting for runner" in the UI with a copyable `ovld launch` fallback.
- Agent/model drift: keep assigned agent/model/thinking on the objective and snapshot the resolved launch parameters into the request payload.
- Security: runners only claim requests visible to the authenticated user/org and only for directories registered to that device.

## Alternative Architectures Considered

### Keep Electron as the launcher and add wake-up notifications

This does not solve CLI-only or closed-app environments. It also cannot reliably wake a terminated desktop app on all platforms.

### Have the Next.js backend SSH into machines

This centralizes too much sensitive host state in the backend. It would require storing SSH credentials server-side or routing through a privileged gateway, and it still would not know the remote shell/agent setup as well as a local runner.

### Extend `auto_advance` events and have every client listen

Realtime events are useful notifications, but they are not a durable work queue. A listener can be offline, miss an event, or race another listener. The event can remain, but it should not be the launch contract.

## Proposed Tests

The implementation should be tested at the same boundaries where ownership changes:

- objective selection and enqueueing in `lib/auto-advance/schedule-after-deliver.ts`
- request creation and idempotency in `lib/overlord/execution-requests.ts`
- claim and lease behavior in `apps/web/app/api/protocol/claim-execution/route.ts`
- launch state transitions in `apps/web/app/api/protocol/complete-execution-launch/route.ts` and `apps/web/app/api/protocol/fail-execution-launch/route.ts`
- CLI request plumbing and runner behavior in `packages/overlord-cli/bin/_cli/protocol.mjs` and `packages/overlord-cli/bin/_cli/runner.mjs`

Recommended split:

### 1. Unit tests for auto-advance enqueueing

Add to `tests/lib/auto-advance/schedule-after-deliver.test.ts`.

- `scheduleQueuedObjectiveAfterDeliver()` creates one execution request with `requestedFrom='auto_advance'` and `idempotencyKey='auto_advance:<objectiveId>'` when the next draft has `auto_advance=true`.
- It does not enqueue anything when no current draft objective exists.
- It does not enqueue anything when the next draft objective text is blank or whitespace.
- When `auto_advance=false`, it does not call `createExecutionRequest()`, marks the ticket unread/waiting, and writes the `awaiting_approval` event instead.
- If the next draft has an `approval_reason`, that exact text is used for both the blocking event summary and the push notification body.

These tests should mock `createExecutionRequest()` and `sendPushNotification()` directly so the assertions stay on scheduler behavior, not downstream queue mechanics.

### 2. Unit tests for execution request creation

Add `tests/lib/overlord/execution-requests.test.ts`.

- A draft objective is promoted to `submitted` before the request row is inserted.
- `requestedFrom='auto_advance'` sets `auto_advanced_at` when promoting the objective.
- The assigned agent payload on the objective wins over caller defaults for agent/model/thinking when present.
- Explicit API inputs for agent/model/thinking win when the objective has no assignment.
- Manual runs generate a non-empty idempotency key when one is not provided.
- Auto-advance derives `auto_advance:<objectiveId>` when no idempotency key is passed.
- Duplicate inserts on the same `(organization_id, idempotency_key)` return the pre-existing request row rather than throwing.
- A non-agent ticket or a non-launchable objective state fails with a clear error.
- The `execution_requested` ticket event payload snapshots the resolved agent/model/thinking and `target_kind`.

This is the real contract for "request execution" and deserves deeper coverage than the route wrapper.

### 3. Route tests for claim and launch state transitions

Add route-level tests under `tests/app/api/protocol/`.

- `request-execution` returns `404` for missing tickets and `401` without a user context.
- `claim-execution` skips requests targeted to another device.
- `claim-execution` skips SSH-targeted requests that do not have an `sshCommand`.
- `claim-execution` resolves `workingDirectory` from explicit launch params first, then `target_resource_id`, then same-device primary project resource, then `project_user.local_working_directory`.
- `claim-execution` can reclaim a previously `claimed` request after `lease_expires_at` passes, but not before.
- `claim-execution` increments `attempt_count` only on a successful claim.
- `complete-execution-launch` only succeeds for the device that currently holds the claim and clears the lease.
- `fail-execution-launch` only succeeds for the device that currently holds the claim, records `last_error`, and writes an `execution_launch_failed` ticket event.

These tests should stub the service-role Supabase client in the same style as other API route tests so they stay fast and deterministic.

### 4. CLI protocol tests

Extend `tests/cli-protocol.test.mjs`.

- `request-execution` posts the expected JSON body for local launches including `requestedFrom`, `launchMode`, repeated `--flag`, and optional targeting fields.
- `request-execution` includes SSH fields when `--ssh-command`, `--remote-working-directory`, `--server-multiplexer`, and `--tmux-command` are provided.
- `claim-execution` requires `--device-fingerprint` or `OVERLORD_DEVICE_FINGERPRINT`.
- `complete-execution-launch` and `fail-execution-launch` post the expected payloads and enforce the device fingerprint requirement.

Those tests protect the CLI surface from drifting away from the route contract.

### 5. Runner tests

Add `tests/cli-runner.test.mjs`.

- `buildLaunchArgs()` maps a claimed request into the correct `ovld launch` arguments for local execution.
- SSH claims include `--ssh-command`, `--remote-working-directory`, `--server-multiplexer`, and `--tmux-command` in the spawned launch command.
- `runOnce()` exits cleanly when `claim-execution` returns no request.
- When a request is claimed, the runner spawns `ovld launch ...` and calls `complete-execution-launch` after the child emits `spawn`.
- If the child emits `error`, the runner calls `fail-execution-launch` with the launch error message.
- If `complete-execution-launch` fails after spawn, the runner logs the problem but does not crash before the child exits.
- `readOrCreateDeviceFingerprint()` reuses an existing `~/.ovld/device.json` fingerprint and persists a generated one when absent.

These tests are the closest thing to proving "Electron closed, runner only" without needing a full end-to-end environment.

### 6. One focused integration test for duplicate suppression

Add a database-backed integration test once the route and helper tests are in place.

- Create a ticket with one draft objective.
- Call the execution-request path twice with `requestedFrom='auto_advance'` and the same derived key.
- Assert that only one `execution_requests` row exists and only one later claim can transition to `launched`.

This is the highest-value integration test because duplicate suppression is the main correctness risk in the design.

### 7. Lower-priority UI coverage

Only add UI tests after the queue and runner layers are covered.

- `AgentSplitButton` / Run UI: verify the action requests execution and surfaces "waiting for runner" copy when no local runner is available.
- Execution request status UI: verify queued/claimed/launched/failed badges render from request state without requiring Electron.
- `AutoAdvanceLauncher` compatibility layer: verify Electron claims the same queue path rather than using a private launch path.

These tests matter, but they are downstream of the queue semantics. The queue and runner tests should land first.

## Acceptance Criteria For Implementation

- Auto-advance launches the next objective when only `ovld runner start` is running and Electron is closed.
- Manual Run in the web UI creates the same kind of execution request as auto-advance.
- Assigned agent, model, thinking, flags, and project directory are preserved.
- A remote runner over SSH or on a remote host can claim and execute a request.
- Duplicate `auto_advance` events for the same objective do not launch duplicate sessions.
- UI shows queued/claimed/launched/failed state for execution requests.
