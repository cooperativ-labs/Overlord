#!/usr/bin/env node
/**
 * Bump package version (semver), build the Electron app, and upload artifacts
 * to the app-downloads storage bucket under electron/<version>/.
 *
 * Requires: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY
 * (or SUPABASE_SECRET_KEY). Load from .env.prod or set in the environment.
 *
 * Usage:
 *   node scripts/upload-electron-release.mjs           # bump patch, build, upload
 *   node scripts/upload-electron-release.mjs --minor   # bump minor
 *   node scripts/upload-electron-release.mjs --major   # bump major
 *   node scripts/upload-electron-release.mjs --no-bump # use current version, build, upload
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUCKET = 'app-downloads';
const PREFIX = 'electron';

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

  console.log('[upload] Running Electron build...');
  const { spawnSync } = await import('node:child_process');
  const buildResult = spawnSync('node', ['scripts/electron-build.mjs'], {
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
  const latestYml = artifacts.filter((a) => a.name.startsWith('latest') && a.name.endsWith('.yml'));
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

  console.log(`[upload] Done. Version ${version} is available at ${supabaseUrl}/storage/v1/object/public/${BUCKET}/${PREFIX}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
