import { LATCH_OPEN_AS_MIN_PRODUCT_VERSION } from '@overlord/core/service/latch-launch';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
      protocolVersion: 2,
      session: { id: 'ses_1', name: 'n', state: 'running', createdAt: '2026-08-12T00:00:00.000Z' }
    })
  );
  assert.equal(report?.session.id, 'ses_1');
});

test('openLatchViewer passes the launch snapshot shape to a Latch that supports --as', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-latch-open-'));
  const fakeLatch = path.join(tempDir, 'latch');
  writeFileSync(
    fakeLatch,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const asIndex = args.indexOf('--as');
process.stdout.write(JSON.stringify({
  id: args[1],
  viewer: args[args.indexOf('--with') + 1],
  opened: true,
  behavior: asIndex === -1 ? undefined : args[asIndex + 1]
}));
`
  );
  chmodSync(fakeLatch, 0o700);

  try {
    const opened = openLatchViewer({
      executable: fakeLatch,
      providerSessionId: 'ses_01JTEST',
      viewerKind: 'iterm',
      openAs: 'tab',
      productVersion: LATCH_OPEN_AS_MIN_PRODUCT_VERSION
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) throw new Error('expected success');
    assert.equal(opened.openAs, 'tab');

    // clap rejects unknown flags, so a Latch that predates `--as` must be sent
    // the old argv and simply get a window.
    const legacy = openLatchViewer({
      executable: fakeLatch,
      providerSessionId: 'ses_01JTEST',
      viewerKind: 'iterm',
      openAs: 'tab',
      productVersion: '0.2608140801.0'
    });
    assert.equal(legacy.ok, true);
    if (!legacy.ok) throw new Error('expected success');
    assert.equal(legacy.openAs, null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
