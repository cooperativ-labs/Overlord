# coo:837.km44 — Bound osascript spawnSync so a hung Apple Event cannot stall the runner

Date: 2026-08-23

## What changed

`cli/src/launch.ts` now applies a 45s `spawnSync` timeout (SIGKILL) only when
opening a terminal (`LaunchExecution.terminal` set: iTerm2, Terminal, or a
generic `open` launcher). Latch create, nested Latch inline runs, and long-running
inline agent processes are unchanged.

On `ETIMEDOUT` the launch throws a clear error: osascript/Apple Event timed out,
the execution request is reported `failed`, and the supervisor continues claiming.
The message documents the orphan-window risk: killing the wait does not recall
the Apple Event, so iTerm/Terminal may still open after we fail.

Ships in the CLI/app bundle. The supervisor self-respawns after binary replace.
No LaunchAgent reinstall, ProcessType, PATH, or claim long-poll change.

## Why 45s

osascript returns when the Apple Event is accepted, not when the agent finishes.
20s false-fails a cold iTerm start. 45s is the upper end of the 30–45s window
from the diagnosis, still far below the 10-minute `launching` TTL and the 60–120s
(or never) Background-QoS hangs.
