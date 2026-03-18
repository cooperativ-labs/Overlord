#!/usr/bin/env node
/**
 * Bump package version (semver), build the Electron app, and upload artifacts
 * to the app-downloads storage bucket under electron/<version>/.
 *
 * Requires: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY
 * (or SUPABASE_SECRET_KEY). Load from .env.prod or set in the environment.
 *
 * Usage:
 *   node scripts/upload-electron-release.mjs                  # bump patch, build host platform, upload
 *   node scripts/upload-electron-release.mjs --minor          # bump minor
 *   node scripts/upload-electron-release.mjs --major          # bump major
 *   node scripts/upload-electron-release.mjs --no-bump        # use current version
 *   node scripts/upload-electron-release.mjs --platform mac   # only require/upload macOS artifacts
 *   node scripts/upload-electron-release.mjs --platform linux # only require/upload Linux artifacts
 */

import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import semver from 'semver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUCKET = 'app-downloads';
const PREFIX = 'electron';
const ARTIFACT_PATTERNS = {
  mac: {
    required: [
      { label: 'macOS DMG', pattern: /^Overlord-.*-mac-arm64\.dmg$/ },
      { label: 'macOS ZIP', pattern: /^Overlord-.*-mac-arm64\.zip$/ },
      { label: 'latest-mac.yml', pattern: /^latest-mac\.yml$/ }
    ],
    optional: []
  },
  linux: {
    required: [
      { label: 'Linux AppImage', pattern: /^Overlord-.*-linux-x64\.AppImage$/ },
      { label: 'latest-linux.yml', pattern: /^latest-linux\.yml$/ }
    ],
    optional: [{ label: 'Linux .deb', pattern: /^Overlord-.*-linux-amd64\.deb$/ }]
  }
};

const VERSION_BUMP = {
  patch: (v) => {
    const [major, minor, patch] = v.split('.').map(Number);
    return `${major}.${minor}.${(patch || 0) + 1}`;
  },
  minor: (v) => {
    const [major, minor] = v.split('.').map(Number);
    return `${major}.${(minor || 0) + 1}.0`;
  },
  major: (v) => {
    const [major] = v.split('.').map(Number);
    return `${(major || 0) + 1}.0.0`;
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
    const envPath = join(ROOT, '.env.prod');
    const content = readFileSync(envPath, 'utf8');
    Object.assign(process.env, parseDotenv(content));
  } catch {
    // .env.prod optional if vars already set
  }
}

