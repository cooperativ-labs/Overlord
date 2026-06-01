#!/usr/bin/env node
/* global Buffer, console, process */
/**
 * Build and upload Electron desktop release artifacts.
 *
 * Default target:
 *   - macOS arm64
 *
 * Examples:
 *   node scripts/upload-electron-release.mjs
 *   node scripts/upload-electron-release.mjs --target linux:amd64 --no-bump
 *   node scripts/upload-electron-release.mjs --platform linux --linux-arch amd64 --no-bump
 *
 * This script bumps the patch version, syncs the CLI package version, builds
 * the requested target, uploads the artifacts to app-downloads/electron/<version>/,
 * and publishes the matching update manifest.
 */

import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { generateDatetimeComponent, parseNewVersion } from '../lib/helpers/cli-versioning.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUCKET = 'app-downloads';
const PREFIX = 'electron';
const RETAIN_VERSION_COUNT = 3;
const DEFAULT_RELEASE_TARGETS = [{ platform: 'mac', arch: 'arm64', publishRootManifest: true }];

const ARTIFACT_PATTERNS = {
  mac: {
    required: (macArch) => [
      { label: 'macOS DMG', pattern: new RegExp(`^Overlord-.*-mac-${macArch}\\.dmg$`) },
      { label: 'macOS ZIP', pattern: new RegExp(`^Overlord-.*-mac-${macArch}\\.zip$`) },
      { label: 'latest-mac.yml', pattern: /^latest-mac\.yml$/ }
    ],
    optional: []
  },
  linux: {
    required: (linuxArch) => [
      {
        label: 'Linux AppImage',
        pattern: new RegExp(
          `^Overlord-.*-linux-${linuxArch === 'x64' ? '(?:x86_64|x64)' : linuxArch}\\.AppImage$`
        )
      },
      { label: 'latest-linux.yml', pattern: /^latest-linux\.yml$/ }
    ],
    optional: (linuxArch) => [
      {
        label: 'Linux .deb',
        pattern: new RegExp(`^Overlord-.*-linux-${linuxArch === 'x64' ? 'amd64' : linuxArch}\\.deb$`)
      }
    ]
  }
};

const VERSION_BUMP = {
  // Hotfix: same datetime, increment x
  patch: (v) => {
    const parsed = parseNewVersion(v);
    if (!parsed) throw new Error(`Invalid version: ${v}`);
    return `${parsed.major}.${parsed.datetime}.${parsed.x + 1}`;
  },
  // Breaking change: increment major, reset datetime and x
  major: (v) => {
    const parsed = parseNewVersion(v);
    if (!parsed) throw new Error(`Invalid version: ${v}`);
    return `${parsed.major + 1}.${generateDatetimeComponent()}.0`;
  },
  // Default release: new datetime, keep major, reset x
  datetime: (v) => {
    const parsed = parseNewVersion(v);
    if (!parsed) throw new Error(`Invalid version: ${v}`);
    return `${parsed.major}.${generateDatetimeComponent()}.0`;
  }
};

