# Runner claim-to-launch handoff: silent stranding and recovery

**Mission:** coo:632 — Diagnose Runner Service Launch Failures
**Date:** 2026-08-06
**Contract version at time of writing:** 54

## Symptom

After updating Overlord Desktop (and uninstalling/reinstalling the runner service),
clicking **Run** on an objective does nothing. The button flips to "Queued" and
stays there. Nothing appears in the mission feed, no error is shown anywhere, and
the runner service reports itself healthy. Clearing the queue and starting a
foreground `ovld runner start` restores normal operation — and it keeps working
afterwards even once the foreground runner is stopped, until the next app update.

## Evidence

Live mission event history for **coo:617** (all times 2026-08-06 UTC):

```
12:07:51.495  execution_requested  Queued cursor (gpt-5.6-terra) execution for a runner.
12:07:51.539  status_change        Runner claimed execution request.
12:07:51.544  status_change        Launch parameters for cursor: pre-command `agp`.
12:07:52.754  status_change        Runner started launching execution request.
12:08:10.165  status_change        Agent run failed: Launch command exited with status 1   <-- old, stale-bundle supervisor

            [user uninstalls + reinstalls the runner service]

12:09:21.741  execution_requested  Queued cursor (gpt-5.6-terra) execution for a runner.
12:09:21.779  status_change        Runner claimed execution request.
12:09:21.784  status_change        Launch parameters for cursor: pre-command `agp`.
                                   <-- NOTHING. No launching, no failed, ever.
12:10:39.900  status_change        Cleared execution request.

12:11:02.850  execution_requested  Queued cursor (gpt-5.6-terra) execution for a runner.
12:11:02.873  status_change        Runner claimed execution request.
12:11:02.877  status_change        Launch parameters for cursor: pre-command `agp`.
                                   <-- NOTHING again.
12:12:26.799  status_change        Cleared execution request.

            [user starts a foreground `ovld runner start`]

12:12:40.771  execution_requested  Queued cursor (gpt-5.6-terra) execution for a runner.
12:12:40.810  status_change        Runner claimed execution request.
12:12:40.814  status_change        Launch parameters for cursor: pre-command `agp`.
12:12:41.076  status_change        Runner started launching execution request.
12:12:42.389  status_change        Runner opened the agent launch command.
```

The queue is not stuck *before* the claim. A runner **claims the request and then
goes silent** — it never reaches `POST /api/runner/requests/:id/launching`, and it
never reports `failed` either.

The `GET /api/projects//launch-preference` 404s in the request log are unrelated
(see "Red herring" below).

## Mechanism

Four independent defects compose into an unrecoverable, undiagnosable state.

### 1. The claim-to-launch handoff had no failure reporting

`cli/src/commands.ts` `runRunnerCommand → runOnce`: the claim response is
consumed, `reportRunnerResourceObservations` runs inside its own best-effort
try/catch, and then `POST /requests/:id/launching` ran **outside** the try/catch
that reports failure. Every other step of the launch reports `failed` on error;
this one step did not. A transient network error, a socket reuse error after the
25-second claim long poll, a 409 because the request was cleared underneath, or an
auth blip on that single POST produced exactly the observed signature: `claimed`,
then silence.

### 2. A claimed request is never re-offered

`claimNextExecutionRequest` (`packages/core/service/execution-requests.ts`) only
ever considers `er.status = 'queued'`. Once a row is `claimed`, no runner — not the
one that claimed it, not a fresh one — can pick it up again.

### 3. Claim expiry is a dead end, not a retry

`expireStaleExecutionRequests` moves a `claimed` row whose `claim_expires_at`
passed (15 min) to `expired`, which is terminal. So the stranded request is not
retried after the TTL either; it simply rots. The objective stays non-launchable
in practice because the UI keeps showing an active request.

### 4. `launching` is not covered by expiry at all

`expireStaleExecutionRequests` handles `claimed` (claim TTL) and `launched`
(attach TTL). It does **not** handle `launching`. A runner killed between
`launching` and `launched` strands a row in `launching` forever. `launching` is in
`ACTIVE_EXECUTION_REQUEST_STATUSES`, so that row:

- keeps the objective's mission looking busy — `launchObjective` refuses sibling
  objectives with `409 Another objective on this mission is already active`;
- never leaves the queue until someone runs `ovld runner clear-all`.

This is precisely what a desktop auto-update does: `desktop/src/updater.ts`
`installDownloadedUpdate()` calls `autoUpdater.quitAndInstall(false, true)`, which
replaces `/Applications/Overlord.app` while the launchd supervisor is still running
out of that bundle. Nothing stops, restarts, or even notifies the runner service
around an update.

### Why the app update is the trigger

The persistent service is installed as
`/Applications/Overlord.app/Contents/MacOS/Overlord …/Contents/Resources/cli/bin/ovld.mjs runner supervise`
(`resolveOverlordAppInvocation`). An update swaps that bundle underneath the live
process. The already-running supervisor keeps its loaded module graph and its
network stack in memory, so it **keeps claiming work** — its heartbeat still looks
`healthy` to the backend and the target still reads reachable — but the bundle it
was launched from is gone. launchd's `KeepAlive` cannot help: the process never
exits, so it is never respawned from the new bundle. The 12:07:51 entry above is
that stale supervisor getting all the way to the launch command and failing it
(`exited with status 1`).

