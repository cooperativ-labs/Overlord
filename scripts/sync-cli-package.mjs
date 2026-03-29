#!/usr/bin/env node
/* global console */

import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  cliPkg.version = appPkg.version;
  writeJson(cliPkgPath, cliPkg);

  return cliPkg.version;
}

function syncCliFiles() {
  const sourceRoot = join(ROOT, 'bin');
  const targetRoot = join(CLI_PACKAGE_ROOT, 'bin');
  const targetCliDir = join(targetRoot, '_cli');

  mkdirSync(targetCliDir, { recursive: true });
  copyFileSync(join(sourceRoot, 'ovld.mjs'), join(targetRoot, 'ovld.mjs'));

  for (const entry of readdirSync(join(sourceRoot, '_cli'))) {
    if (!entry.endsWith('.mjs')) continue;
    copyFileSync(join(sourceRoot, '_cli', entry), join(targetCliDir, entry));
  }
}

const syncedVersion = syncCliVersion();
syncCliFiles();

console.log(`[cli:sync] Synced CLI package files and set version to ${syncedVersion}.`);