function parseDotenv(content) {
  const vars = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
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

function loadEnv() {
  try {
    const envPath = join(ROOT, 'apps', 'web', '.env.prod');
    const content = readFileSync(envPath, 'utf8');
    Object.assign(process.env, parseDotenv(content));
  } catch {
    // apps/web/.env.prod is optional if the required vars already exist in the environment.
  }
}

function getPackageVersion() {
  const pkgPath = join(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

function syncCliPackageVersion(version) {
  const cliPkgPath = join(ROOT, 'packages', 'overlord-cli', 'package.json');
  const cliPkg = JSON.parse(readFileSync(cliPkgPath, 'utf8'));
  if (version !== cliPkg.version) {
    cliPkg.version = version;
    writeFileSync(cliPkgPath, JSON.stringify(cliPkg, null, 2) + '\n', 'utf8');
  }

  return version;
}

function getReleaseArtifacts() {
  const releaseDir = join(ROOT, 'release');
  const files = [];
  try {
    const entries = readdirSync(releaseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        files.push({ path: join(releaseDir, entry.name), name: entry.name });
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return files;
}

function cleanLocalReleaseDir() {
  const releaseDir = join(ROOT, 'release');
  rmSync(releaseDir, { recursive: true, force: true });
}

function validateArtifacts(artifacts, platform, arch) {
  const artifactConfig = ARTIFACT_PATTERNS[platform];
  const requiredArtifacts = artifactConfig.required(arch);
  const optionalArtifacts =
    typeof artifactConfig.optional === 'function'
      ? artifactConfig.optional(arch)
      : artifactConfig.optional;
  const artifactNames = artifacts.map((artifact) => artifact.name);
  const missingRequired = requiredArtifacts.filter(
    ({ pattern }) => !artifactNames.some((name) => pattern.test(name))
  );

  if (missingRequired.length > 0) {
    console.error(`[upload] Release artifacts are incomplete for platform "${platform}".`);
    for (const artifact of missingRequired) {
      console.error(`  Missing required artifact: ${artifact.label}`);
    }
    process.exit(1);
  }

  for (const artifact of optionalArtifacts) {
    if (!artifactNames.some((name) => artifact.pattern.test(name))) {
      console.warn(`[upload] Optional artifact missing: ${artifact.label}`);
    }
  }
}

async function uploadBuffer(supabase, buffer, storagePath) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { upsert: true, contentType: 'application/octet-stream' });
  if (error) throw new Error(`Upload failed ${storagePath}: ${error.message}`);
  return data;
}

async function uploadFile(supabase, filePath, storagePath) {
  return uploadBuffer(supabase, readFileSync(filePath), storagePath);
}

function prefixLatestYamlPaths(content, version) {
  const rewrite = (line, key) => {
    const regex = new RegExp(`^(\\s*(?:-\\s+)?${key}:\\s*)(['"]?)([^'"\\n]+)\\2(\\s*)$`);
    const match = line.match(regex);
    if (!match) return line;
    const [, prefix, quote, value, suffix] = match;
    const trimmed = value.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return line;
    if (trimmed.startsWith(`${version}/`)) return line;
    return `${prefix}${quote}${version}/${trimmed}${quote}${suffix}`;
  };

  return content
    .split('\n')
    .map((line) => rewrite(rewrite(line, 'url'), 'path'))
    .join('\n');
}

function getManifestUploadNames(platform, arch) {
  if (platform === 'mac') {
    return arch === 'arm64' ? ['latest-mac-arm64.yml', 'latest-mac.yml'] : ['latest-mac-x64.yml'];
  }

  return arch === 'x64'
    ? ['latest-linux-amd64.yml', 'latest-linux-x64.yml']
    : ['latest-linux-arm64.yml'];
}

function getRootManifestName(platform) {
  return platform === 'mac' ? 'latest-mac.yml' : 'latest-linux.yml';
}

function getBuildArgs(target) {
  const args = ['scripts/electron-build.mjs', '--platform', target.platform];
  if (target.platform === 'mac') {
    args.push('--mac-arch', target.arch);
  } else {
    args.push('--linux-arch', target.arch);
  }
  return args;
}

function readFlagValue(args, flagName) {
  const inline = args.find((arg) => arg.startsWith(`${flagName}=`));
  if (inline) {
    return inline.slice(flagName.length + 1);
  }

  const index = args.indexOf(flagName);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function readFlagValues(args, flagName) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith(`${flagName}=`)) {
      values.push(arg.slice(flagName.length + 1));
      continue;
    }
    if (arg === flagName && args[i + 1]) {
      values.push(args[i + 1]);
      i += 1;
    }
  }
  return values;
}

function normalizeReleaseTarget(platform, arch) {
  if (platform === 'mac') {
    const normalizedArch = arch || 'arm64';
    if (normalizedArch !== 'arm64' && normalizedArch !== 'x64') {
      console.error(`[upload] Unsupported mac arch: ${normalizedArch}`);
      console.error('         Expected one of: arm64, x64');
      process.exit(1);
    }
    return {
      platform,
      arch: normalizedArch,
      publishRootManifest: normalizedArch === 'arm64'
    };
  }

  if (platform === 'linux') {
    const normalizedArch = arch === 'amd64' || !arch ? 'x64' : arch;
    if (normalizedArch !== 'x64' && normalizedArch !== 'arm64') {
      console.error(`[upload] Unsupported linux arch: ${arch}`);
      console.error('         Expected one of: amd64, x64, arm64');
      process.exit(1);
    }
    return {
      platform,
      arch: normalizedArch,
      publishRootManifest: normalizedArch === 'x64'
    };
  }

  console.error(`[upload] Unsupported platform: ${platform}`);
  console.error('         Expected one of: mac, linux');
  process.exit(1);
}

function parseReleaseTarget(value) {
  const match = value.match(/^([^:/]+)[:/]([^:/]+)$/);
  if (!match) {
    console.error(`[upload] Invalid --target value: ${value}`);
    console.error('         Expected format: mac:arm64, mac:x64, linux:amd64, linux:x64, or linux:arm64');
    process.exit(1);
  }
  return normalizeReleaseTarget(match[1], match[2]);
}

function parseReleaseTargets(args) {
  const targetValues = readFlagValues(args, '--target');
  const requestedPlatform = readFlagValue(args, '--platform');

  if (targetValues.length > 0 && requestedPlatform) {
    console.error('[upload] Use either --target or --platform/--*-arch, not both.');
    process.exit(1);
  }

  if (targetValues.length > 0) {
    return targetValues.map(parseReleaseTarget);
  }

  if (requestedPlatform) {
    const requestedMacArch = readFlagValue(args, '--mac-arch');
    const requestedLinuxArch = readFlagValue(args, '--linux-arch');
    if (requestedPlatform === 'mac' && requestedLinuxArch) {
      console.error('[upload] --linux-arch is only valid with --platform linux.');
      process.exit(1);
    }
    if (requestedPlatform === 'linux' && requestedMacArch) {
      console.error('[upload] --mac-arch is only valid with --platform mac.');
      process.exit(1);
    }
    return [
      normalizeReleaseTarget(
        requestedPlatform,
        requestedPlatform === 'mac' ? requestedMacArch : requestedLinuxArch
      )
    ];
  }

  return DEFAULT_RELEASE_TARGETS;
}

function getTargetLabel(target) {
  const archLabel = target.platform === 'linux' && target.arch === 'x64' ? 'amd64' : target.arch;
  return `${target.platform}/${archLabel}`;
}

function parseBumpMode(args) {
  const hasPatch = args.includes('--patch');
  const hasMajor = args.includes('--major');
  const hasNoBump = args.includes('--no-bump');

  if ([hasPatch, hasMajor, hasNoBump].filter(Boolean).length > 1) {
    console.error('[upload] Choose only one of --patch, --major, or --no-bump.');
    process.exit(1);
  }

  if (hasPatch) return 'patch';
  if (hasMajor) return 'major';
  if (hasNoBump) return 'no-bump';
  return 'datetime';
}

async function buildAndUploadTarget(supabase, version, target) {
  cleanLocalReleaseDir();

  console.log(`[upload] Building ${target.platform} ${target.arch}...`);
  const buildResult = spawnSync('node', getBuildArgs(target), {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env
  });
  if (buildResult.status !== 0) {
    console.error('[upload] Build failed.');
    process.exit(buildResult.status ?? 1);
  }

  const artifacts = getReleaseArtifacts();
  if (artifacts.length === 0) {
    console.error('[upload] No files found in release/.');
    process.exit(1);
  }

  validateArtifacts(artifacts, target.platform, target.arch);

  const versionPrefix = `${PREFIX}/${version}`;
  const rootManifestName = getRootManifestName(target.platform);
  const manifestUploadNames = getManifestUploadNames(target.platform, target.arch);

  console.log(`[upload] Uploading ${artifacts.length} file(s) to ${BUCKET}/${versionPrefix}/...`);

  for (const { path: filePath, name } of artifacts) {
    if (name === rootManifestName) {
      const raw = readFileSync(filePath, 'utf8');
      const normalizedLatestYml = prefixLatestYamlPaths(raw, version);

      for (const manifestName of manifestUploadNames) {
        const storagePath = `${versionPrefix}/${manifestName}`;
        process.stdout.write(`  ${name} -> ${storagePath} ... `);
        try {
          await uploadBuffer(supabase, Buffer.from(normalizedLatestYml, 'utf8'), storagePath);
          console.log('ok');
        } catch (err) {
          console.log('FAIL');
          console.error(err.message);
          process.exit(1);
        }
      }
      continue;
    }

    const storagePath = `${versionPrefix}/${name}`;
    process.stdout.write(`  ${name} -> ${storagePath} ... `);
    try {
      await uploadFile(supabase, filePath, storagePath);
      console.log('ok');
    } catch (err) {
      console.log('FAIL');
      console.error(err.message);
      process.exit(1);
    }
  }

  if (!target.publishRootManifest) {
    return;
  }

  const rootManifestPath = artifacts.find((artifact) => artifact.name === rootManifestName)?.path;
  if (!rootManifestPath) {
    console.error(`[upload] Missing ${rootManifestName} after build.`);
    process.exit(1);
  }

  const raw = readFileSync(rootManifestPath, 'utf8');
  const normalizedLatestYml = prefixLatestYamlPaths(raw, version);
  const storagePath = `${PREFIX}/${rootManifestName}`;
  process.stdout.write(`  ${rootManifestName} -> ${storagePath} ... `);
  try {
    await uploadBuffer(supabase, Buffer.from(normalizedLatestYml, 'utf8'), storagePath);
    console.log('ok');
  } catch (err) {
    console.log('FAIL');
    console.error(err.message);
    process.exit(1);
  }
}

async function pruneOldVersions(supabase) {
  const rootPath = PREFIX;
  const entries = await listStorageEntries(supabase, rootPath);

  const versionDirs = getStoredVersions(entries);

  if (versionDirs.length === 0) {
    console.log(`[upload] No existing versions found in ${BUCKET}/${rootPath}/`);
    return;
  }

  const { sortedVersions, versionsToKeep, versionsToDelete } = getVersionRetentionPlan(versionDirs);
  console.log(`[upload] All versions: ${sortedVersions.join(', ')}`);

  if (versionsToDelete.length === 0) {
    console.log(`[upload] No old versions to prune. Keeping newest ${RETAIN_VERSION_COUNT}.`);
    return;
  }

  console.log(`[upload] Keeping: ${versionsToKeep.join(', ')}`);
  console.log(`[upload] Pruning ${versionsToDelete.length} old version(s): ${versionsToDelete.join(', ')}`);

  for (const version of versionsToDelete) {
    const versionPath = `${PREFIX}/${version}`;
    const filePaths = await listFilePathsRecursively(supabase, versionPath);
    if (filePaths.length > 0) {
      console.log(`[upload] Deleting ${filePaths.length} file(s) from version ${version}...`);
      await removeStoragePaths(supabase, filePaths);
    }
  }
}

function isDirectoryEntry(entry) {
  return entry?.id == null || entry?.metadata == null;
}

function getStoredVersions(entries) {
  return entries
    .filter(isDirectoryEntry)
    .map((entry) => entry.name)
    .filter((name) => parseNewVersion(name) !== null);
}

function compareVersionsDesc(a, b) {
  const pa = parseNewVersion(a);
  const pb = parseNewVersion(b);
  if (pa.major !== pb.major) return pb.major - pa.major;
  if (pa.datetime !== pb.datetime) return pb.datetime > pa.datetime ? 1 : -1;
  return pb.x - pa.x;
}

function getVersionRetentionPlan(versionDirs, retainCount = RETAIN_VERSION_COUNT) {
  const sortedVersions = [...versionDirs].sort(compareVersionsDesc);
  return {
    sortedVersions,
    versionsToKeep: sortedVersions.slice(0, retainCount),
    versionsToDelete: sortedVersions.slice(retainCount)
  };
}

async function listStorageEntries(supabase, path) {
  const entries = [];
  const pageSize = 100;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(path, {
      limit: pageSize,
      offset,
      sortBy: { column: 'name', order: 'asc' }
    });
    if (error) throw new Error(`List failed ${path || '/'}: ${error.message}`);
    if (!data || data.length === 0) break;
    entries.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return entries;
}

async function listFilePathsRecursively(supabase, path) {
  const entries = await listStorageEntries(supabase, path);
  const filePaths = [];

  for (const entry of entries) {
    const childPath = path ? `${path}/${entry.name}` : entry.name;
    if (isDirectoryEntry(entry)) {
      const nestedFilePaths = await listFilePathsRecursively(supabase, childPath);
      filePaths.push(...nestedFilePaths);
      continue;
    }
    filePaths.push(childPath);
  }

  return filePaths;
}

async function removeStoragePaths(supabase, paths) {
  const batchSize = 100;
  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(`Delete failed for ${batch[0]}: ${error.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const bumpMode = parseBumpMode(args);
  const releaseTargets = parseReleaseTargets(args);

  loadEnv();

  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      '[upload] Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).'
    );
    console.error('         Set in .env.prod or the environment.');
    process.exit(1);
  }

  let version = getPackageVersion();
  if (bumpMode === 'no-bump') {
    console.log(`[upload] Using current version ${version} (no bump).`);
  } else {
    const nextVersion = VERSION_BUMP[bumpMode](version);
    console.log(`[upload] Bumping version ${version} -> ${nextVersion} (${bumpMode}).`);

    const pkgPath = join(ROOT, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkg.version = nextVersion;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    version = nextVersion;
  }

  const syncedCliVersion = syncCliPackageVersion(version);
  if (syncedCliVersion === version) {
    console.log(`[upload] Synced packages/overlord-cli/package.json to ${syncedCliVersion}.`);
  } else {
    console.log(
      `[upload] Kept CLI package version at ${syncedCliVersion} while desktop is ${version}.`
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  console.log(
    `[upload] Building and uploading ${releaseTargets.length} release target(s): ${releaseTargets.map(
      (target) => getTargetLabel(target)
    ).join(', ')}`
  );

  for (const target of releaseTargets) {
    await buildAndUploadTarget(supabase, version, target);
  }

  await pruneOldVersions(supabase);

  console.log(
    `[upload] Done. Version ${version} is available at ${supabaseUrl}/storage/v1/object/public/${BUCKET}/${PREFIX}/`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export {
  DEFAULT_RELEASE_TARGETS,
  RETAIN_VERSION_COUNT,
  getManifestUploadNames,
  getTargetLabel,
  getStoredVersions,
  getVersionRetentionPlan,
  isDirectoryEntry,
  parseBumpMode,
  parseReleaseTargets,
  prefixLatestYamlPaths
};
