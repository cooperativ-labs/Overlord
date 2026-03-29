#!/usr/bin/env node
/* global console */

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CLI_PACKAGE_ROOT = join(ROOT, 'packages', 'overlord-cli');
const README_PATH = join(CLI_PACKAGE_ROOT, 'README.md');

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd ?? ROOT,
    stdio: 'inherit'
  });
}

if (!existsSync(README_PATH)) {
  console.error(
    '[cli:publish] Missing packages/overlord-cli/README.md. Add the npm page README before publishing.'
  );
  process.exit(1);
}

run('node', ['scripts/sync-cli-package.mjs']);
run('npm', ['publish', '--access', 'public'], { cwd: CLI_PACKAGE_ROOT });

console.log('[cli:publish] Published overlord-cli to npm.');
