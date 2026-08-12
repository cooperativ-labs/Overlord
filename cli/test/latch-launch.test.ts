import assert from 'node:assert/strict';
import test from 'node:test';

import {
  latchViewerFlagForKind,
  openLatchViewer,
  parseLatchCreateReport
} from '../src/latch-launch.ts';

test('openLatchViewer reports a warning instead of throwing for unsupported viewers', () => {
  const result = openLatchViewer({
    providerSessionId: 'ses_01JTEST',
    viewerKind: 'terminal'
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected failure');
  assert.match(result.warning, /attach with:/);
  assert.equal(result.attachCommand, 'latch attach ses_01JTEST');
});

test('latchViewerFlagForKind matches Latch open --with iterm', () => {
  assert.equal(latchViewerFlagForKind('iterm'), 'iterm');
  assert.equal(latchViewerFlagForKind('Terminal'), null);
});

test('parseLatchCreateReport is re-exported for the CLI wrapper', () => {
  const report = parseLatchCreateReport(
    JSON.stringify({
      protocolVersion: 1,
      session: { id: 'ses_1', name: 'n', state: 'running', createdAt: '2026-08-12T00:00:00.000Z' }
    })
  );
  assert.equal(report?.session.id, 'ses_1');
});
