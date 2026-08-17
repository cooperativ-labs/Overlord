# Desktop Shell — Testing

The desktop module is a thin shell; most behavior is verified through the
pieces it composes (the server bundle, `ovld serve`) plus manual smoke tests of
the packaged app. It is excluded from the default `yarn test` aggregate.

## Automated / scriptable

- **Server bundle boots on plain Node.** `yarn workspace @overlord/backend
build:server` then `node backend/dist-server/index.cjs` against a fresh
  `OVERLORD_SQLITE_PATH` must create + migrate the DB, seed the workspace, and
  answer `GET /api/health` with `{ ok: true }`.
- **`ovld serve` first-run.** On a clean machine,
  `ovld serve --db /tmp/x.sqlite --port <free>` creates, migrates, seeds, and
  serves — verified via `/api/health` and `/api/meta`.
- **Backend-profile process lifecycle.** `yarn workspace @overlord/desktop test`
  runs `src/backend-lifecycle.test.ts` and `src/backend-process.test.ts`, which
  drive the real activation policy and the real process supervisor over a fake
  process table. They cover cold Remote startup (no backend forked), cold Local
  startup (exactly one), Local → Remote (reaped, not merely signalled),
  Remote → Local (exactly one), five repeated switches without accumulation,
  failed Remote/Local starts, app shutdown, and connect-only dev mode.
- **esbuild bundles + typecheck.** `yarn workspace @overlord/desktop build` emits
  `dist-electron/{main,preload}.cjs`; `yarn workspace @overlord/desktop typecheck`
  passes against the Electron type defs.

## Manual smoke tests

1. **Connect-only dev.** Start `ovld serve`, run `yarn desktop:dev`; the window
   renders the SPA and is fully usable.
2. **Supervised launch.** A packaged (or `yarn desktop:start`) build forks the
   server, creates the DB on first run, shows the UI, and a terminal-launched
   agent's protocol calls appear live in the feed.
3. **Security.** External links open in the system browser; a second launch
   focuses the existing window; the renderer has no Node access
   (`window.require` is undefined).
4. **Backend-profile process/memory measurement.** With the app running, take a
   labelled snapshot, perform the transition, then take another:

   ```bash
   node desktop/scripts/desktop-process-report.mjs --label local-before \
     --out /tmp/overlord-processes.jsonl
   # switch Local -> Remote in Settings -> Backend (the app restarts)
   node desktop/scripts/desktop-process-report.mjs --label remote-after \
     --out /tmp/overlord-processes.jsonl
   ```

   A conformant Remote profile reports `embedded backend processes: 0` and no
   orphaned `node-utility` process from the previous Local session. The app's
   own view of the same moment is in
   `<userData>/diagnostics/process-inventory.jsonl` (it records the utility
   process `serviceName`, which `ps` cannot see).

5. **Packaging.** `yarn desktop:package:prod --out <dir> --no-sign` emits a launchable
   `.app`/`.dmg`. With `--sign --notarize` (and Apple creds), the `.dmg` passes
   `spctl -a -vvv` and launches on a clean Mac.
