import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runRunnerOnce,
  sanitizeRunnerFailureMessage,
  shouldRefuseInlineRunnerLaunch
} from '../src/commands.ts';

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

test('osascript timeout failure is reported in full so the supervisor can continue', () => {
  const message =
    'osascript/Apple Event timed out after 45s while opening iTerm2. ' +
    'The execution request failed so the runner can keep claiming. ' +
    'iTerm2 may still open after this timeout (orphan window).';
  assert.equal(sanitizeRunnerFailureMessage(message), message);
});

test('missing-session inspection reports its typed result without a supervisor error or launch', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'runner-absent-'));
  const executable = join(directory, 'latch');
  writeFileSync(executable, "#!/bin/sh\nprintf 'Error: no session `ses_gone`\\n' >&2\nexit 1\n", {
    mode: 0o700
  });
  const calls: Array<{ path: string; body?: unknown }> = [];
  const runtime = {
    close() {},
    backend: {
      async post(input: { path: string; body?: unknown }) {
        calls.push(input);
        if (input.path === '/api/runner/claim')
          return {
            longPoll: true,
            request: {
              id: 'inspection',
              metadata: {
                'overlord.localTargetMutation': {
                  kind: 'capability_call',
                  capability: 'inspectLatchSession',
                  input: { executable, providerSessionId: 'ses_gone' }
                }
              }
            }
          };
        return {};
      }
    }
  } as unknown as Parameters<typeof runRunnerOnce>[0]['runtime'];
  try {
    const result = await runRunnerOnce({
      runtime,
      parsed: { positional: [], flags: new Map() },
      json: true
    });
    assert.deepEqual(result, { launched: false, longPoll: true, processed: true });
    assert.deepEqual(
      calls.map(call => call.path),
      [
        '/api/runner/claim',
        '/api/runner/requests/inspection/launching',
        '/api/runner/requests/inspection/completed'
      ]
    );
    const body = calls[2]!.body as { mutationResult: { ok: boolean; code: string } };
    assert.equal(body.mutationResult.ok, false);
    assert.equal(body.mutationResult.code, 'LATCH_SESSION_ABSENT');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
