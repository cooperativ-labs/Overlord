import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { withLocalFileLock, writeOwnerOnlyFileAtomically } from '../src/local-file-storage.ts';

test('recovers an abandoned lock and leaves only owner-readable atomic state', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ovld-local-storage-'));
  const directory = path.join(root, 'private-state');
  const target = path.join(directory, 'state.json');
  const lockPath = `${target}.lock`;
  mkdirSync(directory, { recursive: true });
  writeFileSync(lockPath, '{unreadable owner payload}', { mode: 0o644 });
  const old = new Date(Date.now() - 60_000);
  utimesSync(lockPath, old, old);

  withLocalFileLock(
    target,
    () => writeOwnerOnlyFileAtomically(target, JSON.stringify({ complete: true })),
    { timeoutMs: 200, staleAfterMs: 10 }
  );

  assert.equal(existsSync(lockPath), false);
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { complete: true });
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(target).mode & 0o777, 0o600);
});

test('recovers a lock whose recorded owner process no longer exists', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ovld-dead-lock-'));
  const target = path.join(root, 'private-state', 'state.json');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(`${target}.lock`, JSON.stringify({ pid: 2_147_483_647 }));

  const result = withLocalFileLock(target, () => 'acquired', {
    timeoutMs: 200,
    staleAfterMs: 60_000
  });

  assert.equal(result, 'acquired');
  assert.equal(existsSync(`${target}.lock`), false);
});
