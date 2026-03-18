# Linux Desktop Download Rollout Plan

## Objective

Add Linux as a first-class desktop download option, define the build and release workflow for Linux artifacts, and update the downloads experience so the compatible installer is promoted automatically without hiding other platforms.

## Current State

- `electron-builder.yml` already defines Linux targets: `AppImage` and `deb`.
- `scripts/electron-build.mjs` builds the packaged Electron app through `electron-builder`.
- `scripts/upload-electron-release.mjs` uploads release artifacts to the public `app-downloads/electron/<version>/` storage path and rewrites `latest*.yml` manifests.
- `docs/packaging-v1-thin-electron-cli.md` already documents the expected `latest-linux.yml` updater layout.
- [`app/downloads/page.tsx`](/Users/jake/Development/Cooperativ/Overlord/app/downloads/page.tsx) currently exposes only Apple Silicon macOS downloads.

## Gaps

1. Linux exists in packaging config, but not in the public product UI.
2. The release workflow does not explicitly validate that Linux artifacts were built and uploaded before a release is considered complete.
3. The downloads page does not detect the visitor platform to prioritize the right installer.
4. The current UI assumes one mac architecture and does not model multiple desktop variants cleanly.

## Recommended Product Behavior

### Downloads UX

- Show a primary “Recommended for your device” card at the top of `/downloads`.
- Detect the visitor platform from the request `user-agent` on the server with a small shared helper.
- Promote the matching option when detection is confident:
  - macOS: show Apple Silicon first, with a note if Intel is not yet supported.
  - Linux: show AppImage as the default Linux download, with `deb` as an alternate.
  - Windows or unknown: do not guess a direct installer; show all desktop options with a neutral fallback message.
- Keep all desktop variants visible below the recommended card so users can override the choice manually.

### Linux-specific positioning

- Recommend `AppImage` as the default Linux artifact because it has the lowest install friction across distros.
- Offer `.deb` as a secondary option for Debian/Ubuntu users.
- Add brief copy clarifying:
  - `AppImage`: portable, broad compatibility.
  - `deb`: better integration on Debian-based systems.

## Technical Plan

### 1. Normalize download metadata

Create a small shared download catalog module, for example `lib/downloads/desktop.ts`, that defines:

- current version
- public storage base path
- platform entries (`macos`, `linux`)
- artifact variants per platform (`dmg`, `zip`, `AppImage`, `deb`)
- optional manifest URLs (`latest-mac.yml`, `latest-linux.yml`)
- labels and descriptions used by the UI

This removes hard-coded URLs from the page component and makes additional platforms manageable.

### 2. Add platform detection helper

Create a helper that accepts a user-agent string and returns one of:

- `macos`
- `linux`
- `windows`
- `unknown`

Implementation notes:

- Use `headers()` in the server page, following the same pattern already used in [`app/tickets/(components)/TicketsBoardContent.tsx`](/Users/jake/Development/Cooperativ/Overlord/app/tickets/(components)/TicketsBoardContent.tsx) and [`components/features/TicketPanelContent.tsx`](/Users/jake/Development/Cooperativ/Overlord/components/features/TicketPanelContent.tsx).
- Keep the helper conservative. If the UA is ambiguous, fall back to `unknown` instead of mis-promoting a binary.
- Do not hide non-matching options based on detection.

### 3. Expand `/downloads`

Update [`app/downloads/page.tsx`](/Users/jake/Development/Cooperativ/Overlord/app/downloads/page.tsx) to:

- render a recommended card based on detected platform
- render a full desktop matrix below it
- surface Linux downloads:
  - `Overlord-<version>-linux-x64.AppImage`
  - `Overlord-<version>-linux-amd64.deb` or whatever exact filename `electron-builder` emits
- optionally expose `latest-linux.yml` for updater debugging, matching the existing mac manifest link

### 4. Make artifact naming explicit

Before shipping the UI, verify the exact Linux filenames produced by `electron-builder` in `release/`.

If the generated `.deb` filename is inconsistent with the current URL assumptions, either:

- update the download catalog to use the real emitted name, or
- tighten `electron-builder.yml` so Linux output naming is predictable enough for the page and uploader.

This matters because the current page assumes exact file names rather than listing bucket contents dynamically.

### 5. Tighten release validation

Extend `scripts/upload-electron-release.mjs` so it fails fast when required Linux artifacts are missing.

Recommended checks:

- required mac artifacts still exist
- `latest-mac.yml` exists
- `latest-linux.yml` exists
- at least one Linux installer exists: `AppImage`
- optional secondary Linux package exists: `deb`

Recommended behavior:

- Treat missing `AppImage` or `latest-linux.yml` as release-blocking.
- Treat missing `.deb` as either release-blocking or a logged warning, depending on whether Debian packaging is part of the committed support scope.

### 6. CI/release operating model

Document and enforce the release environment for Linux builds.

Preferred approach:

- Build macOS artifacts on macOS runners.
- Build Linux artifacts on Linux runners.
- Upload both artifact sets into the same `app-downloads/electron/<version>/` prefix.
- Publish `latest-mac.yml` and `latest-linux.yml` at the feed root.

If releases remain manual for now, document the exact operator runbook in `docs/` and keep the build host OS explicit.

## Build / Upload / Download Workflow

### Build

1. Bump or confirm `package.json` version.
2. Run the Electron production build on the correct OS for each target.
3. Confirm the `release/` folder contains:
   - macOS: `.dmg`, `.zip`, `latest-mac.yml`
   - Linux: `.AppImage`, `.deb`, `latest-linux.yml`

### Upload

1. Run [`scripts/upload-electron-release.mjs`](/Users/jake/Development/Cooperativ/Overlord/scripts/upload-electron-release.mjs).
2. Upload binaries to `app-downloads/electron/<version>/`.
3. Upload root manifests to:
   - `app-downloads/electron/latest-mac.yml`
   - `app-downloads/electron/latest-linux.yml`
4. Prune older versions per the existing retention logic.

### Download

1. The `/downloads` page builds direct public URLs from the shared catalog. MARK THAT LINUX VERSIONS ARE IN BETA
2. Server-side platform detection chooses which option to promote.
3. Users can still select any visible variant manually.
4. Packaged Linux desktop apps use `latest-linux.yml` through the existing generic updater feed URL.

## Rollout Phases

### Phase 1: UI and release hardening

- Add the shared download catalog.
- Add OS detection helper.
- Update `/downloads` to show macOS and Linux.
- Validate and document exact Linux artifact names.
- Add uploader validation for Linux outputs.

### Phase 2: Release automation

- Split or formalize release jobs by runner OS.
- Ensure both mac and Linux artifacts land under the same version prefix.
- Add a smoke checklist that opens the public URLs after upload.

### Phase 3: Product polish

- Track click-through by promoted platform vs manual override.
- Add distro/install help text if support questions justify it.
- Consider `rpm` later only if there is demand; do not expand the support surface before AppImage/deb are stable.

## Acceptance Criteria

- `/downloads` visibly offers Linux desktop downloads.
- Linux users see a Linux installer promoted automatically.
- macOS users still see the mac installer promoted automatically.
- Unknown or unsupported platforms see a neutral fallback without a misleading recommendation.
- Release docs and scripts explicitly cover Linux build and upload steps.
- A release cannot silently omit the Linux updater manifest while still appearing complete.

## Open Decisions

- Whether `.deb` is required for launch or optional behind AppImage-first support.
- Whether Intel mac builds are intentionally unsupported or should be added while this page is being refactored.
- Whether release automation should move to CI now or remain a documented manual operator workflow.
