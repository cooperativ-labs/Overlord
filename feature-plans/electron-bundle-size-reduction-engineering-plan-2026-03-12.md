# Engineering Plan: Electron Bundle Size Reduction

**Source:** Bundle analysis of v0.52.0 macOS arm64 build
**Date:** 2026-03-12
**Status:** Planning

---

## Objective

Reduce the Overlord Electron app installed size from **877 MB to ~340 MB** (62% reduction) and the DMG from **266 MB to ~120 MB** without reducing functionality or performance.

---

## Executive Summary

### Root cause

The overwhelming majority of the bloat comes from **electron-builder packing the entire root `node_modules`** (713 MB extracted, 50,773 files) into the `app.asar` archive. This includes build tools (eslint, babel, esbuild, rollup, terser, node-gyp, workbox-build), the Vercel CLI, polyfills (core-js, es-abstract), and complete duplicates of every package already inside `.next/standalone`.

The `.next/standalone` directory is a self-contained Next.js server with its own pruned `node_modules` (54 MB). The Electron main process itself only needs three npm packages: `electron-updater`, `node-pty`, and `dotenv`. Everything else in the root `node_modules` is dead weight in production.

### Fix strategy

1. Bundle the Electron main process into a single file with esbuild (inlining `electron-updater` and `dotenv`)
2. Exclude the root `node_modules` from the asar (keep only `node-pty` as an external native module)
3. Clean up the standalone output and strip cross-platform binaries

---

## Current State

### Bundle anatomy (v0.52.0, macOS arm64)

```
Overlord.app (877 MB total)
├── Contents/Frameworks/          259 MB   Chromium + Electron runtime (unavoidable)
├── Contents/Resources/
│   ├── app.asar                  368 MB   Packed application archive
│   │   ├── node_modules/         ~650 MB (extracted)  ← THE PROBLEM
│   │   ├── .next/standalone/     ~50 MB (extracted)
│   │   ├── dist-electron/        ~300 KB
│   │   ├── bin/                  ~88 KB
│   │   └── package.json
│   ├── app.asar.unpacked/        248 MB   Unpacked native modules + standalone
│   │   ├── node_modules/         175 MB   All native binaries from root deps
│   │   │   ├── @next/swc-*       100 MB   (duplicate - in standalone)
│   │   │   ├── @sentry/cli-*      34 MB   (duplicate - in standalone)
│   │   │   ├── @img/sharp-*       16 MB   (duplicate - in standalone)
│   │   │   ├── @esbuild/           10 MB   (build tool!)
│   │   │   ├── lightningcss-*       8 MB   (build tool!)
│   │   │   ├── node-pty              3 MB   ← only one actually needed
│   │   │   ├── @tailwindcss/oxide    3 MB   (build tool!)
│   │   │   └── @rollup/              2 MB   (build tool!)
│   │   ├── .next/standalone/      73 MB   Next.js server + its own node_modules
│   │   │   └── node_modules/      54 MB
│   │   │       ├── typescript      19 MB   (not needed at runtime)
│   │   │       ├── next            17 MB
│   │   │       ├── @img/sharp-*    16 MB
│   │   │       └── ...
│   │   └── bin/                   ~88 KB
│   └── icon.icns + lproj          ~1 MB
└── Contents/MacOS/                 52 KB
```

### Top offenders inside asar `node_modules/` (extracted sizes)

| Package | Size | Category |
|---------|------|----------|
| `next` | 148 MB | **Duplicate** (already in standalone) |
| `@next/*` | 100 MB | **Duplicate** (SWC compiler, in standalone) |
| `@sentry/*` | 63 MB | **Duplicate** (in standalone) |
| `lucide-react` | 34 MB | **Duplicate** (tree-shaken in standalone) |
| `date-fns` | 33 MB | **Duplicate** (in standalone) |
| `@opentelemetry` | 18 MB | **Duplicate** (Sentry telemetry) |
| `@img/*` | 16 MB | **Duplicate** (sharp bindings) |
| `@babel/*` | 13 MB | Build tool |
| `es-abstract` | 10 MB | Polyfill (unused) |
| `@esbuild/*` | 10 MB | Build tool |
| `vercel` | 8 MB | Deployment CLI |
| `lightningcss-*` | 8 MB | Build tool |
| `workbox-build` | 7 MB | PWA build tool |
| `core-js` | 7 MB | Polyfill (unused) |
| `react-dom` | 7 MB | **Duplicate** (in standalone) |
| `rollup` | 6 MB | Build tool |
| `zod` | 5 MB | **Duplicate** (in standalone) |
| `@vercel/*` | 5 MB | Deployment SDK |
| `lodash` | 5 MB | **Duplicate** (in standalone) |
| `eslint` | 5 MB | Linter |
| `caniuse-lite` | 4 MB | Browser compat data |
| `moment` | 3 MB | Another date library |
| `node-gyp` | 2 MB | Build tool |
| `terser` | 2 MB | Build tool |

