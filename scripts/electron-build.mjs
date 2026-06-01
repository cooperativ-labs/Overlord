#!/usr/bin/env node
/* global console, process */
/**
 * Unified Electron production build script.
 *
 * Why this exists:
 *   NEXT_PUBLIC_* variables (Supabase URL, publishable key, site URL) are baked
 *   into hosted Next.js client bundles at build time — they are NOT
 *   runtime-patchable by the Electron app.
 *
 *   This script reads `apps/web/.env.prod`, generates
 *   `apps/desktop/electron/_prod-env.generated.ts` for
 *   the main-process runtime patch, then packages only the Electron shell and
 *   bundled agent resources. The desktop runtime loads the configured platform URL
 *   instead of embedding a standalone Next.js server.
 *
 * Usage:
 *   node scripts/electron-build.mjs                       → build for the current host platform
 *   node scripts/electron-build.mjs --platform mac       → build macOS artifacts
 *   node scripts/electron-build.mjs --platform mac --mac-arch x64
 *                                                     → build Intel macOS artifacts
 *   node scripts/electron-build.mjs --platform mac --mac-arch arm64
 *                                                     → build Apple Silicon macOS artifacts
 *   node scripts/electron-build.mjs --platform linux     → build Linux artifacts
 *   node scripts/electron-build.mjs --platform linux --linux-arch amd64
 *                                                     → build Linux amd64 artifacts
 *   node scripts/electron-build.mjs --platform linux --linux-arch arm64
 *                                                     → build Linux ARM64 artifacts
 *   node scripts/electron-build.mjs --dir                → build + unpackaged app dir only
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pickRuntimeEnv } from './electron-runtime-allowlist.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const isDirMode = process.argv.includes('--dir');
const electronBuilderTargetFlag = getElectronBuilderTargetFlag();

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

  if (requestedLinuxArch === 'amd64') return ' --x64';
  if (requestedLinuxArch === 'x64') return ' --x64';
  if (requestedLinuxArch === 'arm64') return ' --arm64';

  console.error(`\x1b[31m[build] Unsupported --linux-arch value: ${requestedLinuxArch}\x1b[0m`);
  console.error('       Expected one of: amd64, x64, arm64');
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

function commandExists(commandName) {
  const result = spawnSync('sh', ['-lc', `command -v ${commandName}`], {
    stdio: 'ignore'
  });
  return result.status === 0;
}

function ensureLinuxPackagingTools() {
  const missing = [
    ['ar', 'binutils'],
    ['gzip', 'gzip']
  ].filter(([commandName]) => !commandExists(commandName));

  if (missing.length === 0) return;

  console.error('\x1b[31m[build] Missing Linux packaging tool(s):\x1b[0m');
  for (const [commandName, packageName] of missing) {
    console.error(`       ${commandName} (install package: ${packageName})`);
  }
  console.error('       Debian package generation requires these tools.');
  process.exit(1);
}

function isLinuxPackagingRequested() {
  const requestedPlatform = readFlagValue('--platform');
  if (requestedPlatform === 'linux') return true;
  if (requestedPlatform) return false;
  return process.platform === 'linux';
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
// Step 5 — Bundle Electron main-process with esbuild
// ---------------------------------------------------------------------------

run(
  "npx esbuild apps/desktop/electron/main.ts --bundle --platform=node --target=node20 --outfile=apps/desktop/dist-electron/main.js --external:electron '--external:*.node' --format=cjs --sourcemap"
);
run(
  "npx esbuild apps/desktop/electron/preload.ts --bundle --platform=node --target=node20 --outfile=apps/desktop/dist-electron/preload.js --external:electron '--external:*.node' --format=cjs --sourcemap"
);

// ---------------------------------------------------------------------------
// Step 6 — electron-builder
// ---------------------------------------------------------------------------

if (!isDirMode && isLinuxPackagingRequested()) {
  ensureLinuxPackagingTools();
}

run(
  `yarn electron-builder --config apps/desktop/electron-builder.yml${isDirMode ? ' --dir' : ''}${electronBuilderTargetFlag}`
);

// ---------------------------------------------------------------------------
// Step 7 — Re-sign .app bundles on macOS (fixes Invalid Page crash on macOS 15+)
// ---------------------------------------------------------------------------

if (process.platform === 'darwin') {
  const releaseDir = resolve(ROOT, 'release');
  const macDirs = ['mac-arm64', 'mac', 'mac-x64']
    .map(name => join(releaseDir, name))
    .filter(dir => {
      try { return readdirSync(dir).includes('Overlord.app'); } catch { return false; }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  for (const dir of macDirs) {
    const appPath = join(dir, 'Overlord.app');
    run(`codesign --force --deep --sign - "${appPath}"`);
  }
}
