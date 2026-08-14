# Why the runner service breaks after a desktop app release

**Mission:** coo:726 — Debug Runner Service Failures After App Updates
**Date:** 2026-08-14
**Contract version at time of writing:** 77
**Predecessor:** [runner-claim-handoff-recovery.md](./runner-claim-handoff-recovery.md) (coo:632, 2026-08-06)

This is an investigation, not an implementation. It re-derives the failure from
current code, confirms which of coo:632's four defects were actually fixed,
identifies the two that were left open, and adds two aggravators that write-up
did not cover. Nothing in this mission changed behavior.

---

## 1. How the pieces connect

Six independent components are involved in "click Run → an agent opens in iTerm".
Each one holds a piece of state that the others cannot see.

```
Desktop shell (Electron)                Backend                        Runner service (launchd)
─────────────────────────               ───────                        ────────────────────────
[Run] click
  POST /api/objectives/:id/launch  ─►   launchObjective()
                                          guard: any ACTIVE sibling?
                                          guard: any ACTIVE request
                                                 for this objective?  ──► if yes, RETURN IT (no new row)
                                          createExecutionRequest()
                                            status = 'queued'
                                                                       ◄── POST /api/runner/claim  (every 3–5s,
                                                                            or a 25s Postgres long-poll)
                                        claimNextExecutionRequest()
                                          WHERE status = 'queued'
                                          AND (execution_target_id IS NULL
                                               OR = this runner's target)
                                          → status = 'claimed'
                                                                       ──► POST /requests/:id/launching
                                          → status = 'launching'
                                                                            prepareMissionBranch()
                                                                            launchAgent()  (osascript → iTerm)
                                                                       ──► POST /requests/:id/launched
                                          → status = 'launched'
                                        (agent attaches)               ──► ovld protocol attach
                                          → status linked to session
```

The runner service itself is an OS-level user service the **CLI** owns
(`cli/src/runner-service.ts`); the desktop shell only shells out to
`ovld runner service <action>` (`desktop/src/runner-service-control.ts`).
On macOS that is a launchd LaunchAgent at
`~/Library/LaunchAgents/io.overlord.runner.plist`, and — this is the load-bearing
detail — its `ProgramArguments` point **inside the app bundle**
(`cli/src/runner-service.ts:255` `resolveOverlordAppInvocation`):

```
/Applications/Overlord.app/Contents/MacOS/Overlord
/Applications/Overlord.app/Contents/Resources/cli/bin/ovld.mjs
runner supervise
```

with `ELECTRON_RUN_AS_NODE=1` so the signed Overlord binary runs as Node. This is
deliberate: macOS attributes a LaunchAgent's background item, login item, and
Apple Events (automation) prompt to the code-signing identity of
`ProgramArguments[0]`, so running the app binary registers the service under
"Overlord" instead of "Node.js Foundation".

The plist also freezes an **environment snapshot** taken at install time
(`buildRunnerServiceEnv`, `cli/src/runner-service.ts`): `OVERLORD_BACKEND_URL`,
`PATH`, and optionally `OVLD_HOME` / `OVERLORD_USER_TOKEN`. Persistent services do
not source shell startup files, so this snapshot is the runner's whole world.

**Everything that follows is a consequence of one design fact: the running
supervisor's program path, and the environment it was given, are pinned at install
time to an app bundle that the updater is free to replace underneath it.**

---

## 2. Root cause

`desktop/src/updater.ts:169` `installDownloadedUpdate()` calls
`autoUpdater.quitAndInstall(false, true)`. Squirrel swaps `/Applications/Overlord.app`
for the new bundle. Nothing in the update path stops, restarts, reinstalls, or
even notifies the runner service — there is no reference to the runner anywhere in
`updater.ts`, `cli-updater.ts`, or `main.ts`'s `boot()`.

The supervisor process does not exit, so:

- **launchd never respawns it.** `KeepAlive: true` only acts on process exit. A
  live process is, to launchd, a healthy job.
- **It keeps running the old bundle's code** from its already-resident module
  graph, out of a bundle path that no longer exists on disk.
- **It still looks perfectly healthy to everyone.** It keeps polling
  `/api/runner/claim`, and contract v40 makes that poll double as the runner's
  heartbeat, so `execution_targets` reads reachable and the desktop runner box
  stays green. `ovld runner service status` reports `installed: yes, running: yes`
  because `launchctl list` shows a PID.