`ovld runner service uninstall` is `launchctl unload -w <plist>` inside a
`try {} catch {}` followed by removing the plist. If the unload does not reap the
old process, the plist is deleted anyway and the reinstall loads a second
supervisor. Both share one `runner-instance.json`, so they register as **one**
runner instance id and the backend cannot tell them apart — the target reports a
single healthy runner while a broken process is competing for its claims.

### Why the workaround works

`ovld runner clear-all` moves every `queued`/`claimed`/`launching` row to
`cleared`, which is the only mechanism in the system that releases a stranded
claim. The subsequent foreground `ovld runner start` runs the **currently
installed** CLI under plain Node, wins the next claim, and completes it. It keeps
working afterwards because by then the stale supervisor is gone and the queue is
clean — not because the foreground runner changed any persistent state.

## Red herring: the empty-project-id 404s

```
GET /api/projects//launch-preference   404
GET /api/projects//execution-target    404
GET /api/projects//resources           404
GET /api/projects//repository          404
```

`useProjectResources`, `useLaunchPreference`, `useProjectExecutionTarget`, and
`useProjectRepository` had no `enabled` guard. `QuickTaskBar` initializes
`selectedProjectId` to `''` and is mounted before a project is chosen, so all four
fire against an empty id on every app start. Noise, not a cause — but noise that
lands in the log at exactly the moment a launch fails and reads like the failure.

## What was fixed in this mission (no contract change required)

- **`cli/src/commands.ts`** — the `POST /requests/:id/launching` call now sits
  inside the launch try/catch, so a failed handoff reports `failed` with the real
  error instead of stranding the claim. The failure-reporting POST itself is now
  best-effort, so a secondary failure (unreachable backend, 409 on an
  already-terminal request) no longer masks the original cause in
  `runner-service.json`'s `lastError`.
- **`webapp/web/lib/queries.ts`** — `enabled: Boolean(projectId)` on the four
  project-scoped hooks, removing the empty-project-id 404 burst.

## Proposed contract changes (not applied)

Both items below change behavior the contract pins, so they need a version bump
(54 → 55) and a `contract/components.yaml` update. They are written up here rather
than applied unilaterally as part of a diagnosis.

### A. Expire a stalled `launching` request

**Contract text today** (Runner → REST, Queue Surface):

> **State transitions**: `queued → claimed → launching → launched|failed`; active
> requests may be cleared; stale claims and launched-without-attach requests may
> move to `expired`

**Proposed:** add "and a `launching` request whose runner never reported
`launched` within the launch TTL" to the set that may move to `expired`.

Implementation: extend `expireStaleExecutionRequests` with a third arm keyed on
`launch_started_at` older than the TTL while the objective is still launchable.

**Impact:**
- *Runner Layer* — a runner killed mid-launch no longer strands a permanently
  active row; a very slow launch could be expired underneath it, so
  `markExecutionLaunched` must tolerate a `409` on an expired request (it already
  throws `execution_request_conflict`, which the runner reports as a failure).
- *REST API Layer* — no route or payload change.
- *Database Layer* — no schema change; `launch_started_at` already exists.
- *Desktop Shell / webapp* — the queue drains on its own, so the "Queued" badge
  stops being permanent. No API change.
- *Protocol Layer, Connector Layer, MCP* — unaffected.

### B. Supervisor self-restart when its own program is replaced

**Proposed addition to Component Registry §5 (Runner Layer):** the persistent
supervisor records the identity (inode + mtime) of its own program and entry
script at start, re-checks it each poll, and exits `0` when it changes or
disappears, so the OS service manager respawns it from the newly installed build.

This is the root-cause fix for "it breaks every time I update the app", and it is
transport-agnostic — it covers desktop auto-update, a manual `.app` replacement,
and a `brew`/`npm` CLI upgrade equally, without the updater having to orchestrate
service lifecycle across a process that is about to quit.

**Impact:**
- *Runner Layer* — new local behavior only; `runner-service.json` gains no new
  field (the exec identity can be held in process memory).
- *Desktop Shell* — no change needed to `updater.ts`; explicitly does **not**
  require the shell to reimplement service management, which §5 forbids.
- *CLI Layer* — `ovld runner supervise` gains a clean-exit path; `ovld runner
  start`/`once` unaffected.
- *All other components* — unaffected.

### C. Considered and rejected: re-queue instead of expire

Moving a stranded `claimed`/`launching` row back to `queued` would make recovery
automatic, but it re-launches work that may have already spawned an agent process
the backend cannot see. `expired` + an immediate, reported `failed` (fix 1) keeps
the "launch at most once" property while still freeing the objective.

## Verification steps for the reporter

On the affected machine, after the next app update and before touching anything:

1. `launchctl list | grep io.overlord.runner` — note the PID.
2. `ps -o lstart=,command= -p <PID>` — if the start time predates the update, the
   supervisor is running from the replaced bundle. That is defect 4.
3. `cat ~/.ovld/runner-service.json` — `lastError` is the supervisor's only record
   of a failed poll, and it is overwritten by the next successful poll ~3 seconds
   later, so it is usually already cleared by the time anyone looks.
4. `tail ~/.ovld/logs/runner-service.err.log` — the durable record.
5. `ovld runner status --json` — a row sitting in `claimed` or `launching` with no
   progress is the stranded request.

Immediate workaround, unchanged: `ovld runner clear-all`, then
`ovld runner service restart`.