Almost nothing in this list is actually needed. The main process uses `electron-updater`, `node-pty`, and `dotenv`.

### Why this happens

electron-builder automatically includes `node_modules` for all packages listed under `dependencies` in `package.json`. The current `electron-builder.yml` `files` config adds extra paths but does not exclude the default `node_modules` inclusion:

```yaml
# Current config — does NOT prevent node_modules inclusion
files:
  - "dist-electron/**/*"
  - ".next/standalone/**/*"
  - "bin/**/*"
```

Additionally, several build-time-only packages are misplaced in `dependencies` instead of `devDependencies`:

- `vercel: ^50.17.1` — Vercel CLI
- `@eslint/js: ^10.0.1` — linting library
- `@tailwindcss/postcss: ^4.1.18` — build-time CSS
- `tailwind: ^4.0.0` — build-time CSS
- `tailwindcss-animate: ^1.0.7` — build-time CSS

---

## Implementation Plan

### Step 1: Move misplaced packages to devDependencies

**Risk:** Low
**Impact:** Prevents electron-builder from treating these as production dependencies

**File:** `package.json`

Move from `dependencies` to `devDependencies`:

```diff
 "dependencies": {
-  "@eslint/js": "^10.0.1",
-  "@tailwindcss/postcss": "^4.1.18",
   ...
-  "tailwind": "^4.0.0",
-  "tailwindcss-animate": "^1.0.7",
-  "vercel": "^50.17.1",
   ...
 },
 "devDependencies": {
+  "@eslint/js": "^10.0.1",
+  "@tailwindcss/postcss": "^4.1.18",
   ...
+  "tailwind": "^4.0.0",
+  "tailwindcss-animate": "^1.0.7",
+  "vercel": "^50.17.1",
   ...
 }
```

Run `yarn install` afterward to regenerate the lockfile.

**Validation:** `yarn build` and `yarn lint` still pass. `yarn dev` still works. These packages are used at build time only — Next.js standalone traces actual runtime imports and is unaffected.

---

### Step 2: Bundle Electron main process with esbuild

**Risk:** Medium — requires validating all main process code paths
**Impact:** Eliminates the need for root `node_modules` entirely (except `node-pty`)

Currently the main process is compiled with `tsc`, producing individual `.js` files in `dist-electron/` that `require()` npm packages at runtime. This forces electron-builder to resolve the full dependency tree.

**Solution:** Use esbuild (already in `devDependencies` at v0.27.3) to bundle all main-process code into single files, inlining `electron-updater`, `dotenv`, and all transitive dependencies.

**File:** `scripts/electron-build.mjs`

Replace Step 5 (line 134: `run('yarn tsc -p electron/tsconfig.json')`) with:

```js
// ---------------------------------------------------------------------------
// Step 5 — Bundle Electron main-process with esbuild
// ---------------------------------------------------------------------------

// Bundle main process — inline all deps except electron (runtime) and node-pty (native addon)
run('npx esbuild electron/main.ts --bundle --platform=node --target=node20 --outfile=dist-electron/main.js --external:electron --external:node-pty --format=cjs --sourcemap');

// Bundle preload script — only electron is external
run('npx esbuild electron/preload.ts --bundle --platform=node --target=node20 --outfile=dist-electron/preload.js --external:electron --format=cjs --sourcemap');
```

**Why these externals:**
- `electron` — provided by the Electron runtime, cannot be bundled
- `node-pty` — native addon with `.node` binary files that must be loaded from disk

**What gets inlined:**
- `electron-updater` (and its deps: `fs-extra`, `js-yaml`, `semver`, `builder-util-runtime`, etc.)
- `dotenv`
- All internal `./ipc/*`, `./services/*` modules
- `_prod-env.generated.ts` (generated in Step 2 of the build script, before this step)

**Output:** Two self-contained files: `dist-electron/main.js` (~300-500 KB) and `dist-electron/preload.js` (~50 KB).

---

### Step 3: Convert dynamic require to static import in main.ts

**Risk:** Low
**Impact:** Required for esbuild bundling to work correctly

The current code uses a dynamic `require()` wrapped in try/catch for the generated prod env file:

```ts
// Current (lines 23-31 of electron/main.ts)
let PROD_ENV: Record<string, string> = {};
try {
  const generated = require('./_prod-env.generated');
  PROD_ENV = generated.PROD_ENV ?? {};
} catch {
  // Not present — either dev build or script wasn't run
}
```

