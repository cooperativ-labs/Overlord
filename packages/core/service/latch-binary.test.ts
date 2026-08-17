import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, beforeEach } from 'node:test';

import {
  latchBinaryMissingMessage,
  resetLatchBinaryCache,
  resolveLatchBinaryPath
} from './latch-binary.ts';
import { inspectLatchSession, LatchSessionCommandError } from './latch-session.ts';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-latch-binary-'));
const fakeLatch = path.join(tempDir, 'latch');
writeFileSync(
  fakeLatch,
  `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ id: 'ses_1', name: 'mission-shell', state: 'running' }));
`
);
chmodSync(fakeLatch, 0o700);
after(() => rmSync(tempDir, { recursive: true, force: true }));

beforeEach(() => resetLatchBinaryCache());

test('resolves a bare executable name through the discovery resolver', () => {
  const resolved = resolveLatchBinaryPath('latch', name => (name === 'latch' ? fakeLatch : null));
  assert.equal(resolved, fakeLatch);
});

test('memoizes a resolution and revalidates it against the filesystem', () => {
  let calls = 0;
  const resolve = (name: string) => {
    calls += 1;
    return name === 'latch' ? fakeLatch : null;
  };
  assert.equal(resolveLatchBinaryPath('latch', resolve), fakeLatch);
  assert.equal(resolveLatchBinaryPath('latch', resolve), fakeLatch);
  assert.equal(calls, 1);

  // A path that no longer exists is dropped rather than handed back.
  resetLatchBinaryCache();
  const missing = path.join(tempDir, 'gone');
  assert.equal(
    resolveLatchBinaryPath('latch', () => missing),
    missing
  );
  assert.equal(
    resolveLatchBinaryPath('latch', () => null),
    null
  );
});

test('answers null when no Latch binary exists on this device', () => {
  assert.equal(
    resolveLatchBinaryPath('latch', () => null),
    null
  );
  assert.match(latchBinaryMissingMessage('latch'), /Latch executable "latch" was not found/);
});

test('a session command reports the missing binary instead of raising ENOENT', () => {
  assert.throws(
    () =>
      inspectLatchSession({
        executable: path.join(tempDir, 'definitely-not-installed'),
        providerSessionId: 'ses_1'
      }),
    (error: unknown) => {
      assert.ok(error instanceof LatchSessionCommandError);
      assert.match((error as Error).message, /was not found on this device/);
      assert.doesNotMatch((error as Error).message, /ENOENT/);
      return true;
    }
  );
});

test('an absolute executable path is used directly', () => {
  const inspection = inspectLatchSession({ executable: fakeLatch, providerSessionId: 'ses_1' });
  assert.equal(inspection.state, 'running');
  assert.equal(inspection.name, 'mission-shell');
});
