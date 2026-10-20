# Renderer CPU investigation — coo:1165.4bn0

The reproduced sustained CPU usage comes from persistent status animations
requiring per-frame renderer style, layer and paint work. The fix preserves
status motion using compositable transforms and adds local recording controls
for any future occurrence. The installed application has not been replaced.

## Live evidence

Observed on macOS 27.0.1, Apple Silicon, installed Overlord
`0.2610130851.0`, renderer PID 59762, 20 October 2026 around 10:12–10:22 CEST.
The app was using a Remote backend. Its process inventory and process table
showed one SPA renderer and no embedded backend process.

The first observation was idle (0% CPU); a five-second native stack sample
showed the main thread waiting. Opening Feed with one executing mission and
120 delivered missions reproduced sustained 20.8% and 20.1% renderer CPU.
These were `ps` observations, not a controlled CPU benchmark.

The installed app's DevTools Performance recording covered 18,945 ms:

| Category  | Main-thread time |
| --------- | ---------------: |
| Rendering |         1,229 ms |
| Painting  |           440 ms |
| Scripting |           144 ms |
| System    |           504 ms |

Bottom-up tasks included Layerize (746.1 ms), Paint (347.4 ms), Recalculate
style (275.9 ms), and Pre-paint (185.8 ms). JavaScript was a small contributor.
The timeline displayed continuous rendering/painting between ordinary events.

A reversible DevTools experiment identified four active CSS animations:
one pulse, one shimmer, and two spinning SVG status icons. No application data,
requests or subscriptions were changed during this comparison.

| Animation state on the same Feed page                                           | Renderer CPU observation |
| ------------------------------------------------------------------------------- | -----------------------: |
| Original status animations                                                      |               20.1–20.8% |
| Shimmer paused, other animations running                                        |               14.7–16.2% |
| All four animations paused                                                      |                     0.0% |
| Shimmer and pulse restored, spinners paused                                     |                    15.9% |
| Pulse alone                                                                     |                     3.2% |
| Motion restored with translated gradient, HTML spinner wrappers and layer hints |                     3.9% |

The experimental DOM edits were removed by reloading the installed app and
closing DevTools. Its packaged code remains unchanged. Native stack samples
were captured locally in `/private/tmp/overlord-renderer-1165.sample.txt` and
`/private/tmp/overlord-renderer-feed-1165.sample.txt`; temporary files may not
survive system cleanup. The DevTools timings above were read directly from
its Summary and Bottom-up tables; no exported live trace is included here.

## Implementation

- Shared `StatusMotion.tsx` replaces background-position shimmer with translation
  of a fixed gradient, and rotates an HTML wrapper around static SVG icons.
  Both use transform layer hints and honor reduced-motion preferences.
- Feed, objective rows and mission board/list/calendar overlays use this shared
  shimmer. Persistent Feed/objective spinners use the wrapper. Feed's live pulse
  gets an opacity layer hint and honors reduced motion.
- Settings → Diagnostics records a fixed 15-second Chromium trace in Electron
  main, plus one-second process CPU/memory snapshots. Closing Settings or
  changing SPA routes does not stop recording. Only the trusted main document
  can invoke the fixed bridge operations; no caller chooses a path, debugger
  command, trace configuration or upload destination.
- The latest local trace and summary replace the previous capture. The trace
  buffer is limited to 32 MiB, with record-until-full behavior. The panel discloses
  that URLs/function names may be present and that files stay local.
- Existing ten-minute inventory snapshots now include Electron CPU measurements.
  They identify the affected process over time but can miss short spikes.
- Contract version advances to 161 for the diagnostics bridge, with module
  impacts recorded in `CONTRACT.md` and the desktop manifest validated.

## Validation

- All 337 webapp tests pass, including new Diagnostics UI coverage for older
  desktop builds, recording, closing/reopening Settings, and revealing files.
- All 35 desktop tests pass, including overlapping requests, repeat recordings,
  failed start/stop/write cleanup and a disappearing renderer.
- Real Electron smoke: 128,260 trace events, JavaScript `ProfileChunk` and
  rendering events, 16 snapshots, positive renderer CPU and memory readings.
- Actual compiled `StatusMotion` markup with production SPA CSS in Electron:
  **120 → 0 style recalculations over two seconds** compared with the old
  background-position shimmer and SVG rotation. This is a rendering-work
  regression check, not an OS CPU percentage benchmark.
- Production SPA build and desktop bundle build pass. Webapp typecheck passes.
  Desktop typecheck passes with ESNext/bundler resolution and TS extension
  imports enabled. The repository's default desktop Node16 configuration reports
  existing cross-package ESM/`.ts` import errors in device/local-target modules;
  this change does not modify that configuration.
- `ovld contract check desktop/conformance-manifest.yaml --json` passes.

## Scope and operational follow-through

This establishes and fixes the animation-driven Feed case. The reported 40%
peak and long-session recurrence were not independently reproduced at that
exact level. There is no evidence here establishing a subscription or memory
leak. Restarting changes the current document and active work displayed, which
can change animation load; this investigation does not establish every reason
restart temporarily helps.

Build and distribute a desktop release containing these changes to make the
fix and diagnostics panel available in `/Applications/Overlord.app`. After
installing it, use Feed with executing work to check CPU. If another sustained
spike occurs, choose Settings → Diagnostics → Record 15 seconds, return to
the affected screen, then inspect `performance.trace.json` and
`performance-summary.json` together. Capture changes CPU overhead itself;
the first interval CPU reading is a baseline, and Electron's reported CPU
scale should not be compared directly with Activity Monitor.
