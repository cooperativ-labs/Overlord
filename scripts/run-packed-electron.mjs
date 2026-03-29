#!/usr/bin/env node
/* global console, process */

import { readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const releaseDir = join(ROOT, 'release');

const candidateDirs = ['mac-arm64', 'mac', 'mac-x64']
  .map(name => join(releaseDir, name))
  .filter(dir => {
    try {
      return readdirSync(dir).includes('Overlord.app');
    } catch {
      return false;
    }
  })
  .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

const appDir = candidateDirs[0];
if (!appDir) {
  console.error(
    '[electron:pack:run] No packaged macOS app found in release/. Run an Electron pack command first.'
  );
  process.exit(1);
}

const binaryPath = join(appDir, 'Overlord.app', 'Contents', 'MacOS', 'Overlord');
const child = spawn(binaryPath, {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit'
});

child.on('exit', code => {
  process.exit(code ?? 0);
});
