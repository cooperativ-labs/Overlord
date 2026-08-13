import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  collectLatchEvents,
  foldHarnessEvents,
  parseHarnessEvent,
  parseHarnessEventNdjson
} from './latch-events.ts';

const awaiting = {
  sessionId: 'ses_1',
  at: '2026-08-13T10:20:00Z',
  harnessVersion: '2.1.119',
  connectorEpoch: 1,
  type: 'awaiting_input' as const,
  requestId: 'permission-1',
  kind: 'permission' as const,
  prompt: 'Install the test runner',
  choices: ['Allow once', 'Deny']
};

const user = {
  sessionId: 'ses_1',
  at: '2026-08-13T10:00:00Z',
  harnessVersion: '2.1.119',
  connectorEpoch: 1,
  type: 'user_message' as const,
  text: 'Check the build.'
};

const assistant = {
  sessionId: 'ses_1',
  at: '2026-08-13T10:00:01Z',
  harnessVersion: '2.1.119',
  connectorEpoch: 1,
  type: 'assistant_message' as const,
  text: 'I will run the tests.'
};

test('parses the copied Latch awaiting_input contract', () => {
  assert.deepEqual(parseHarnessEvent(awaiting), awaiting);
  assert.equal(parseHarnessEvent({ type: 'awaiting_input', sessionId: 'ses_1' }), null);
});

test('folds turns and pending input from a contiguous suffix', () => {
  const unattached = foldHarnessEvents({
    events: [user, assistant, awaiting],
    fromCursor: 0,
    attached: false
  });
  assert.equal(unattached.cursor, 3);
  assert.equal(unattached.turnCount, 2);
  assert.equal(unattached.unattached, true);
  assert.equal(unattached.pendingInput?.requestId, 'permission-1');

  const cleared = foldHarnessEvents({
    events: [awaiting, assistant],
    fromCursor: 2,
    attached: true
  });
  assert.equal(cleared.pendingInput, null);
  assert.equal(cleared.unattached, false);
});

test('collects NDJSON from latch events and stops after idle', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-latch-events-'));
  const fakeLatch = path.join(tempDir, 'latch');
  writeFileSync(
    fakeLatch,
    `#!/usr/bin/env node
const fromFlag = process.argv.indexOf('--from');
const from = fromFlag >= 0 ? Number(process.argv[fromFlag + 1] || 0) : 0;
const lines = [
  ${JSON.stringify(JSON.stringify(user))},
  ${JSON.stringify(JSON.stringify(assistant))}
];
for (const line of lines.slice(from)) process.stdout.write(line + '\\n');
setTimeout(() => {}, 30_000);
`
  );
  chmodSync(fakeLatch, 0o700);
  after(() => rmSync(tempDir, { recursive: true, force: true }));

  const result = await collectLatchEvents({
    executable: fakeLatch,
    providerSessionId: 'ses_1',
    from: 0,
    idleMs: 50,
    timeoutMs: 2_000
  });
  assert.equal(result.events.length, 2);
  assert.equal(result.nextCursor, 2);
  assert.equal(result.ended, false);
  assert.deepEqual(
    parseHarnessEventNdjson(result.events.map(event => JSON.stringify(event)).join('\n')),
    result.events
  );
});