esbuild cannot resolve dynamic `require()` calls. Since the build script generates `_prod-env.generated.ts` in Step 2 (before the bundling in Step 5), it is always present at bundle time.

**File:** `electron/main.ts`

Replace lines 21-31 with:

```ts
// Baked-in production runtime vars (generated from an explicit allowlist before build).
// In dev mode, an empty default file is used.
import { PROD_ENV } from './_prod-env.generated';
```

**File:** `electron/_prod-env.generated.ts` (new default file, committed to repo)

Create a checked-in default that dev mode uses:

```ts
// Default empty env — overwritten by scripts/electron-build.mjs for production builds.
export const PROD_ENV: Record<string, string> = {};
```

Add this path to `.gitignore` only if the build script always regenerates it. Since we want a default for dev, **do not gitignore it** — instead, the build script overwrites it and it should not be committed after a production build. Add a note in the generated output: `// AUTO-GENERATED — DO NOT COMMIT`.

Alternatively, keep the file committed as the empty default and add it to the build script's cleanup or use `git checkout -- electron/_prod-env.generated.ts` post-build.

**File:** `electron/tsconfig.json`

Keep for type-checking only (e.g., `yarn tsc -p electron/tsconfig.json --noEmit` in CI). The build no longer uses `tsc` for output.

---

### Step 4: Exclude root node_modules from electron-builder

**Risk:** Medium — must verify the app still launches with only node-pty available
**Impact:** Eliminates ~600 MB of unnecessary files from the asar

**File:** `electron-builder.yml`

```yaml
files:
  - "dist-electron/**/*"
  - ".next/standalone/**/*"
  - "bin/**/*"
  - "node_modules/node-pty/**/*"
  - "!node_modules"

asarUnpack:
  - "node_modules/node-pty/**/*"
  - ".next/standalone/**/*"
  - "bin/**/*"
```

**How this works:**
- `!node_modules` prevents electron-builder's default behavior of including all `dependencies`
- `node_modules/node-pty/**/*` explicitly re-includes only the native module needed by the main process
- `asarUnpack` stays the same structurally, but now only `node-pty` (3 MB) gets unpacked instead of 175 MB of native binaries

**Important nuance:** electron-builder processes `files` patterns in order. The explicit include of `node_modules/node-pty/**/*` must come before the `!node_modules` negation. If electron-builder evaluates negations differently, we may need:

```yaml
files:
  - from: "."
    filter:
      - "dist-electron/**/*"
      - ".next/standalone/**/*"
      - "bin/**/*"
      - "!node_modules"
      - "node_modules/node-pty/**"
```

Test both forms and use whichever correctly produces the desired asar contents.

---

### Step 5: Strip unnecessary files from .next/standalone

**Risk:** Low-Medium — must verify Next.js server doesn't need TypeScript at runtime
**Impact:** ~20 MB saved from the unpacked standalone

**File:** `scripts/electron-build.mjs`

Add after Step 4 (copy static/public into standalone), before Step 5 (esbuild):

```js
// ---------------------------------------------------------------------------
// Step 4.5 — Clean up standalone output (remove build-time-only packages)
// ---------------------------------------------------------------------------

// TypeScript compiler (19 MB) — not needed at runtime, pages are pre-compiled
run('rm -rf .next/standalone/node_modules/typescript');

// esbuild binary (10 MB) — build tool, not needed at runtime
run('rm -rf .next/standalone/node_modules/@esbuild');

// Remove source maps from standalone if not needed for debugging
// run('find .next/standalone -name "*.map" -delete');
```

**Validation:** Launch the app, navigate through all pages, test API routes. If any route fails with "Cannot find module 'typescript'", restore it (would mean Next.js 16 uses the TypeScript compiler at runtime for some reason).

---

### Step 6: Strip cross-platform node-pty prebuilds

**Risk:** Low
**Impact:** ~55 MB saved (only relevant platform binary retained)

`node-pty/prebuilds/` contains native binaries for every supported platform: `darwin-arm64`, `darwin-x64`, `win32-arm64`, `win32-x64`. When building for macOS arm64, only the 136 KB `darwin-arm64` binary is needed.

**File:** `scripts/electron-build.mjs`

Add before the electron-builder step:

```js
// ---------------------------------------------------------------------------
// Step 5.5 — Strip non-target node-pty prebuilds
// ---------------------------------------------------------------------------

import { readdirSync, rmSync, existsSync } from 'node:fs';

const prebuildsDir = resolve(ROOT, 'node_modules', 'node-pty', 'prebuilds');
if (existsSync(prebuildsDir)) {
  const target = `${process.platform}-${process.arch}`;
  console.log(`[build] Stripping node-pty prebuilds (keeping ${target})`);
  for (const entry of readdirSync(prebuildsDir)) {
    if (entry !== target) {
      rmSync(resolve(prebuildsDir, entry), { recursive: true, force: true });
      console.log(`[build]   Removed prebuilds/${entry}`);
    }
  }
}
```

