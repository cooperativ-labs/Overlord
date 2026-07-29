# Area Playbook — `desktop`

## Roots

```
desktop/src/         # Electron main process: window, ipc, preload, backend supervision, updater
desktop/update-feed.ts
desktop/esbuild.mjs
desktop/electron-builder.yml
desktop/conformance-manifest.yaml
```

Excluded from review: `desktop/dist-electron/`, `desktop/server/`, `desktop/webapp-dist/`,
`desktop/staging/`, `desktop/release/`, `desktop/sqlite/` — all build output or staged copies
(already ignored by lint). A finding about any of these is really a finding about the build
script that produces them.

## Read first

- `CONTRACT.md` → **Desktop Shell** (§10) and the *Desktop Shell → REST (Renderer Surface)* and
  *Desktop Shell → CLI (Process Supervision Surface)* interaction surfaces.
- `desktop/README.md`, `desktop/docs/desktop-app.md`, `desktop/conformance-manifest.yaml`.

This is the smallest area (~30 files) but the highest blast radius: it supervises the backend
process, holds tokens, and owns the IPC boundary. Bias toward `S`/`M` findings with explicit
security reasoning; a clever restructuring here that widens the IPC surface is a regression even
if it is tidier.

## Area-specific checks

### IPC surface minimality
`ipc.ts` + `preload.ts` define everything the renderer can ask the main process to do. The
correct shape is a small, explicitly enumerated channel list with validated arguments. Flag:
- channels that pass through arbitrary paths, commands, or URLs without validation
- a generic "invoke anything" channel — always report this, regardless of convenience
- handlers whose logic lives inline in `ipc.ts` rather than in the owning module
  (`runner-service-control.ts`, `local-target-bridge.ts`, `backend-runtime.ts`), which is the
  main cohesion finding for this area

```bash
grep -n "ipcMain\.\(handle\|on\)(" desktop/src/ipc.ts | wc -l
grep -n "contextBridge\|exposeInMainWorld" desktop/src/preload.ts
```

Any change to the exposed channel set is a renderer-surface change: `M` at minimum, `XL` if the
contract enumerates it.

### Path allowlist integrity
`local-target-path-allowlist.ts` is a security control with its own test. Refactors must not
change which paths pass. Treat it as behavior-locked: propose only extraction with the existing
test unchanged, and say so in the finding.

### Token and credential handling
`backend-token-store.ts`, `cli-auth-sync.ts`, and `oauth-handoff.ts` move credentials between the
shell, CLI, and backend. Flag tokens crossing IPC to the renderer, appearing in logs, or being
written outside the store's own path helpers (`paths.ts`). Consolidating three credential paths
into one is high-value; loosening any of them is not a refactor.

### Process supervision shape
`backend-runtime.ts`, `static-server.ts`, `runner-service-control.ts`, and `cli-updater.ts` each
spawn and supervise a child process. Compare their spawn/health-check/restart/teardown handling
side by side. Divergence in teardown is the finding that matters — it produces orphaned processes
and port conflicts — and it justifies a shared supervisor helper.

### Config and profile resolution
`backend-config.ts`, `backend-profiles.ts`, and `settings-store.ts` resolve device-shared versus
per-workspace settings, a distinction that has been a real source of bugs. Flag any new read of a
setting that bypasses these modules, and any place the device-shared/per-workspace split is
re-decided locally instead of being asked of one owner.

### Window lifecycle
`window.ts` and `quick-task-window.ts` both create and manage BrowserWindows. Check for
duplicated option objects (security flags in particular: `contextIsolation`,
`nodeIntegration`, `sandbox`) — duplicated window options that have drifted apart are a
security-relevant duplication finding, not a cosmetic one.

### Build script coupling
`esbuild.mjs` and `electron-builder.yml` encode which files are bundled and staged. If a
proposed move renames or relocates an entry point, the finding must include the build-config
update; a refactor that typechecks but does not package is worse than no refactor.

## Verification for refactors in this area

```bash
yarn lint
yarn desktop:typecheck
yarn desktop:build:prod    # proves the bundle and staging still resolve
```

`yarn desktop:package:prod` is the only check that fully proves packaging; call for it in the
finding whenever entry points, staging paths, or builder config move. State plainly that IPC and
supervision changes need a manual launch of the packaged app — they have no automated coverage.
