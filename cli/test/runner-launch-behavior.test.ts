import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeRunnerFailureMessage, shouldRefuseInlineRunnerLaunch } from '../src/commands.ts';

test('headless runners reject only direct inline agent launches', () => {
  assert.equal(
    shouldRefuseInlineRunnerLaunch({
      dryRun: false,
      terminalLauncher: null,
      executionProvider: 'direct',
      stdoutIsTTY: false
    }),
    true
  );
  assert.equal(
    shouldRefuseInlineRunnerLaunch({
      dryRun: false,
      terminalLauncher: 'iTerm2',
      executionProvider: 'direct',
      stdoutIsTTY: false
    }),
    false
  );
  assert.equal(
    shouldRefuseInlineRunnerLaunch({
      dryRun: false,
      terminalLauncher: null,
      executionProvider: 'latch',
      stdoutIsTTY: false
    }),
    false,
    'Latch provides its own PTY and must stay available to the service'
  );
});

test('runner failure messages redact tokens and bound rendered invocations', () => {
  const token = 'out_ab12cd34deadbeefdeadbeefdeadbeefdeadbeef';
  const rendered = sanitizeRunnerFailureMessage(`failed ${token} ${'x'.repeat(1_300)}`);
  assert.match(rendered, /out_ab12cd34…\[redacted\]/);
  assert.ok(!rendered.includes('deadbeef'));
  assert.match(rendered, /\[truncated\]$/);
  assert.ok(rendered.length < 1_250);
});
