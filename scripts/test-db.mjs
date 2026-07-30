#!/usr/bin/env node
// Throwaway PostgreSQL instance for the adapter-conformance batteries.
//
// The Postgres half of every `*.postgres-conformance.test.ts` suite only runs
// when `TEST_DATABASE_URL` points at a reachable Postgres. Nothing about those
// suites needs a durable database: each one creates a random `ovld_test_*`
// schema, migrates into it, and drops it on teardown. So instead of paying for
// an always-on cloud database, this script boots a disposable Postgres that
// lives exactly as long as the test run.
//
// Two backends, auto-detected in this order (override with
// `OVERLORD_TEST_DB_BACKEND=local|docker`):
//
//   local   Real Postgres binaries already on the machine (`initdb`/`pg_ctl`
//           from Homebrew, Postgres.app, a distro package, or the optional
//           `embedded-postgres` dev dependency). A fresh cluster is created in
//           a temp directory with trust auth, `fsync=off`, and no durability
//           guarantees. Starts in ~1s, needs no daemon, and is deleted after.
//   docker  `postgres:<tag>` with its data directory on a tmpfs, so nothing is
//           ever written to disk. Used when no local binaries are available
//           (typical on a CI runner).
//
// Usage:
//   node scripts/test-db.mjs up       # start (or reuse) and print the URL
//   node scripts/test-db.mjs url      # print the URL of a running instance
//   node scripts/test-db.mjs status   # print JSON state
//   node scripts/test-db.mjs down     # stop and delete
//
// Prefer `scripts/with-test-db.mjs <command>` for one-shot test runs; it starts
// an instance, injects `TEST_DATABASE_URL`, and always tears down.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const stateDir = path.join(repoRoot, '.overlord', 'tmp');
const stateFile = path.join(stateDir, 'test-db.json');

const DEFAULT_IMAGE = process.env.OVERLORD_TEST_DB_IMAGE ?? 'postgres:17-alpine';
const READY_TIMEOUT_MS = Number(process.env.OVERLORD_TEST_DB_TIMEOUT_MS ?? 90_000);

// ---- state ----------------------------------------------------------------

function readState() {
  if (!existsSync(stateFile)) return null;
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(state) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function clearState() {
  rmSync(stateFile, { force: true });
}

// ---- helpers --------------------------------------------------------------

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function commandExists(command) {
  return run('sh', ['-c', `command -v ${command}`]).status === 0;
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Resolve the first directory containing `initdb` from a list of patterns. A
// pattern may contain one `*` path segment (e.g. `/usr/lib/postgresql/*/bin`),
// in which case the highest-sorting match wins so the newest installed major
// version is preferred. Exported so it can be exercised directly.
export function firstExistingBinDir(patterns) {
  for (const pattern of patterns) {
    const [prefix, suffix] = pattern.split('*');
    if (suffix === undefined) {
      if (existsSync(path.join(prefix, 'initdb'))) return prefix;
      continue;
    }
    const parent = path.dirname(prefix);
    const namePrefix = path.basename(prefix);
    if (!existsSync(parent)) continue;
    const matches = readdirSync(parent)
      .filter(entry => entry.startsWith(namePrefix))
      .sort()
      .reverse();
    for (const match of matches) {
      const candidate = path.join(parent, match, suffix.replace(/^\/+/, ''));
      if (existsSync(path.join(candidate, 'initdb'))) return candidate;
    }
  }
  return null;
}

/**
 * Locate `initdb`/`pg_ctl`. PATH wins, then the usual per-platform install
 * locations, then the binaries shipped by the optional `embedded-postgres`
 * dependency (`@embedded-postgres/<platform>-<arch>`), which is how a machine
 * with no system Postgres still gets the fast local backend.
 */
function resolvePostgresBinDir() {
  const override = process.env.OVERLORD_TEST_PG_BIN?.trim();
  if (override) {
    if (!existsSync(path.join(override, 'initdb'))) {
      throw new Error(`OVERLORD_TEST_PG_BIN does not contain initdb: ${override}`);
    }
    return override;
  }
  if (commandExists('initdb') && commandExists('pg_ctl')) return '';

  const embedded = path.join(
    repoRoot,
    'node_modules',
    '@embedded-postgres',
    `${process.platform}-${process.arch}`,
    'native',
    'bin'
  );
  return firstExistingBinDir([
    '/opt/homebrew/opt/postgresql@*/bin',
    '/usr/local/opt/postgresql@*/bin',
    '/Applications/Postgres.app/Contents/Versions/*/bin',
    '/usr/lib/postgresql/*/bin',
    embedded
  ]);
}

function bin(binDir, name) {
  return binDir ? path.join(binDir, name) : name;
}

async function waitUntilReady(url, deadlineMs) {
  const { default: pg } = await import('pg');
  const deadline = Date.now() + deadlineMs;
  let lastError;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2_000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});
      await delay(250);
    }
  }
  throw new Error(
    `test database did not become ready within ${deadlineMs}ms: ${lastError?.message ?? 'unknown error'}`
  );
}

// ---- local cluster backend ------------------------------------------------

