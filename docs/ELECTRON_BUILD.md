# Electron Build Notes

This document covers how the desktop main/preload bundles are built and the
native addon caveat that can fail Electron builds on macOS/zsh.

## Build commands

- Root script: `yarn electron:build-main`
- Desktop workspace script: `yarn workspace @overlord/desktop build-main`
- Full production package flow: `yarn electron:build`

These scripts compile:

- `apps/desktop/electron/main.ts` -> `apps/desktop/dist-electron/main.js`
- `apps/desktop/electron/preload.ts` -> `apps/desktop/dist-electron/preload.js`

## Native `.node` modules and esbuild

Electron dependencies can transitively require native Node addons (`.node`
files), for example `cpu-features/build/Release/cpufeatures.node`.

When bundling with esbuild, these binaries must stay runtime dependencies and
must not be bundled. Our build commands therefore pass:

- `--external:electron`
- `'--external:*.node'`

The quoted wildcard is required in `zsh` so the shell does not expand `*`
before esbuild receives the argument.

## Common error and fix

If you see:

`No loader is configured for ".node" files`

confirm the command includes quoted native-module externalization:

`'--external:*.node'`

Do not replace this with `--loader:.node=...`; Electron should load native
addons at runtime from `node_modules`.
