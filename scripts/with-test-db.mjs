#!/usr/bin/env node
// Run a command with `TEST_DATABASE_URL` pointing at a throwaway Postgres, so
// the Postgres half of the adapter-conformance batteries executes instead of
// printing its SKIP line.
//
// Usage: node scripts/with-test-db.mjs <command> [args...]
//
// - If `TEST_DATABASE_URL` is already exported (a Neon test branch, a CI service
//   container, a long-lived `yarn db:test:up` instance), that URL is used as-is
//   and nothing is started or stopped.
// - Otherwise a disposable instance is started (see `scripts/test-db.mjs`) and
//   torn down when the command exits — including on Ctrl-C — unless it was
//   already running, in which case it is left for the next run.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startTestDatabase, stopTestDatabase } from './test-db.mjs';

const [, , command, ...args] = process.argv;
if (!command) {
  process.stderr.write('usage: with-test-db.mjs <command> [args...]\n');
  process.exit(2);
}

const inherited = process.env.TEST_DATABASE_URL?.trim();
let url = inherited;
let ownsInstance = false;

if (!inherited) {
  try {
    const state = await startTestDatabase();
    url = state.url;
    ownsInstance = !state.reused;
    process.stderr.write(
      `[with-test-db] ${state.reused ? 'reusing' : 'started'} ${state.backend} Postgres on port ${state.port}\n`
    );
  } catch (error) {
    process.stderr.write(
      `[with-test-db] ${error instanceof Error ? error.message : error}\n` +
        '[with-test-db] running without TEST_DATABASE_URL: Postgres batteries will report SKIP.\n'
    );
  }
} else {
  process.stderr.write('[with-test-db] using the TEST_DATABASE_URL already in the environment\n');
}

let cleanedUp = false;
function cleanUp() {
  if (cleanedUp || !ownsInstance) return;
  cleanedUp = true;
  try {
    stopTestDatabase();
  } catch (error) {
    process.stderr.write(
      `[with-test-db] teardown failed: ${error instanceof Error ? error.message : error}\n`
    );
  }
}

const child = spawn(command, args, {
  stdio: 'inherit',
  env: url ? { ...process.env, TEST_DATABASE_URL: url } : process.env,
  cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
});

child.on('error', error => {
  cleanUp();
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  cleanUp();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
process.on('exit', cleanUp);
