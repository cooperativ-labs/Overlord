#!/usr/bin/env node
/* global console, process */
/**
 * Unified Electron production build script.
 *
 * Why this exists:
 *   NEXT_PUBLIC_* variables (Supabase URL, publishable key, site URL) are baked
 *   into the Next.js client bundle at build time — they are NOT runtime-patchable.
 *   `apps/desktop/electron/main.ts` applies `.env.prod` to `process.env` at startup, which fixes
 *   server-side code (API routes, server components), but the React client bundle
 *   has already been compiled with whatever env was active during `next build`.
 *
 *   This script reads `apps/web/.env.prod`, generates
 *   `apps/desktop/electron/_prod-env.generated.ts` for
 *   the main-process runtime patch, then passes the same vars as the actual process
 *   environment when spawning `next build`, so the client bundle gets the correct
 *   production Supabase URL and keys compiled in.
 *
 * Usage:
 *   node scripts/electron-build.mjs                       → build for the current host platform
 *   node scripts/electron-build.mjs --platform mac       → build macOS artifacts
 *   node scripts/electron-build.mjs --platform mac --mac-arch x64
 *                                                     → build Intel macOS artifacts
 *   node scripts/electron-build.mjs --platform mac --mac-arch arm64
 *                                                     → build Apple Silicon macOS artifacts
 *   node scripts/electron-build.mjs --platform linux     → build Linux artifacts
 *   node scripts/electron-build.mjs --platform linux --linux-arch arm64
 *                                                     → build Linux ARM64 artifacts
 *   node scripts/electron-build.mjs --dir                → build + unpackaged app dir only
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pickRuntimeEnv } from './electron-runtime-allowlist.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const isDirMode = process.argv.includes('--dir');

function readFlagValue(flagName) {
  const args = process.argv.slice(2);
  const inline = args.find((arg) => arg.startsWith(`${flagName}=`));
  if (inline) {
    return inline.slice(flagName.length + 1);
  }

  const index = args.indexOf(flagName);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function getElectronBuilderTargetFlag() {
  const requestedPlatform = readFlagValue('--platform');
  const requestedMacArch = readFlagValue('--mac-arch');
  const requestedLinuxArch = readFlagValue('--linux-arch');
  if (!requestedPlatform) return '';

  if (requestedPlatform === 'mac') {
    if (requestedLinuxArch) {
      console.error('\x1b[31m[build] --linux-arch is only valid with --platform linux\x1b[0m');
      process.exit(1);
    }
    return ` --mac${getMacArchFlag(requestedMacArch)}`;
  }
  if (requestedMacArch) {
    console.error('\x1b[31m[build] --mac-arch is only valid with --platform mac\x1b[0m');
    process.exit(1);
  }
  if (requestedPlatform === 'linux') return ` --linux${getLinuxArchFlag(requestedLinuxArch)}`;

  console.error(`\x1b[31m[build] Unsupported --platform value: ${requestedPlatform}\x1b[0m`);
  console.error('       Expected one of: mac, linux');
  process.exit(1);
}

function getMacArchFlag(requestedMacArch) {
  if (!requestedMacArch) return '';

  if (requestedMacArch === 'x64') return ' --x64';
  if (requestedMacArch === 'arm64') return ' --arm64';

  console.error(`\x1b[31m[build] Unsupported --mac-arch value: ${requestedMacArch}\x1b[0m`);
  console.error('       Expected one of: x64, arm64');
  process.exit(1);
}

function getLinuxArchFlag(requestedLinuxArch) {
  if (!requestedLinuxArch) return '';

  if (requestedLinuxArch === 'x64') return ' --x64';
  if (requestedLinuxArch === 'arm64') return ' --arm64';

  console.error(`\x1b[31m[build] Unsupported --linux-arch value: ${requestedLinuxArch}\x1b[0m`);
  console.error('       Expected one of: x64, arm64');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDotenv(content) {
  const vars = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

function run(cmd, env) {
  console.log(`\n\x1b[36m>\x1b[0m ${cmd}`);
  const result = spawnSync(cmd, {
    shell: true,
    stdio: 'inherit',
    env: env ?? process.env,
    cwd: ROOT
  });
  if (result.status !== 0) {
    console.error(`\x1b[31m[build] Command failed: ${cmd}\x1b[0m`);
    process.exit(result.status ?? 1);
  }
}

// ---------------------------------------------------------------------------
// Step 1 — Read apps/web/.env.prod
// ---------------------------------------------------------------------------

const envFile = resolve(ROOT, 'apps', 'web', '.env.prod');
let prodEnvVars;
try {
  prodEnvVars = parseDotenv(readFileSync(envFile, 'utf8'));
} catch {
  console.error(`\x1b[31m[build] ERROR: apps/web/.env.prod not found at ${envFile}\x1b[0m`);
  console.error('       Create it with your production Supabase credentials before building.');
  process.exit(1);
}

console.log(
  `[build] Loaded ${Object.keys(prodEnvVars).length} vars from apps/web/.env.prod: ${Object.keys(prodEnvVars).join(', ')}`
);

// ---------------------------------------------------------------------------
// Step 2 — Generate apps/desktop/electron/_prod-env.generated.ts
// ---------------------------------------------------------------------------

const runtimeEnvVars = pickRuntimeEnv(prodEnvVars);

console.log(
  `[build] Writing ${Object.keys(runtimeEnvVars).length} allowlisted runtime vars: ${Object.keys(runtimeEnvVars).join(', ')}`
);

const entries = Object.entries(runtimeEnvVars)
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  .join('\n');

const generatedTs = `// AUTO-GENERATED by scripts/electron-build.mjs — DO NOT COMMIT\n// Run \`node scripts/electron-build.mjs\` before building the Electron app.\n\nexport const PROD_ENV: Record<string, string> = {\n${entries}\n};\n`;

const outFile = resolve(ROOT, 'apps', 'desktop', 'electron', '_prod-env.generated.ts');
writeFileSync(outFile, generatedTs, 'utf8');
console.log('[build] Written apps/desktop/electron/_prod-env.generated.ts');

// ---------------------------------------------------------------------------
// Step 3 — next build  (with prod env so NEXT_PUBLIC_* are baked in correctly)
// ---------------------------------------------------------------------------

const buildEnv = {
  ...process.env,
  ...prodEnvVars,
  NODE_ENV: 'production'
};

run('yarn electron:build-web', buildEnv);

// ---------------------------------------------------------------------------
// Step 4 — Copy Next.js assets into standalone output
// ---------------------------------------------------------------------------

run('cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static');
run('cp -r apps/web/public apps/web/.next/standalone/apps/web/public');

// ---------------------------------------------------------------------------
// Step 4.5 — Clean up standalone output (remove build-time-only packages)
// ---------------------------------------------------------------------------

run('rm -rf apps/web/.next/standalone/node_modules/typescript');
run('rm -rf apps/web/.next/standalone/node_modules/@esbuild');

// ---------------------------------------------------------------------------
// Step 5 — Bundle Electron main-process with esbuild
// ---------------------------------------------------------------------------

run(
  "npx esbuild apps/desktop/electron/main.ts --bundle --platform=node --target=node20 --outfile=apps/desktop/dist-electron/main.js --external:electron '--external:*.node' --format=cjs --sourcemap"
);
run(
  "npx esbuild apps/desktop/electron/preload.ts --bundle --platform=node --target=node20 --outfile=apps/desktop/dist-electron/preload.js --external:electron '--external:*.node' --format=cjs --sourcemap"
);

// ---------------------------------------------------------------------------
// Step 5.5 — electron-builder
// ---------------------------------------------------------------------------

run(`yarn electron-builder --config apps/desktop/electron-builder.yml${isDirMode ? ' --dir' : ''}${getElectronBuilderTargetFlag()}`);
