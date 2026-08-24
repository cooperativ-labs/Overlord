# coo:837.8c4k — LaunchAgent ProcessType Interactive

The persistent runner LaunchAgent now renders `ProcessType=Interactive` instead of `Background`. Background QoS App-Naps Apple Events to Terminal/iTerm (error -1712, 60–120s or never); Adaptive only raises QoS after UI activity, which a headless claim loop never generates.

The same plist rewrite also stops snapshotting `process.env.PATH` (Electron’s `/usr/bin:/bin:/usr/sbin:/sbin`, or an nvm shim PATH). `composeRunnerServicePath` uses a fixed prefix `/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin` plus system dirs so `osascript` stays resolvable. ProgramArguments stay the Overlord binary (option 5 rejected).

`ovld runner service install` was already bootout → write → bootstrap. Status now reads the installed plist: if ProcessType is not Interactive, it nags to reinstall. Desktop shows that hint and a Reinstall service button (install without `--no-start` so a running agent comes back up). App auto-update respawns the process but does not rewrite the plist — existing machines must re-run install.

Linux systemd: no ProcessType analog; the unit does not set Nice or CPUSchedulingPolicy. PATH prefix still applies via Environment.

Tests: ProcessType Interactive (not Background/Adaptive), composed PATH without nvm, install overwrites an existing plist, systemd has no Nice/CPUScheduling, reinstall hint only while stale.
