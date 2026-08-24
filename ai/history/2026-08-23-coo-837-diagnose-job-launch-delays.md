# coo:837 — Why the service runner is slow (or never launches)

Date: 2026-08-23

## Symptom

Jobs launch in about a second with a foreground `ovld runner start`. The same
queue, when only the launchd service (`ovld runner supervise` via
`io.overlord.runner`) is running, sits for a long time and sometimes never
starts.

This session (coo:837 itself) is an example: the backend recorded
`execution_requested` at 10:39:52.575Z and `claimed` 23ms later. The service
state file still has `lastClaimedAt` / `lastLaunchedAt` = 10:10:38Z. A
foreground runner claimed this job; the service did not.

## What is actually different

`ovld runner start` and `ovld runner supervise` share `runRunnerOnce` (claim →
launching → `launchAgent`). They do **not** share a process, runtime, PATH, or
macOS QoS class.

| | `ovld runner start` | service (`supervise`) |
| --- | --- | --- |
| Binary | nvm Node 24 (`~/.nvm/.../bin/ovld`) | `/Applications/Overlord.app/.../Overlord` with `ELECTRON_RUN_AS_NODE=1` |
| PATH | interactive shell (Homebrew, nvm, `~/.local/bin`) | `/usr/bin:/bin:/usr/sbin:/sbin` (snapshotted from Electron at install) |
| launchd | n/a (Interactive user session) | `ProcessType=Background`, `spawn type = background (5)` |
| TTY | yes | no |
| HTTP client | Node 24 undici | Electron-bundled Node fetch |

The installed plist (`~/Library/LaunchAgents/io.overlord.runner.plist`) captures
that stripped PATH and `OVERLORD_BACKEND_URL=https://backend.ovld.ai`. Versions
match (0.2608231148.0); the gap is the **host process**, not an old CLI build.

## Why pickup is slow

### 1. Apple Events from a Background LaunchAgent (main launch delay)

macOS launches go through `osascript` (`cli/src/terminal-launcher.ts` →
`spawnSync` in `cli/src/launch.ts`). There is **no timeout**.

A LaunchAgent with `ProcessType=Background` is App-Nap / QoS-throttled. Apple
Events to Terminal/iTerm from that context commonly return error **-1712**
("Application failed to respond") after 60–120s, or never return.

The service error log contains 35 lines of exactly that message, plus Electron
`task_name_for_pid: (os/kern) failure (5)` codesign probes — both typical of a
background Electron-as-Node process talking to GUI apps.

Foreground `ovld runner start` sends the same Apple Event from an Interactive
terminal process, so iTerm/Terminal answers immediately.

While `spawnSync(osascript)` is blocked, the supervisor **cannot claim anything
else**. Heartbeats freeze. A job stuck in `launching` expires after 10 minutes
(`LAUNCH_START_TTL_MS`) into terminal `expired` — that is the "never runs"
outcome.

### 2. Cloud claim long-poll vs proxy idle timeout

Postgres claims long-poll for 25s (`RUNNER_CLAIM_LONG_POLL_MS`) on a dedicated
`LISTEN overlord_execution_request_queue` connection. Express does not flush
headers until `res.json()` at the end, so the HTTP client sees silence for up
to 25s.

Fly.io (and similar) answers that with **502 "Application failed to respond"**
when the idle timeout is tighter than 25s, or when `pg.Client.connect()` for
LISTEN hangs with no timeout. The service then sleeps ~5s and retries.

A freshly started `ovld runner start` calls `claimNow()` immediately and wins
any already-queued row. The service may still be inside a dying long-poll.

If the NOTIFY trigger is missing or the listener was not armed, every idle
cycle waits the full 25s even when healthy.

### 3. Serial claim loop + no launch timeout

One `runOnce` at a time. A hung osascript or a 25s+502 long-poll delays every
subsequent job. `spawnSync` has no `timeout` option.

### 4. Periods where the service cannot reach the backend at all

`~/.ovld/logs/runner-service.err.log` has 218 `Could not reach Overlord backend`
/ `fetch failed` lines. During those windows the service claims nothing.
Foreground start in a working terminal often still can (different Node TLS/HTTP2
stack).

### 5. Earlier claim-handoff stranding (coo:632 / contract 79)

If claim succeeds and `POST .../launching` never lands, the row stays `claimed`
until the 15-minute claim TTL, then `expired` (not re-queued). Contract 79
added `launching` expiry and supervisor self-restart after binary replacement;
it did not fix Background QoS or osascript hangs.

## Why start feels instant

Starting `ovld runner start` creates a **new** poll loop that:

1. Runs `claimNow()` immediately (no leftover long-poll).
2. Talks to Terminal/iTerm as an Interactive process (Apple Events succeed).
3. Has a real TTY, so a missing terminal profile can still inline-launch.
4. Uses Node 24 fetch against the same `https://backend.ovld.ai`.

It races the service and almost always wins. This session's 23ms claim is that
race.

## Recommended fixes (not done in this diagnosis)

1. **launchd `ProcessType`**: `Background` → `Interactive` (or `Adaptive`). Reinstall the service. This is the highest-confidence fix for "takes forever / never".
2. **`spawnSync` timeout** (e.g. 20s) on osascript so a hung Apple Event cannot stall the claim loop; report `failed` and continue.
3. **Service PATH**: merge `/opt/homebrew/bin`, `/usr/local/bin`, and the installing shell's PATH; do not snapshot Electron's sanitized PATH.
4. **Long-poll**: send response headers (or a heartbeat byte) at the start of LISTEN; put a connect timeout on the pg listener client.
5. **Optional**: run the LaunchAgent under the real `ovld` Node entry instead of Electron-as-Node, so fetch/TLS match the foreground runner (keep the Overlord binary as `Program` if macOS Automation attribution still requires it).

## coo:818

`ovld protocol load-context --mission-id coo:818` could not be read from this
session (the CLI pinned `coo:837.mx8q`). Recent runner-adjacent work in-tree is
contract 79 / coo:632 (self-restart, `launching` expiry, claim-handoff
reporting), not a pickup-latency fix.
