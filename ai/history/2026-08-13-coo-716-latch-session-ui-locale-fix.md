# coo:716 — Latch session management UI broken by missing UTF-8 locale

## Symptom

The mission-page terminal-session card (Overlord web/desktop UI) stopped working for
Latch sessions: it showed "Device is not reachable from this client", disabled the
Open/End controls, and rendered the error:

```
Error: tmux returned an unexpected session row:
ses_19ffc46f81f17b9c0_0__110_25_1786643944_1_97218__
```

Latch itself was healthy — sessions launched and attached normally.

## Root cause

Latch commit `b11ed8d` changed its tmux row format separator from `\t` to the
U+001F unit separator. tmux sanitizes non-printable characters in its command
output to `_` when the client process runs without a UTF-8 locale. The packaged
Overlord Desktop app is launched by Finder/launchd, so its environment has no
`LANG`/`LC_CTYPE`; every `latch inspect` it spawned therefore received
`_`-separated rows that Latch's parser could not split, and the whole session
card failed. Reproduced deterministically:

```
env -i HOME=$HOME PATH=/usr/bin:/bin:$HOME/.local/bin latch inspect ses_… --json
# Error: tmux returned an unexpected session row: …
env -i … LC_CTYPE=UTF-8 latch inspect ses_… --json   # works
```

The card's "Device is not reachable from this client" line is derived from
`inspection.isSuccess`, so the single failing `latch inspect` also produced the
misleading reachability message and disabled the action buttons.

## Fix (Overlord side)

Added `packages/core/service/latch-environment.ts` — `latchChildEnvironment()`
returns a child env whose effective `LC_CTYPE` category is guaranteed UTF-8
(macOS `UTF-8`, elsewhere `C.UTF-8`), leaving already-configured UTF-8 locales
untouched and dropping a conflicting non-UTF-8 `LC_ALL`. Applied it to every
Latch child process Overlord spawns:

- `packages/core/service/latch-session.ts` (`inspect` / `open` / `stop` — the failing UI path)
- `packages/core/service/latch-events.ts` (`latch events` harness-event collection)
- `packages/core/service/latch-send.ts` (`send --help` probe and `send --resolve`)
- `packages/core/service/latch-discovery.ts` (`capabilities` probe)
- `cli/src/latch-launch.ts` (`create` / `open` in the runner launch path)

Also fixed a pre-existing `eqeqeq` lint error in `latch-events.ts`
(`signal == null` → `signal === null`; the close-event signal is typed
`NodeJS.Signals | null`).

## Verification

- New unit tests in `latch-environment.test.ts` plus a spawn-level regression
  test in `latch-session.test.ts` (child sees UTF-8 `LC_CTYPE` when the parent
  has no locale).
- End-to-end: `inspectLatchSession()` against the live failing session with
  `LANG`/`LC_ALL`/`LC_CTYPE` unset now returns the session state instead of the
  tmux row error.
- All latch-related suites pass (37 tests), lint clean, core + cli typecheck clean.

## Residual risk / follow-up

The root cause also lives in Latch: any non-Overlord caller without a UTF-8
locale still breaks. Latch should either export a UTF-8 `LC_CTYPE` to its own
tmux client invocations or use a printable separator. The concurrent mission
coo:715 ("Refactor CLI Tmux Engine for Stability") owns that engine code, so the
Latch-side fix was deliberately left to it. The packaged Overlord Desktop app
needs a rebuild/release to pick up this fix; until then, launching it from a
terminal (which passes a UTF-8 locale) is a workaround.