**Note:** This modifies `node_modules` in-place. If the dev environment needs those prebuilds later, `yarn install` restores them. Consider doing this in a copy instead if the build script is run frequently in dev.

---

## Expected Results

### Size comparison

| Component | Before | After | Savings |
|-----------|--------|-------|---------|
| Electron Framework | 259 MB | 259 MB | — |
| app.asar | 368 MB | ~3 MB | **365 MB** |
| app.asar.unpacked | 248 MB | ~55 MB | **193 MB** |
| Other | ~2 MB | ~2 MB | — |
| **Total installed** | **877 MB** | **~320 MB** | **~557 MB (64%)** |
| **DMG size** | **266 MB** | **~110 MB** | **~156 MB (59%)** |

### What the asar will contain after changes

```
app.asar (~3 MB)
├── dist-electron/
│   ├── main.js         ~400 KB (bundled main process)
│   ├── main.js.map
│   ├── preload.js      ~50 KB (bundled preload)
│   └── preload.js.map
├── .next/standalone/   → unpacked (pointer only)
├── bin/                → unpacked (pointer only)
├── node_modules/
│   └── node-pty/       → unpacked (pointer only)
└── package.json

app.asar.unpacked (~55 MB)
├── .next/standalone/   ~52 MB (Next.js server, minus TypeScript)
├── node_modules/
│   └── node-pty/       ~140 KB (single-platform prebuild)
└── bin/                ~88 KB
```

---

## Verification Plan

1. **Build:** `yarn electron:pack` — produces the unpacked app in `release/mac-arm64/`
2. **Size check:** `du -sh release/mac-arm64/Overlord.app` — target ~320-340 MB
3. **Asar audit:** `npx asar list release/mac-arm64/Overlord.app/Contents/Resources/app.asar | wc -l` — target <500 files (down from 50,773)
4. **App launch:** Run the app, verify the login page renders
5. **Auth flow:** Complete OAuth login
6. **Terminal:** Spawn a terminal session (validates node-pty works)
7. **Auto-update:** Verify update check runs (validates electron-updater bundled correctly)
8. **File system:** Test git status/diff operations
9. **Navigation:** Browse through main app pages (validates Next.js standalone server)
10. **DMG build:** `yarn electron:build` — verify DMG size ~110-130 MB

---

## Risk Mitigation

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| esbuild misses a dynamic require in main process | Medium | Audit all `require()` calls in `electron/` before switching. Run `npx esbuild --analyze` to verify bundle contents. |
| Next.js standalone needs TypeScript at runtime | Low | Test first, restore if API routes break. Next.js 16 pre-compiles all routes. |
| `!node_modules` negation doesn't work as expected in electron-builder | Medium | Test with `electron:pack --dir` first. Fall back to `filter` syntax if needed. Inspect asar contents before distributing. |
| node-pty prebuilds stripped too aggressively | Low | Only strip other-platform dirs. The target platform's `.node` file remains untouched. |
| Thin wrapper migration (planned) makes this work obsolete | Low | These changes are complementary. Even in the thin-wrapper architecture, the asar should not contain the full `node_modules`. The standalone cleanup step would simply be removed. |

---

## Relationship to Thin Wrapper Migration

The thin wrapper migration plan (`thin-wrapper-migration-engineering-plan-2026-03-07.md`) proposes removing the embedded Next.js server entirely. These optimizations are **complementary, not conflicting**:

- Steps 1-4 (esbuild bundling + excluding node_modules) benefit both architectures
- Steps 5-6 (standalone cleanup) become unnecessary after thin wrapper migration since standalone would be removed entirely
- The thin wrapper migration would further reduce the app to ~265 MB (Electron framework + small asar + node-pty)

This plan delivers immediate value while the thin wrapper migration is a larger architectural change.

---

## Files to Modify

| File | Change |
|------|--------|
| `package.json` | Move 5 packages from dependencies to devDependencies |
| `scripts/electron-build.mjs` | Replace tsc with esbuild, add cleanup steps for standalone and node-pty prebuilds |
| `electron/main.ts` | Convert dynamic `require('./_prod-env.generated')` to static import |
| `electron-builder.yml` | Add `!node_modules` exclusion, keep only `node_modules/node-pty` |
| `electron/_prod-env.generated.ts` | Ensure committed empty default exists for dev mode |
