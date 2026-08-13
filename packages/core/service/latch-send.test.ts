import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { probeLatchInteractionCapabilities, resolveLatchInput } from './latch-send.ts';

test('reports missing latch send without pretending the prompt was answered', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-latch-send-'));
  const fakeLatch = path.join(tempDir, 'latch');
  writeFileSync(
    fakeLatch,
    `#!/usr/bin/env node
process.stderr.write('unrecognized subcommand send\\n');
process.exit(2);
`
  );
  chmodSync(fakeLatch, 0o700);
  after(() => rmSync(tempDir, { recursive: true, force: true }));

  const capabilities = probeLatchInteractionCapabilities({
    executable: fakeLatch,
    providerSessionId: 'ses_1'
  });
  assert.equal(capabilities.resolve, false);
  assert.equal(capabilities.canSend.ok, false);
  assert.throws(
    () =>
      resolveLatchInput({
        executable: fakeLatch,
        providerSessionId: 'ses_1',
        requestId: 'permission-1',
        choice: 'Allow once'
      }),
    /unrecognized subcommand send|cannot resolve/i
  );
});

test('relays resolve through latch send --resolve when the command exists', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-latch-send-ok-'));
  const fakeLatch = path.join(tempDir, 'latch');
  writeFileSync(
    fakeLatch,
    `#!/usr/bin/env node
const command = process.argv[2];
if (command === 'send' && process.argv.includes('--help')) {
  process.stdout.write('Usage: latch send --resolve id=choice --message --keys\\n');
  process.exit(0);
}
if (command === 'send' && process.argv.includes('--resolve')) {
  process.stdout.write(JSON.stringify({ resolved: true }));
  process.exit(0);
}
process.exit(2);
`
  );
  chmodSync(fakeLatch, 0o700);
  after(() => rmSync(tempDir, { recursive: true, force: true }));

  const capabilities = probeLatchInteractionCapabilities({
    executable: fakeLatch,
    providerSessionId: 'ses_1'
  });
  assert.equal(capabilities.resolve, true);
  assert.equal(capabilities.canSend.ok, true);
  assert.deepEqual(
    resolveLatchInput({
      executable: fakeLatch,
      providerSessionId: 'ses_1',
      requestId: 'permission-1',
      choice: 'Allow once'
    }),
    {
      providerSessionId: 'ses_1',
      requestId: 'permission-1',
      choice: 'Allow once',
      resolved: true
    }
  );
});