async function startLocal(binDir) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ovld-test-pg-'));
  const init = run(bin(binDir, 'initdb'), [
    '-D',
    path.join(dataDir, 'data'),
    '-U',
    'postgres',
    '--auth=trust',
    '--encoding=UTF8',
    '--no-locale',
    '--no-sync'
  ]);
  if (init.status !== 0) {
    rmSync(dataDir, { recursive: true, force: true });
    throw new Error(`initdb failed: ${init.stderr || init.stdout}`);
  }

  const port = await freePort();
  // `fsync=off` / `full_page_writes=off` are unsafe for real data and exactly
  // right for a cluster that is deleted a few seconds from now.
  const started = run(bin(binDir, 'pg_ctl'), [
    '-D',
    path.join(dataDir, 'data'),
    '-l',
    path.join(dataDir, 'server.log'),
    '-o',
    `-p ${port} -h 127.0.0.1 -k ${dataDir} -c fsync=off -c full_page_writes=off -c synchronous_commit=off`,
    '-w',
    '-t',
    String(Math.ceil(READY_TIMEOUT_MS / 1000)),
    'start'
  ]);
  if (started.status !== 0) {
    const log = existsSync(path.join(dataDir, 'server.log'))
      ? readFileSync(path.join(dataDir, 'server.log'), 'utf8')
      : '';
    rmSync(dataDir, { recursive: true, force: true });
    throw new Error(`pg_ctl start failed: ${started.stderr || started.stdout}\n${log}`);
  }

  const url = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  await waitUntilReady(url, READY_TIMEOUT_MS);
  return { backend: 'local', binDir, dataDir, port, url };
}

function stopLocal(state) {
  const dataDir = path.join(state.dataDir, 'data');
  if (existsSync(dataDir)) {
    run(bin(state.binDir, 'pg_ctl'), ['-D', dataDir, '-m', 'immediate', '-w', 'stop']);
  }
  rmSync(state.dataDir, { recursive: true, force: true });
}

// ---- docker backend -------------------------------------------------------

async function startDocker() {
  const port = await freePort();
  const created = run('docker', [
    'run',
    '--detach',
    '--rm',
    '--publish',
    `127.0.0.1:${port}:5432`,
    '--env',
    'POSTGRES_PASSWORD=postgres',
    '--env',
    'POSTGRES_DB=postgres',
    // Data on tmpfs: nothing touches the host disk and teardown is free.
    '--tmpfs',
    '/var/lib/postgresql/data',
    DEFAULT_IMAGE,
    '-c',
    'fsync=off',
    '-c',
    'full_page_writes=off',
    '-c',
    'synchronous_commit=off'
  ]);
  if (created.status !== 0) {
    throw new Error(`docker run failed: ${created.stderr || created.stdout}`);
  }
  const containerId = created.stdout.trim();
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
  try {
    await waitUntilReady(url, READY_TIMEOUT_MS);
  } catch (error) {
    run('docker', ['rm', '--force', containerId]);
    throw error;
  }
  return { backend: 'docker', containerId, port, url, image: DEFAULT_IMAGE };
}

function stopDocker(state) {
  run('docker', ['rm', '--force', state.containerId]);
}

// ---- public API -----------------------------------------------------------

function isRunning(state) {
  if (!state) return false;
  if (state.backend === 'docker') {
    const inspect = run('docker', ['inspect', '--format', '{{.State.Running}}', state.containerId]);
    return inspect.status === 0 && inspect.stdout.trim() === 'true';
  }
  return (
    existsSync(path.join(state.dataDir, 'data')) &&
    run(bin(state.binDir, 'pg_ctl'), ['-D', path.join(state.dataDir, 'data'), 'status']).status ===
      0
  );
}

function selectBackend() {
  const requested = process.env.OVERLORD_TEST_DB_BACKEND?.trim();
  if (requested === 'local') {
    const binDir = resolvePostgresBinDir();
    if (binDir === null) throw new Error('OVERLORD_TEST_DB_BACKEND=local but no initdb was found.');
    return { backend: 'local', binDir };
  }
  if (requested === 'docker') return { backend: 'docker' };
  if (requested) throw new Error(`unknown OVERLORD_TEST_DB_BACKEND: ${requested}`);

  const binDir = resolvePostgresBinDir();
  if (binDir !== null) return { backend: 'local', binDir };
  if (commandExists('docker')) return { backend: 'docker' };
  throw new Error(
    'No test-database backend available. Install Postgres (brew install postgresql@17), ' +
      'run `yarn add -D embedded-postgres` for a self-contained copy, or start Docker.'
  );
}

/** Start a throwaway Postgres, or reuse the one this repo already started. */
export async function startTestDatabase() {
  const existing = readState();
  if (isRunning(existing)) return { ...existing, reused: true };
  if (existing) clearState();

  const selected = selectBackend();
  const state =
    selected.backend === 'local' ? await startLocal(selected.binDir) : await startDocker();
  writeState(state);
  return { ...state, reused: false };
}

/** Stop and delete the throwaway Postgres recorded in the state file. */
export function stopTestDatabase() {
  const state = readState();
  if (!state) return false;
  if (state.backend === 'docker') stopDocker(state);
  else stopLocal(state);
  clearState();
  return true;
}

export function getTestDatabaseState() {
  const state = readState();
  if (!state) return null;
  return { ...state, running: isRunning(state) };
}

// ---- CLI ------------------------------------------------------------------

async function main() {
  const command = process.argv[2] ?? 'up';
  switch (command) {
    case 'up': {
      const state = await startTestDatabase();
      process.stderr.write(
        `${state.reused ? 'reusing' : 'started'} ${state.backend} test database on port ${state.port}\n`
      );
      process.stdout.write(`${state.url}\n`);
      return;
    }
    case 'url': {
      const state = getTestDatabaseState();
      if (!state?.running) throw new Error('no test database is running (run `yarn db:test:up`).');
      process.stdout.write(`${state.url}\n`);
      return;
    }
    case 'status': {
      process.stdout.write(`${JSON.stringify(getTestDatabaseState(), null, 2)}\n`);
      return;
    }
    case 'down': {
      process.stderr.write(stopTestDatabase() ? 'test database removed\n' : 'nothing to remove\n');
      return;
    }
    default:
      throw new Error(`usage: test-db.mjs <up|url|status|down> (got: ${command})`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
}
