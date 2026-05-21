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

## Acceptance Criteria For Implementation

- Auto-advance launches the next objective when only `ovld runner start` is running and Electron is closed.
- Manual Run in the web UI creates the same kind of execution request as auto-advance.
- Assigned agent, model, thinking, flags, and project directory are preserved.
- A remote runner over SSH or on a remote host can claim and execute a request.
- Duplicate `auto_advance` events for the same objective do not launch duplicate sessions.
- UI shows queued/claimed/launched/failed state for execution requests.
