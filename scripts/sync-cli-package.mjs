#!/usr/bin/env node
/* global console */

import {
  cpSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveCliVersion } from '../lib/helpers/cli-versioning.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CLI_PACKAGE_ROOT = join(ROOT, 'packages', 'overlord-cli');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function syncCliVersion() {
  const appPkgPath = join(ROOT, 'package.json');
  const cliPkgPath = join(CLI_PACKAGE_ROOT, 'package.json');
  const appPkg = readJson(appPkgPath);
  const cliPkg = readJson(cliPkgPath);
  const nextVersion = deriveCliVersion(appPkg.version, cliPkg.version);

  if (nextVersion !== cliPkg.version) {
    cliPkg.version = nextVersion;
    writeJson(cliPkgPath, cliPkg);
  }

  return cliPkg.version;
}

function syncCliFiles() {
  const sourceRoot = join(ROOT, 'bin');
  const targetRoot = join(CLI_PACKAGE_ROOT, 'bin');
  const targetCliDir = join(targetRoot, '_cli');
  const sourcePluginDir = join(ROOT, 'plugins', 'overlord');
  const targetPluginDir = join(CLI_PACKAGE_ROOT, 'plugins', 'overlord');

  mkdirSync(targetCliDir, { recursive: true });
  copyFileSync(join(sourceRoot, 'ovld.mjs'), join(targetRoot, 'ovld.mjs'));

  for (const entry of readdirSync(join(sourceRoot, '_cli'))) {
    if (!entry.endsWith('.mjs') || entry === 'setup.mjs') continue;
    copyFileSync(join(sourceRoot, '_cli', entry), join(targetCliDir, entry));
  }

  rmSync(targetPluginDir, { recursive: true, force: true });
  mkdirSync(join(CLI_PACKAGE_ROOT, 'plugins'), { recursive: true });
  cpSync(sourcePluginDir, targetPluginDir, { recursive: true });
}

const syncedVersion = syncCliVersion();
syncCliFiles();

console.log(`[cli:sync] Synced CLI package files; version is ${syncedVersion}.`);