So after an update the machine has a *zombie supervisor*: alive, registered,
heartbeating, winning claims, and running code from a deleted bundle. It wins the
claim race against nothing — it is the only runner — and then fails or stalls on
the launch, because the launch step is the one part that reaches back out to disk
and to the OS (bundle-relative paths, `osascript` automation whose TCC grant is
keyed to the app's signature, and the frozen `PATH` snapshot).

That alone would be a self-healing annoyance. It is not, because the queue has no
recovery path for a claim that dies mid-handoff, and the Run button silently
refuses to queue a second one.

---

## 3. The four defects, and their status today

coo:632 named four composing defects. Two were fixed; **two are still open**, and
they are exactly the two that make the failure unrecoverable rather than merely
noisy.

| # | Defect | Status |
|---|--------|--------|
| 1 | `POST /requests/:id/launching` sat outside the launch try/catch, so a failed handoff reported nothing | **Fixed** — `cli/src/commands.ts` now has the call inside the try, with a best-effort failure report |
| 2 | A `claimed` row is never re-offered (`claimNextExecutionRequest` only matches `status = 'queued'`) | **Open by design** — this is the at-most-once launch property; recovery is supposed to come from #3/#4 |
| 3 | Claim expiry is terminal, not a retry (`claimed` → `expired` after 15 min) | **Open** — intentional per coo:632 §C, but it means the objective is freed only after the TTL, and only if a runner polls |
| 4 | **`launching` is not covered by expiry at all** | **STILL OPEN** |

Verified in current code — `expireStaleExecutionRequests`
(`packages/core/service/execution-requests.ts:982`) has exactly two arms:

```sql
(er.status = 'claimed'  AND er.claim_expires_at   < now)
OR
(er.status = 'launched' AND er.launched_session_id IS NULL AND er.launch_completed_at < attachCutoff)
```

There is no `launching` arm, even though `launch_started_at` already exists on the
row (`backend/postgres/migrations/002_initial_core.sql:695`) and is written by
`markExecutionLaunching` (`execution-requests.ts:745`). Proposal A from coo:632
was written up but never applied.

Consequences of a row stranded in `launching`:

- `launching` ∈ `ACTIVE_EXECUTION_REQUEST_STATUSES` (`execution-requests.ts:26`),
  so it is permanently "active".
- The claim query only matches `queued`, so **no runner will ever touch it again**.
- Expiry never touches it, so **it never becomes terminal**.
- `backend/execution/launch.ts:1420` — every subsequent **Run** click finds it and
  `return toExecutionRequestDto(activeRequestRow)` **instead of creating a new
  request**. The API returns 200 with the stranded row, so the UI flips the button
  to "Queued" and shows no error. This is the exact user-visible symptom: *"the job
  appears in the queue but never launches."*
- `backend/execution/launch.ts:1288–1310` — it also blocks every **sibling**
  objective on the same mission with `409 Another objective on this mission is
  already active`.

The only mechanism in the entire system that releases it is
`clearExecutionRequests` (`execution-requests.ts:916`), reachable from
`ovld runner clear <objective_id>` / `clear-all` or the queue UI's remove action.

Proposal B from coo:632 — the supervisor checking the identity of its own program
each poll and exiting `0` when it changes so the service manager respawns it from
the new build — was also **never applied**. `runRunnerSupervisor`
(`cli/src/commands.ts:1969`) has no such check. That is the root-cause fix, and its
absence is why this recurs on every single release.

---

## 4. Two aggravators coo:632 did not cover

### 4a. A "reinstall" can silently keep launchd's old job definition

`LaunchdManager.start()` (`cli/src/runner-service.ts:525`):

```ts
try   { await runCommand('launchctl', ['load', '-w', this.unitPath()]); }
catch { await runCommand('launchctl', ['kickstart', '-k', `gui/${uid}/${LAUNCHD_LABEL}`]); }
```

`install()` writes the plist and calls `start()` **without stopping first**. If the
label is still loaded — which is the normal state when you press "Install"/"Restart"
in the desktop panel — `load -w` fails with "service already loaded", and the
fallback is `kickstart -k`. **`kickstart` restarts the job from launchd's
already-registered in-memory definition; it does not re-read the plist from disk.**
The freshly written `ProgramArguments` and `EnvironmentVariables` are ignored.

`uninstall()` (`cli/src/runner-service.ts:551`) compounds it: the `unload` is inside
a `try {} catch {}` and the plist file is deleted **regardless of whether the unload
succeeded**. If the unload fails, the label stays registered with the old
definition, the file that would have corrected it is gone, and the next install
writes a new plist that `load -w` then refuses (still loaded) → `kickstart` → old
definition again.

That is a direct, code-level explanation for the user's third and fourth scenarios:
*"same if I use the desktop interface to uninstall the runner service, reinstall it,
and click Run."* The reinstall can be a no-op at the launchd layer. And even when it
does work, it cannot help, because the stranded `launching` row is invisible to the
new supervisor and every Run click keeps returning that same row (§3).

Note `restart()` is correct — it does `stop()` then `start()`, which forces a real
reload. `ovld runner service restart` is therefore strictly better than
uninstall + install.

### 4b. The frozen `OVERLORD_BACKEND_URL` can silently strip the auth header

Conditional on Local mode, but worth knowing because it produces the same
"nothing happens, no error" shape.

- `resolveBackendUrl` (`cli/src/config.ts:331`) puts an explicitly-exported
  `OVERLORD_BACKEND_URL` at the **top** of the precedence list — above
  `overlord.toml`. A launchd `EnvironmentVariables` entry counts as explicit. So
  the service is pinned to whatever URL was current at install time, forever.
- The desktop app, meanwhile, re-resolves its local backend port on **every boot**:
  `resolveInitialShellOrigin` → `findFreePort(4310)`
  (`desktop/src/backend-runtime.ts:181`, `desktop/src/server.ts:154`), then writes
  the result into `~/.overlord/overlord.toml` via `syncOverlordTomlForProfile`
  (`desktop/src/backend-config.ts:18`). If 4310 is occupied at boot — a lingering
  listener from the app being replaced, or a `yarn dev` server — the app moves to
  4311+ and the plist is now stale.
- The failure is worse than a wrong port, because stored credentials are **bound to
  the URL they were issued for** (`cli/src/backend-client.ts:47–52`): if
  `stored.backendUrl !== baseUrl`, the client sends **no `Authorization` header at
  all** rather than a wrong one. The runner then polls unauthenticated.

An interactive `ovld runner start` in iTerm has no `OVERLORD_BACKEND_URL` exported,
so it reads the freshly-synced toml, matches the stored credential, and works —
which is one more reason the terminal workaround succeeds where the service does not.

---

## 5. Mapping every reported scenario to a mechanism

| Observation | Mechanism |
|---|---|
| Download the new app, click Run → queued, never launches | Zombie supervisor from the replaced bundle claims and dies mid-handoff → row stranded in `launching` (§2, §3 #4) → every later Run click returns that stranded row instead of queuing (`launch.ts:1420`) |
| Same after updating the `ovld` CLI first | The plist runs the **app-bundled** CLI (`…/Contents/Resources/cli/bin/ovld.mjs`), never the global npm `ovld`. Updating the global CLI cannot affect the service at all |
| Same after uninstall + reinstall from the desktop UI | Two reasons, either sufficient: the reinstall can degrade to `kickstart` on launchd's stale job definition (§4a); and a fresh supervisor still cannot see the stranded `launching` row, while Run keeps returning it (§3) |
| Same after reinstalling the agent and restarting iTerm | The service does not inherit anything from an interactive shell — its environment is the frozen plist snapshot. iTerm state is irrelevant to it |
| Usually fixed by one `ovld runner start`, and it keeps working after that process is closed | The foreground runner is the **current** CLI under plain Node, with a live environment and a valid auth header. It wins the next claim and completes it. It keeps working afterwards because the queue is drained and, by then, the zombie is gone — not because it changed any persistent state. Note it only helps when a *fresh* `queued` row exists for it to claim |
| Sometimes you must remove the objective from the queue first, then run `ovld runner start`, then click Run | This is the stranded-`launching` case specifically. `clearExecutionRequests` is the only code path that releases it. Until it is cleared, Run is a silent no-op and siblings 409 |

The difference between "just start a runner" and "clear the queue *then* start a
runner" is exactly whether the zombie supervisor got as far as
`POST /requests/:id/launching` before it died.

---

## 6. Recommended fixes

Ordered by leverage. The first is the root-cause fix; the second is the safety net
that makes any future variant recoverable without manual intervention.

### B (root cause). Supervisor exits when its own program is replaced

`ovld runner supervise` records the identity (dev+inode+mtime) of
`process.execPath` and its entry script at startup, re-`stat`s them each poll, and
`process.exit(0)` when either changes or disappears. launchd/systemd `KeepAlive`
respawns it from the new build within ~10s.

Transport-agnostic: covers desktop auto-update, a manual `.app` drag-replace, and a
`brew`/`npm` CLI upgrade identically, without the updater having to orchestrate
service lifecycle from a process that is about to quit — which Component Registry
§5 forbids the shell from doing anyway.

*Contract impact:* additive local behavior in the Runner Layer; add to §5 that the
supervisor self-restarts on program replacement. No REST, schema, DTO, or
Protocol/Connector/MCP change. Requires a version bump (77 → 78) because §5 pins
supervisor behavior.

### A (safety net). Expire a stalled `launching` request

Add a third arm to `expireStaleExecutionRequests` keyed on `launch_started_at`
older than a launch TTL while the objective is still launchable, moving the row to
`expired`. `launch_started_at` already exists and is already written.

*Contract impact:* the Queue Surface's state-transition sentence currently reads
"stale claims and launched-without-attach requests may move to `expired`" — extend
it to include a `launching` request whose runner never reported `launched` within
the launch TTL. `markExecutionLaunched` must tolerate a 409 on an expired request
for the very-slow-launch case; it already throws `execution_request_conflict`,
which the runner reports as a failure. No schema, route, or payload change; the
desktop queue simply drains on its own. Same version bump as B.

### Contract status

The 77 → 78 bump for B and A landed ahead of the code, as `CONTRACT.md` "Procedure
for contract-modifying changes" requires. Component Registry §5 (Runner Layer) now
carries a *Supervisor self-restart on program replacement* bullet, and the Runner →
REST (Queue Surface) **State transitions** rule now names a `launching` request past
the launch TTL as expirable. `contract/components.yaml` mirrors both under
`components.runner.owns` and `interactionSurfaces.runnerToRest.rules`. C and D below
remain contract-free.

### C. Make service reinstall actually reinstall

Small, contract-free CLI fix in `cli/src/runner-service.ts`:

- `LaunchdManager.install()` should `bootout`/`unload` an already-loaded label
  before writing and loading the new plist, so the new definition always wins.
- Replace the `kickstart -k` fallback with `bootout` + `bootstrap` (or at minimum
  unload-then-load), since `kickstart` cannot pick up a rewritten plist.
- `uninstall()` should not delete the plist when the unload failed, or should
  escalate to `launchctl bootout gui/$UID/io.overlord.runner` before deleting —
  deleting the file while the label stays registered is the worst of both.

### D. Stop freezing a mutable backend URL (Local mode only)

Either omit `OVERLORD_BACKEND_URL` from the plist for loopback URLs so the service
follows `overlord.toml` like every other CLI invocation, or have the desktop
rewrite + `restart` the service when its resolved local port changes. Also worth
surfacing: when the stored credential's `backendUrl` does not match the resolved
one, `backend-client.ts` should say so instead of silently sending no header.

---

## 7. Diagnostics for the next occurrence

Run these **before** touching anything, right after the next app update:

```bash
# 1. Is the supervisor older than the app bundle? (zombie check)
launchctl list | grep io.overlord.runner            # note the PID
ps -o lstart=,command= -p <PID>                     # start time predates the update?
stat -f '%Sm %N' /Applications/Overlord.app          # bundle mtime

# 2. What is the service actually pointed at?
plutil -p ~/Library/LaunchAgents/io.overlord.runner.plist
cat ~/.ovld/runner-service.json                      # execProgram, backendUrl, lastError
cat ~/.overlord/overlord.toml | grep backend_url     # does it match the plist?

# 3. The durable record (runner-service.json's lastError is overwritten every poll)
tail -50 ~/.ovld/logs/runner-service.err.log

# 4. Is a row stranded?
ovld runner status --json                            # anything in claimed / launching
```

A row in `launching` with no progress, plus a supervisor whose start time predates
the bundle mtime, confirms the mechanism in §2/§3.

**Workaround until B and A land:**

```bash
ovld runner clear-all
ovld runner service restart      # NOT uninstall + install — see §4a
```