function getPackageVersion() {
  const pkgPath = join(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

function readFlagValue(args, flagName) {
  const inline = args.find(arg => arg.startsWith(`${flagName}=`));
  if (inline) {
    return inline.slice(flagName.length + 1);
  }

  const index = args.indexOf(flagName);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function detectDefaultPlatform() {
  const hostPlatform = os.platform();
  if (hostPlatform === 'darwin') return 'mac';
  if (hostPlatform === 'linux') return 'linux';

  console.error(`[upload] Unsupported host platform: ${hostPlatform}`);
  console.error('         Pass --platform mac or --platform linux explicitly.');
  process.exit(1);
}

function parsePlatform(args) {
  const explicitPlatform = readFlagValue(args, '--platform');
  if (!explicitPlatform) return detectDefaultPlatform();

  if (explicitPlatform === 'mac' || explicitPlatform === 'linux') {
    return explicitPlatform;
  }

  console.error(`[upload] Unsupported --platform value: ${explicitPlatform}`);
  console.error('         Expected one of: mac, linux');
  process.exit(1);
}

function getReleaseArtifacts() {
  const releaseDir = join(ROOT, 'release');
  const files = [];
  try {
    const entries = readdirSync(releaseDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile()) {
        files.push({ path: join(releaseDir, e.name), name: e.name });
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

function validateArtifacts(artifacts, platform) {
  const artifactConfig = ARTIFACT_PATTERNS[platform];
  const artifactNames = artifacts.map(artifact => artifact.name);
  const missingRequired = artifactConfig.required.filter(
    ({ pattern }) => !artifactNames.some(name => pattern.test(name))
  );

  if (missingRequired.length > 0) {
    console.error(`[upload] Release artifacts are incomplete for platform "${platform}".`);
    for (const artifact of missingRequired) {
      console.error(`  Missing required artifact: ${artifact.label}`);
    }
    process.exit(1);
  }

  for (const artifact of artifactConfig.optional) {
    if (!artifactNames.some(name => artifact.pattern.test(name))) {
      console.warn(`[upload] Optional artifact missing: ${artifact.label}`);
    }
  }
}

async function uploadFile(supabase, filePath, storagePath) {
  const buffer = readFileSync(filePath);
  return uploadBuffer(supabase, buffer, storagePath);
}

async function uploadBuffer(supabase, buffer, storagePath) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { upsert: true, contentType: 'application/octet-stream' });
  if (error) throw new Error(`Upload failed ${storagePath}: ${error.message}`);
  return data;
}

function isDirectoryEntry(entry) {
  return entry?.id == null || entry?.metadata == null;
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

async function pruneOldVersions(supabase) {
  const rootPath = PREFIX;
  const entries = await listStorageEntries(supabase, rootPath);
  
  // Filter for directories that are valid semver
  const versionDirs = entries
    .filter(isDirectoryEntry)
    .map(e => e.name)
    .filter(name => semver.valid(name));

  if (versionDirs.length === 0) {
    console.log(`[upload] No existing versions found in ${BUCKET}/${rootPath}/`);
    return;
  }

  // Sort versions descending (newest first)
  const sortedVersions = versionDirs.sort(semver.rcompare);
  console.log(`[upload] All versions: ${sortedVersions.join(', ')}`);

  // Keep top 3 (current + 2 previous)
  const versionsToKeep = sortedVersions.slice(0, 3);
  const versionsToDelete = sortedVersions.slice(3);

  if (versionsToDelete.length === 0) {
    console.log('[upload] No old versions to prune.');
    return;
  }

  console.log(`[upload] Keeping: ${versionsToKeep.join(', ')}`);
  console.log(`[upload] Pruning ${versionsToDelete.length} old version(s): ${versionsToDelete.join(', ')}`);

  for (const v of versionsToDelete) {
    const versionPath = `${PREFIX}/${v}`;
    const filePaths = await listFilePathsRecursively(supabase, versionPath);
    if (filePaths.length > 0) {
      console.log(`[upload] Deleting ${filePaths.length} file(s) from version ${v}...`);
      await removeStoragePaths(supabase, filePaths);
    }
  }
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

async function main() {
  const args = process.argv.slice(2);
  const noBump = args.includes('--no-bump');
  const bumpType = args.includes('--major') ? 'major' : args.includes('--minor') ? 'minor' : 'patch';
  const targetPlatform = parsePlatform(args);

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

  console.log(`[upload] Target platform: ${targetPlatform}`);

  let version = getPackageVersion();

  if (!noBump) {
    const next = VERSION_BUMP[bumpType](version);
    console.log(`[upload] Bumping version ${version} -> ${next} (${bumpType})`);
    const pkgPath = join(ROOT, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkg.version = next;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    version = next;
  } else {
    console.log(`[upload] Using current version ${version} (no bump).`);
  }

  console.log('[upload] Cleaning local release directory...');
  cleanLocalReleaseDir();

  console.log('[upload] Running Electron build...');
  const { spawnSync } = await import('node:child_process');
  const buildResult = spawnSync('node', ['scripts/electron-build.mjs', '--platform', targetPlatform], {
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
  validateArtifacts(artifacts, targetPlatform);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const versionPrefix = `${PREFIX}/${version}`;
  console.log(`[upload] Uploading ${artifacts.length} file(s) to ${BUCKET}/${versionPrefix}/...`);

  for (const { path: filePath, name } of artifacts) {
    const storagePath = `${versionPrefix}/${name}`;
    process.stdout.write(`  ${name} ... `);
    try {
      await uploadFile(supabase, filePath, storagePath);
      console.log('ok');
    } catch (e) {
      console.log('FAIL');
      console.error(e.message);
      process.exit(1);
    }
  }

  // Upload latest*.yml to electron/ (no version prefix) for electron-updater
  const latestManifestPattern =
    targetPlatform === 'mac' ? /^latest-mac\.yml$/ : /^latest-linux\.yml$/;
  const latestYml = artifacts.filter((artifact) => latestManifestPattern.test(artifact.name));
  for (const { path: filePath, name } of latestYml) {
    const storagePath = `${PREFIX}/${name}`;
    const latestYml = readFileSync(filePath, 'utf8');
    const normalizedLatestYml = prefixLatestYamlPaths(latestYml, version);
    process.stdout.write(`  ${name} -> ${storagePath} ... `);
    try {
      await uploadBuffer(supabase, Buffer.from(normalizedLatestYml, 'utf8'), storagePath);
      console.log('ok');
    } catch (e) {
      console.log('FAIL');
      console.error(e.message);
      process.exit(1);
    }
  }

  await pruneOldVersions(supabase);

  console.log(`[upload] Done. Version ${version} is available at ${supabaseUrl}/storage/v1/object/public/${BUCKET}/${PREFIX}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
