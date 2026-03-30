#!/usr/bin/env node
/* global console */

/**
 * Syncs the CLI package version with the app version.
 *
 * CLI source files now live canonically in packages/overlord-cli/bin/_cli/,
 * so no file copying is needed. This script only ensures the CLI package
 * version stays aligned with the app version (matching major.minor).
 */

import { readFileSync, writeFileSync } from 'node:fs';
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

const syncedVersion = syncCliVersion();
console.log(`[cli:sync] CLI package version is ${syncedVersion}.`);
