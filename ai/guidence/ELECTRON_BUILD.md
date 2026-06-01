# Electron Build Notes

This document covers how the desktop main/preload bundles are built and the
native addon caveat that can fail Electron builds on macOS/zsh.

## Build commands

- Root script: `yarn electron:build-main`
- Desktop workspace script: `yarn workspace @overlord/desktop build-main`
- Full production package flow: `yarn electron:build`
- Linux amd64 production package flow: `yarn electron:build:linux:amd64`
- Linux amd64 upload flow for an already-bumped version: `yarn electron:upload:linux:amd64:no-bump`

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

## Linux amd64 releases

Linux amd64 maps to Electron Builder's `x64` target. The AppImage artifact is
named with Electron Builder's `linux-x86_64` architecture label, while the
Debian artifact is named with Debian's `linux-amd64` architecture:

- `Overlord-<version>-linux-x86_64.AppImage`
- `Overlord-<version>-linux-amd64.deb`
- `latest-linux.yml`

To add Linux packages to the current release version, run the Linux upload from
a Linux host with production environment variables available. The `.deb` target
requires `ar` from `binutils`; gzip is used for package compression.

```bash
yarn electron:upload:linux:amd64:no-bump
```

The upload script stores the versioned Linux manifest as both
`latest-linux-amd64.yml` and `latest-linux-x64.yml`, then publishes
`latest-linux.yml` at the updater feed root.

The Debian target uses gzip package compression so local Linux builds do not
depend on host `xz` being installed.
