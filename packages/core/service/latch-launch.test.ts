import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLatchCreateManifest,
  existingLatchProviderSession,
  latchAttachCommand,
  latchViewerFlagForKind,
  mergeProviderSessionIntoMetadata,
  parseLatchCreateReport,
  providerSessionFromMetadata,
  shouldUseLatchProvider,
  toExecutionProviderSession
} from './latch-launch.ts';

test('buildLatchCreateManifest runs S through an interactive login shell and keeps overlord source', () => {
  const commandString =
    "cd '/tmp/proj' && export MISSION_ID='coo:1'; 'claude' '--dangerously-skip-permissions'";
  const manifest = buildLatchCreateManifest({
    commandString,
    shell: '/bin/zsh',
    cwd: '/tmp/proj',
    env: { MISSION_ID: 'coo:1', OVERLORD_BACKEND_URL: 'http://127.0.0.1:4310' },
    title: 'Authentication refactor',
    name: 'coo-1',
    commandLabel: 'claude',
    externalRunId: 'req-123'
  });

  assert.equal(manifest.format_version, 1);
  assert.deepEqual(manifest.launch.argv, ['/bin/zsh', '-ilc', commandString]);
  assert.equal(manifest.launch.cwd, '/tmp/proj');
  assert.equal(manifest.launch.env.MISSION_ID, 'coo:1');
  assert.equal(manifest.launch.inherit_env, true);
  assert.equal(manifest.display.title, 'Authentication refactor');
  assert.equal(manifest.display.command_label, 'claude');
  assert.deepEqual(manifest.display.source, {
    kind: 'overlord',
    external_run_id: 'req-123'
  });
  // Secrets must live in the body, never as argv fragments beyond the shell wrapper.
  assert.equal(manifest.launch.argv.length, 3);
});

test('parseLatchCreateReport accepts a well-formed create --json document', () => {
  const report = parseLatchCreateReport(
    JSON.stringify({
      protocolVersion: 1,
      session: {
        id: 'ses_01JTEST',
        name: 'authentication-refactor',
        state: 'running',
        createdAt: '2026-08-12T14:00:00.000Z'
      }
    })
  );
  assert.ok(report);
  assert.equal(report?.session.id, 'ses_01JTEST');
  assert.equal(report?.session.state, 'running');
});

test('parseLatchCreateReport rejects garbage', () => {
  assert.equal(parseLatchCreateReport('not-json'), null);
  assert.equal(parseLatchCreateReport('{"session":{}}'), null);
});

test('toExecutionProviderSession never treats the Latch id as an agent session', () => {
  const mapping = toExecutionProviderSession({
    createReport: {
      protocolVersion: 1,
      session: {
        id: 'ses_01JTEST',
        name: 'n',
        state: 'running',
        createdAt: '2026-08-12T14:00:00.000Z'
      }
    },
    executionTargetId: 'target-1'
  });
  assert.equal(mapping.provider, 'latch');
  assert.equal(mapping.providerSessionId, 'ses_01JTEST');
  assert.equal(mapping.sessionName, 'n');
  assert.equal(mapping.agentSessionId, null);
  assert.equal(mapping.executionTargetId, 'target-1');
});

test('existing Latch environment marker creates a correlation-only provider mapping', () => {
  const mapping = existingLatchProviderSession({
    latchSessionId: ' ses_existing ',
    executionTargetId: 'target_1',
    createdAt: '2026-08-12T15:00:00.000Z'
  });
  assert.deepEqual(mapping, {
    provider: 'latch',
    providerSessionId: 'ses_existing',
    sessionName: null,
    executionTargetId: 'target_1',
    agentSessionId: null,
    createdAt: '2026-08-12T15:00:00.000Z',
    lastObservedState: 'running'
  });
  assert.equal(existingLatchProviderSession({ latchSessionId: '   ' }), null);
});

test('providerSession metadata round-trips', () => {
  const mapping = {
    provider: 'latch' as const,
    providerSessionId: 'ses_01JTEST',
    sessionName: 'mission-session',
    executionTargetId: 'target-1',
    agentSessionId: null,
    createdAt: '2026-08-12T14:00:00.000Z',
    lastObservedState: 'running'
  };
  const merged = mergeProviderSessionIntoMetadata({
    metadataJson: JSON.stringify({ launchSession: { version: 1 } }),
    providerSession: mapping
  });
  const parsed = JSON.parse(merged) as Record<string, unknown>;
  assert.ok(parsed.launchSession);
  assert.deepEqual(providerSessionFromMetadata(parsed), mapping);
});

test('shouldUseLatchProvider requires both latch kind and selectable discovery', () => {
  assert.equal(shouldUseLatchProvider({ providerKind: 'latch', latchSelectable: true }), true);
  assert.equal(shouldUseLatchProvider({ providerKind: 'latch', latchSelectable: false }), false);
  assert.equal(shouldUseLatchProvider({ providerKind: 'direct', latchSelectable: true }), false);
  assert.equal(shouldUseLatchProvider({ providerKind: null, latchSelectable: true }), false);
});

test('latchViewerFlagForKind only maps supported Latch viewers', () => {
  assert.equal(latchViewerFlagForKind('iterm'), 'iterm');
  assert.equal(latchViewerFlagForKind('iterm2'), 'iterm');
  assert.equal(latchViewerFlagForKind('terminal'), null);
  assert.equal(latchViewerFlagForKind('inline'), null);
  assert.equal(latchViewerFlagForKind('custom'), null);
});

test('latchAttachCommand is the recovery path when open fails', () => {
  assert.equal(latchAttachCommand({ providerSessionId: 'ses_01J' }), 'latch attach ses_01J');
  assert.equal(
    latchAttachCommand({ executable: '/opt/latch', providerSessionId: 'ses_01J' }),
    '/opt/latch attach ses_01J'
  );
});
