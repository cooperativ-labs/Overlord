import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { inspectLatchSession, openLatchSession, stopLatchSession } from './latch-session.ts';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-latch-session-'));
const fakeLatch = path.join(tempDir, 'latch');
writeFileSync(
  fakeLatch,
  `#!/usr/bin/env node
const [command, id, ...args] = process.argv.slice(2);
if (command === 'inspect') {
  process.stdout.write(JSON.stringify({
    id,
    name: 'mission-shell',
    state: 'running',
    exit: null
  }));
} else if (command === 'open') {
  process.stdout.write(JSON.stringify({
    id,
    viewer: args[args.indexOf('--with') + 1],
    opened: true
  }));
} else if (command === 'stop') {
  process.stdout.write(JSON.stringify({ id, state: 'stopping' }));
} else {
  process.exitCode = 2;
}
`
);
chmodSync(fakeLatch, 0o700);

after(() => rmSync(tempDir, { recursive: true, force: true }));

test('inspects bounded Latch terminal-session state', () => {
  const result = inspectLatchSession({
    executable: fakeLatch,
    providerSessionId: 'ses_test'
  });
  assert.equal(result.providerSessionId, 'ses_test');
  assert.equal(result.name, 'mission-shell');
  assert.equal(result.state, 'running');
});

test('opens the stored viewer separately from the session process', () => {
  const result = openLatchSession({
    executable: fakeLatch,
    providerSessionId: 'ses_test',
    viewerKind: 'iterm'
  });
  assert.deepEqual(result, {
    providerSessionId: 'ses_test',
    viewer: 'iterm',
    opened: true
  });
});

test('stops only after an explicit lifecycle call', () => {
  const result = stopLatchSession({
    executable: fakeLatch,
    providerSessionId: 'ses_test'
  });
  assert.deepEqual(result, {
    providerSessionId: 'ses_test',
    state: 'stopping'
  });
});
