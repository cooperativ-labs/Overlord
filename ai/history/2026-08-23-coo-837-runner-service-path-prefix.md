# coo:837.6v47 — Deterministic runner service PATH prefix

The LaunchAgent/systemd unit no longer snapshots Electron’s sanitized PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) or the interactive/nvm shell PATH. `composeRunnerServicePath` builds a fixed prefix `/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin` plus system dirs so `osascript` stays resolvable and Latch/`open`/agent binaries spawned by the service process can be found. iTerm login shells already have the user PATH; ProgramArguments stay the Overlord binary.

ProcessType Interactive was already in `renderLaunchdPlist` (coo:837.8c4k). This objective owns the PATH half of that same plist rewrite so existing machines reinstall once.

`ovld runner service status` now inspects the installed plist PATH and nags when it is still Electron’s snapshot, even if ProcessType is already Interactive. App auto-update respawns the supervisor but does not rewrite PATH — re-run `ovld runner service install` (or Desktop → Reinstall service).

Tests: composed PATH equals the fixed prefix (no nvm), env ignores `process.env.PATH`, plist round-trip of PATH, reinstall hint on stale PATH.
