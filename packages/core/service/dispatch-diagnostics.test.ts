import assert from 'node:assert/strict';
import test from 'node:test';

import { runQueueDiagnosticCode, sanitizeDispatchFailure } from './dispatch-diagnostics.ts';

test('sanitizes, bounds, and preserves actionable dispatch failure detail', () => {
  const detail = sanitizeDispatchFailure(
    'Target not authorized: token=out_12345678abcdefghijklmnopqrstuvwxyz',
    40
  );
  assert.ok(detail);
  assert.match(detail, /Target not authorized/);
  assert.doesNotMatch(detail, /abcdefghijklmnopqrstuvwxyz/);
  assert.ok(detail.length <= 40);
});

test('detects impossible Run Queue and execution-request state pairs', () => {
  assert.equal(
    runQueueDiagnosticCode({
      entryState: 'dispatched',
      requestStatus: 'failed',
      launchedSessionId: null
    }),
    'terminal_request_dispatched'
  );
  assert.equal(
    runQueueDiagnosticCode({ entryState: 'running', requestStatus: null, launchedSessionId: null }),
    'running_without_live_request'
  );
  assert.equal(
    runQueueDiagnosticCode({
      entryState: 'running',
      requestStatus: 'launched',
      launchedSessionId: null
    }),
    null
  );
});
