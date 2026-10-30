import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  finalizeActiveSession,
  MAX_ACTIVE_OBJECTIVE_SESSION_BINDINGS,
  readActiveSessions,
  type ResolvedSession,
  withActiveObjectiveSession,
  writeActiveSession
} from '../src/active-objective-sessions.ts';
import {
  appendChangeEvidence,
  changeLedgerCaptureFingerprint,
  changeLedgerCapturePayload,
  declareChangePaths,
  markChangeEvidenceSynced,
  markChangeLedgerCaptureSynced,
  readChangeLedgerHealth,
  readChangeLedgerSnapshot,
  readUnsyncedChangeEvidence,
  recordChangeLedgerBinding,
  recordChangeLedgerCallback,
  recordChangeLedgerHealth,
  removeChangeLedger,
  resetChangeLedger
} from '../src/change-ledger.ts';

function isolatedWorkspace(prefix: string): { home: string; workspace: string } {
  const home = mkdtempSync(path.join(os.tmpdir(), `${prefix}-home-`));
  process.env.OVLD_HOME = home;
  return {
    home,
    workspace: mkdtempSync(path.join(os.tmpdir(), `${prefix}-workspace-`))
  };
}

function resolveBoundSession(
  workingDirectory: string,
  objectiveId: string
): ResolvedSession | null {
  return withActiveObjectiveSession<ResolvedSession | null>({
    workingDirectory,
    objectiveId,
    fallback: null,
    action: session => session
  });
}

test('objective/session ledgers in one cwd cannot reset or read each other', () => {
  const { workspace } = isolatedWorkspace('ovld-objective-ledger');
  const left = {
    workingDirectory: workspace,
    objectiveId: 'objective-left',
    sessionKey: 'sess_left'
  };
  const right = {
    workingDirectory: workspace,
    objectiveId: 'objective-right',
    sessionKey: 'sess_right'
  };
  resetChangeLedger(left);
  resetChangeLedger(right);
  assert.equal(
    appendChangeEvidence({ ...left, filePaths: ['src/shared.ts'], source: 'declared_edit' }),
    1
  );
  assert.equal(
    appendChangeEvidence({ ...right, filePaths: ['src/shared.ts'], source: 'declared_edit' }),
    1
  );
  resetChangeLedger(right);

  assert.deepEqual(
    readUnsyncedChangeEvidence(left).map(entry => entry.filePath),
    ['src/shared.ts']
  );
  assert.deepEqual(readUnsyncedChangeEvidence(right), []);
});

test('overlord-managed paths are never recorded in the objective ledger', () => {
  const { workspace } = isolatedWorkspace('ovld-ledger-overlord');
  mkdirSync(path.join(workspace, '.overlord', 'tmp'), { recursive: true });
  writeFileSync(path.join(workspace, '.overlord', 'tmp', 'launch.sh'), '#!/bin/sh\n');
  writeFileSync(path.join(workspace, '.overlord', 'project.json'), '{}\n');
  const identity = {
    workingDirectory: workspace,
    objectiveId: 'objective-overlord',
    sessionKey: 'sess_overlord'
  };
  resetChangeLedger(identity);

  const appended = appendChangeEvidence({
    ...identity,
    filePaths: [
      '.overlord/tmp/launch.sh',
      '.overlord/project.json',
      '.overlord/logs/runner.log',
      'src/accepted.ts'
    ],
    source: 'declared_edit'
  });

  assert.equal(appended, 1);
  assert.deepEqual(
    readUnsyncedChangeEvidence(identity).map(entry => entry.filePath),
    ['src/accepted.ts']
  );
  assert.ok(
    readChangeLedgerHealth(identity)
      .map(entry => entry.code)
      .includes('ignored_path:3')
  );
});

test('insertion stores only bounded workspace-relative non-ignored paths and readable health', () => {
  const { workspace } = isolatedWorkspace('ovld-ledger-policy');
  const outsideDirectory = mkdtempSync(path.join(os.tmpdir(), 'ovld-ledger-outside-'));
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  symlinkSync(outsideDirectory, path.join(workspace, 'outside-link'));
  writeFileSync(path.join(workspace, '.overlordignore'), 'private/**\n*.secret\n');
  const identity = {
    workingDirectory: workspace,
    objectiveId: 'objective-policy',
    sessionKey: 'sess_policy'
  };
  resetChangeLedger(identity);

  const appended = appendChangeEvidence({
    ...identity,
    filePaths: [
      path.join(workspace, 'src', 'accepted.ts'),
      'private/token.txt',
      'nested/password.secret',
      path.join(path.dirname(workspace), 'outside.txt'),
      'outside-link/through-symlink.txt',
      ...(path.sep === '/' ? ['src\\literal-backslash.ts'] : []),
      'C:drive-relative.ts',
      ' src/whitespace.ts ',
      `src/${'x'.repeat(2_001)}`
    ],
    source: 'declared_edit',
    hookHealth: 'paired_hook_healthy'
  });

  assert.equal(appended, 1);
  assert.deepEqual(readUnsyncedChangeEvidence(identity), [
    {
      idempotencyKey: readUnsyncedChangeEvidence(identity)[0]?.idempotencyKey,
      filePath: 'src/accepted.ts',
      source: 'declared_edit',
      observedAt: readUnsyncedChangeEvidence(identity)[0]?.observedAt,
      hookHealth: 'paired_hook_healthy'
    }
  ]);
  const healthCodes = readChangeLedgerHealth(identity).map(entry => entry.code);
  assert.ok(healthCodes.includes('paired_hook_healthy'));
  assert.ok(healthCodes.includes('ignored_path:2'));
  assert.ok(healthCodes.includes('outside_workspace_path:2'));
  assert.ok(healthCodes.includes(`invalid_path:${path.sep === '/' ? 3 : 2}`));
  assert.ok(healthCodes.includes('path_too_long:1'));
  assert.ok(
    readUnsyncedChangeEvidence(identity).every(
      entry => !path.isAbsolute(entry.filePath) && !entry.filePath.includes('outside.txt')
    )
  );
});

test('oversized ignore policies fail closed before path insertion', () => {
  const policies = [
    'x'.repeat(70_000),
    'x'.repeat(2_001),
    Array.from({ length: 257 }, (_, index) => `private-${index}/**`).join('\n')
  ];

  for (const [index, policy] of policies.entries()) {
    const { workspace } = isolatedWorkspace(`ovld-ledger-ignore-bound-${index}`);
    writeFileSync(path.join(workspace, '.overlordignore'), policy);
    const identity = {
      workingDirectory: workspace,
      objectiveId: `objective-ignore-${index}`,
      sessionKey: `sess_ignore_${index}`
    };
    resetChangeLedger(identity);

    assert.equal(
      appendChangeEvidence({
        ...identity,
        filePaths: ['src/would-otherwise-pass.ts'],
        source: 'declared_edit'
      }),
      0
    );
    assert.deepEqual(readUnsyncedChangeEvidence(identity), []);
    assert.deepEqual(
      readChangeLedgerHealth(identity).map(entry => entry.code),
      ['ignore_policy_unavailable']
    );
  }
});

test('schema v2 ledgers upgrade once: pending rows keep keys, window rows are dropped', () => {
  const { home, workspace } = isolatedWorkspace('ovld-ledger-upgrade');
  const identity = {
    workingDirectory: workspace,
    objectiveId: 'objective-upgrade',
    sessionKey: 'sess_upgrade'
  };
  resetChangeLedger(identity);
  const ledgerDirectory = path.join(home, 'change-ledgers');
  const [ledgerName] = readdirSync(ledgerDirectory);
  assert.ok(ledgerName);
  const target = path.join(ledgerDirectory, ledgerName);
  const current = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
  const at = '2026-10-01T10:00:00.000Z';
  writeFileSync(
    target,
    JSON.stringify({
      schemaVersion: 2,
      workingDirectory: current.workingDirectory,
      objectiveId: current.objectiveId,
      sessionKeyHash: current.sessionKeyHash,
      evidence: [
        {
          idempotencyKey: 'native-pending',
          filePath: 'src/native.ts',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false,
          observedAt: at,
          hookHealth: 'direct_path_observed'
        },
        {
          idempotencyKey: 'native-synced',
          filePath: 'src/synced.ts',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false,
          observedAt: at,
          syncedAt: at
        },
        {
          idempotencyKey: 'generator',
          filePath: 'gen/out.ts',
          source: 'declared_edit',
          quality: 'direct',
          overlap: false,
          observedAt: at,
          hookHealth: 'agent_declared_generator_output'
        },
        {
          idempotencyKey: 'window',
          filePath: 'src/window.ts',
          source: 'window_observed',
          quality: 'window',
          overlap: true,
          toolWindowId: 'window-1',
          observedAt: at
        }
      ],
      health: [{ at, code: 'shell_activity_unverified' }]
    })
  );

  const expected = [
    {
      idempotencyKey: 'native-pending',
      filePath: 'src/native.ts',
      source: 'declared_edit',
      observedAt: at,
      hookHealth: 'direct_path_observed'
    },
    {
      idempotencyKey: 'native-synced',
      filePath: 'src/synced.ts',
      source: 'declared_edit',
      observedAt: at,
      syncedAt: at
    },
    {
      idempotencyKey: 'generator',
      filePath: 'gen/out.ts',
      source: 'agent_declared',
      observedAt: at,
      hookHealth: 'agent_declared'
    }
  ];
  const before = readChangeLedgerSnapshot(identity);
  assert.deepEqual(before?.evidence, expected);
  assert.equal(before?.capture.bindingState, 'unknown');
  assert.deepEqual(
    before?.health.map(entry => entry.code),
    ['shell_activity_unverified', 'legacy_window_evidence_discarded:1']
  );
  // Reads never rewrite the file; the next locked mutation persists schema v3.
  assert.equal(
    (JSON.parse(readFileSync(target, 'utf8')) as { schemaVersion: number }).schemaVersion,
    2
  );
  recordChangeLedgerHealth({ ...identity, code: 'direct_path_observed' });
  const persisted = JSON.parse(readFileSync(target, 'utf8')) as {
    schemaVersion: number;
    evidence: unknown[];
  };
  assert.equal(persisted.schemaVersion, 3);
  assert.deepEqual(persisted.evidence, expected);
  assert.deepEqual(
    readUnsyncedChangeEvidence(identity).map(entry => entry.idempotencyKey),
    ['native-pending', 'generator']
  );
});

test('declared paths normalize safely and keep commas, deletes, and both rename endpoints', () => {
  const { workspace } = isolatedWorkspace('ovld-ledger-declared');
  const outside = mkdtempSync(path.join(os.tmpdir(), 'ovld-ledger-declared-outside-'));
  symlinkSync(outside, path.join(workspace, 'escape'));
  writeFileSync(path.join(workspace, '.overlordignore'), 'private/**\n');
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  writeFileSync(path.join(workspace, 'src', 'kept.ts'), '');
  const identity = {
    workingDirectory: workspace,
    objectiveId: 'objective-declared',
    sessionKey: 'sess_declared'
  };
  resetChangeLedger(identity);
  appendChangeEvidence({ ...identity, filePaths: ['src/kept.ts'], source: 'declared_edit' });

  const result = declareChangePaths({
    ...identity,
    filePaths: [
      'docs/a,b.md',
      'src/deleted.ts',
      'src/old-name.ts',
      'src/new-name.ts',
      path.join(realpathSync(workspace), 'src', 'kept.ts'),
      '../outside.ts',
      'escape/secret.ts',
      'private/token.txt',
      42
    ]
  });

  assert.equal(result.recorded, true);
  assert.deepEqual(result.accepted, [
    'docs/a,b.md',
    'src/deleted.ts',
    'src/old-name.ts',
    'src/new-name.ts',
    'src/kept.ts'
  ]);
  assert.deepEqual(
    result.rejected.map(entry => entry.reason),
    ['outside_workspace_path', 'outside_workspace_path', 'ignored_path', 'invalid_path']
  );
  const evidence = readUnsyncedChangeEvidence(identity);
  assert.deepEqual(
    evidence.map(entry => [entry.filePath, entry.source, entry.hookHealth]),
    [
      ['src/kept.ts', 'declared_edit', undefined],
      ['docs/a,b.md', 'agent_declared', 'agent_declared'],
      ['src/deleted.ts', 'agent_declared', 'agent_declared'],
      ['src/old-name.ts', 'agent_declared', 'agent_declared'],
      ['src/new-name.ts', 'agent_declared', 'agent_declared'],
      ['src/kept.ts', 'agent_declared', 'agent_declared']
    ]
  );
  // Re-declaring is idempotent.
  assert.deepEqual(declareChangePaths({ ...identity, filePaths: ['docs/a,b.md'] }).accepted, [
    'docs/a,b.md'
  ]);
  assert.equal(readUnsyncedChangeEvidence(identity).length, 6);
});

test('binding and first callback are recorded separately from edit evidence', () => {
  const { workspace } = isolatedWorkspace('ovld-ledger-capture');
  const identity = {
    workingDirectory: workspace,
    objectiveId: 'objective-capture',
    sessionKey: 'sess_capture'
  };
  resetChangeLedger(identity);
  assert.equal(readChangeLedgerSnapshot(identity)?.capture.bindingState, 'unknown');
  recordChangeLedgerBinding({ ...identity, bindingState: 'bound' });
  const unobserved = readChangeLedgerSnapshot(identity);
  assert.deepEqual(unobserved?.capture, { bindingState: 'bound' });

  recordChangeLedgerCallback(identity);
  const first = readChangeLedgerSnapshot(identity)?.capture.callbackObservedAt;
  assert.ok(first);
  recordChangeLedgerCallback(identity);
  assert.equal(readChangeLedgerSnapshot(identity)?.capture.callbackObservedAt, first);
  assert.deepEqual(readUnsyncedChangeEvidence(identity), []);

  const snapshot = readChangeLedgerSnapshot(identity);
  assert.ok(snapshot);
  const fingerprint = changeLedgerCaptureFingerprint(snapshot);
  markChangeLedgerCaptureSynced({ ...identity, fingerprint });
  assert.equal(readChangeLedgerSnapshot(identity)?.capture.syncedFingerprint, fingerprint);
  // A stale fingerprint never marks newer local diagnostics as synchronized.
  recordChangeLedgerHealth({ ...identity, code: 'direct_path_unavailable' });
  markChangeLedgerCaptureSynced({ ...identity, fingerprint });
  const changed = readChangeLedgerSnapshot(identity);
  assert.ok(changed);
  assert.notEqual(changeLedgerCaptureFingerprint(changed), changed.capture.syncedFingerprint);
  assert.deepEqual(
    changeLedgerCapturePayload(changed).health.map(entry => entry.code),
    ['direct_path_unavailable']
  );
});

test('repeated health codes coalesce without evicting distinct diagnostics', () => {
  const { workspace } = isolatedWorkspace('ovld-ledger-health');
  const identity = {
    workingDirectory: workspace,
    objectiveId: 'objective-health',
    sessionKey: 'sess_health'
  };
  resetChangeLedger(identity);
  recordChangeLedgerHealth({ ...identity, code: 'shell_path_unavailable' });
  const firstTimestamp = readChangeLedgerHealth(identity)[0]?.at;
  recordChangeLedgerHealth({ ...identity, code: 'ignore_policy_unavailable' });
  recordChangeLedgerHealth({ ...identity, code: 'shell_path_unavailable' });

  const health = readChangeLedgerHealth(identity);
  assert.deepEqual(
    health.map(entry => entry.code),
    ['ignore_policy_unavailable', 'shell_path_unavailable']
  );
  assert.ok(health[1]?.at);
  assert.ok(health[1]?.at >= (firstTimestamp ?? ''));
});

test('capture gap codes stay sticky when later diagnostics overflow the bounded list', () => {
  const { workspace } = isolatedWorkspace('ovld-ledger-sticky');
  const identity = {
    workingDirectory: workspace,
    objectiveId: 'objective-sticky',
    sessionKey: 'sess_sticky'
  };
  resetChangeLedger(identity);
  recordChangeLedgerHealth({ ...identity, code: 'shell_activity_unverified' });
  recordChangeLedgerHealth({ ...identity, code: 'outcome_unavailable' });
  for (let index = 0; index < 40; index += 1) {
    recordChangeLedgerHealth({ ...identity, code: `diagnostic_${index}` });
  }

  const codes = readChangeLedgerHealth(identity).map(entry => entry.code);
  assert.equal(codes.length, 32);
  assert.deepEqual(codes.slice(0, 2), ['shell_activity_unverified', 'outcome_unavailable']);
  assert.equal(codes.at(-1), 'diagnostic_39');
  assert.ok(!codes.includes('diagnostic_0'));
});

test('ledger cleanup refuses unsynced evidence and removes a fully synced ledger', () => {
  const { workspace } = isolatedWorkspace('ovld-ledger-cleanup');
  const identity = {
    workingDirectory: workspace,
    objectiveId: 'objective-cleanup',
    sessionKey: 'sess_cleanup'
  };
  resetChangeLedger(identity);
  appendChangeEvidence({ ...identity, filePaths: ['pending.ts'], source: 'declared_edit' });
  const [pending] = readUnsyncedChangeEvidence(identity);
  assert.ok(pending);

  assert.equal(removeChangeLedger(identity), false);
  assert.equal(readUnsyncedChangeEvidence(identity).length, 1);
  markChangeEvidenceSynced({
    ...identity,
    evidence: [{ idempotencyKey: pending.idempotencyKey, filePath: 'wrong-path.ts' }]
  });
  assert.equal(readUnsyncedChangeEvidence(identity).length, 1);
  markChangeEvidenceSynced({
    ...identity,
    evidence: [{ idempotencyKey: pending.idempotencyKey, filePath: pending.filePath }]
  });
  assert.equal(removeChangeLedger(identity), true);
  assert.deepEqual(readUnsyncedChangeEvidence(identity), []);
});

test('oversized ledger state fails closed without being overwritten by capture', () => {
  const { home, workspace } = isolatedWorkspace('ovld-ledger-oversized');
  const identity = {
    workingDirectory: workspace,
    objectiveId: 'objective-oversized',
    sessionKey: 'sess_oversized'
  };
  resetChangeLedger(identity);
  const ledgerDirectory = path.join(home, 'change-ledgers');
  const [ledgerName] = readdirSync(ledgerDirectory);
  assert.ok(ledgerName);
  const target = path.join(ledgerDirectory, ledgerName);
  const oversizedBytes = 33 * 1024 * 1024;
  truncateSync(target, oversizedBytes);

  assert.deepEqual(readUnsyncedChangeEvidence(identity), []);
  assert.equal(
    appendChangeEvidence({
      ...identity,
      filePaths: ['must-not-overwrite.ts'],
      source: 'declared_edit'
    }),
    0
  );
  assert.equal(statSync(target).size, oversizedBytes);
});

test('ledger capacity is bounded and reports health without leaking an input count', () => {
  const { workspace } = isolatedWorkspace('ovld-ledger-capacity');
  const identity = {
    workingDirectory: workspace,
    objectiveId: 'objective-capacity',
    sessionKey: 'sess_capacity'
  };
  resetChangeLedger(identity);
  let appended = 0;
  for (let offset = 0; offset < 10_000; offset += 512) {
    const batchSize = Math.min(512, 10_000 - offset);
    appended += appendChangeEvidence({
      ...identity,
      filePaths: Array.from({ length: batchSize }, (_, index) => `bulk/file-${offset + index}.ts`),
      source: 'declared_edit'
    });
  }
  assert.equal(appended, 10_000);
  assert.equal(
    appendChangeEvidence({ ...identity, filePaths: ['overflow.ts'], source: 'declared_edit' }),
    0
  );
  assert.equal(readUnsyncedChangeEvidence(identity).length, 10_000);
  assert.ok(
    readChangeLedgerHealth(identity)
      .map(entry => entry.code)
      .includes('ledger_capacity_reached')
  );
});

test('session resolution requires an explicit canonical objective id or alias', () => {
  const { workspace } = isolatedWorkspace('ovld-objective-session');
  writeActiveSession({
    workingDirectory: workspace,
    missionId: 'coo:825',
    objectiveId: 'objective-left-uuid',
    objectiveAliases: ['coo:825.left'],
    sessionKey: 'sess_left'
  });
  writeActiveSession({
    workingDirectory: workspace,
    missionId: 'coo:825',
    objectiveId: 'objective-right-uuid',
    objectiveAliases: ['coo:825.right'],
    sessionKey: 'sess_right'
  });

  assert.equal(resolveBoundSession(workspace, ''), null);
  assert.equal(
    resolveBoundSession(workspace, 'coo:825.right')?.objectiveId,
    'objective-right-uuid'
  );
  assert.equal(resolveBoundSession(workspace, 'objective-left-uuid')?.sessionKey, 'sess_left');
  assert.equal(resolveBoundSession(workspace, 'coo:825'), null);
});

test('pending retry bindings are bounded without deleting their ledgers', () => {
  const { workspace } = isolatedWorkspace('ovld-objective-session-capacity');
  for (let index = 0; index < MAX_ACTIVE_OBJECTIVE_SESSION_BINDINGS; index += 1) {
    const sessionKey = `sess_pending_${index}`;
    assert.equal(
      writeActiveSession({
        workingDirectory: workspace,
        missionId: 'coo:825',
        objectiveId: 'objective-capacity-uuid',
        objectiveAliases: ['coo:825.capacity'],
        sessionKey
      }),
      true
    );
    appendChangeEvidence({
      workingDirectory: workspace,
      objectiveId: 'objective-capacity-uuid',
      sessionKey,
      filePaths: [`pending-${index}.ts`],
      source: 'declared_edit'
    });
    assert.equal(
      finalizeActiveSession({
        workingDirectory: workspace,
        objectiveId: 'objective-capacity-uuid',
        sessionKey
      }),
      false
    );
  }

  assert.equal(readActiveSessions(workspace).length, MAX_ACTIVE_OBJECTIVE_SESSION_BINDINGS);
  assert.ok(readActiveSessions(workspace).every(entry => entry.deliveryPendingSync));
  assert.equal(
    writeActiveSession({
      workingDirectory: workspace,
      missionId: 'coo:825',
      objectiveId: 'objective-capacity-uuid',
      objectiveAliases: ['coo:825.capacity'],
      sessionKey: 'sess_refused_without_deleting_retries'
    }),
    false
  );
  assert.equal(readActiveSessions(workspace).length, MAX_ACTIVE_OBJECTIVE_SESSION_BINDINGS);
  assert.deepEqual(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: 'objective-capacity-uuid',
      sessionKey: 'sess_pending_0'
    }).map(entry => entry.filePath),
    ['pending-0.ts']
  );

  // A delivered retry whose evidence subsequently synchronized must no longer
  // prevent a fresh attach. Other retries still own their pending evidence.
  const syncedIdentity = {
    workingDirectory: workspace,
    objectiveId: 'objective-capacity-uuid',
    sessionKey: 'sess_pending_0'
  };
  markChangeEvidenceSynced({
    ...syncedIdentity,
    evidence: readUnsyncedChangeEvidence(syncedIdentity)
  });
  assert.equal(
    writeActiveSession({
      workingDirectory: workspace,
      missionId: 'coo:825',
      objectiveId: syncedIdentity.objectiveId,
      objectiveAliases: ['coo:825.capacity'],
      sessionKey: 'sess_after_retry_sync'
    }),
    true
  );
  assert.equal(readActiveSessions(workspace).length, MAX_ACTIVE_OBJECTIVE_SESSION_BINDINGS);
  assert.equal(
    resolveBoundSession(workspace, 'coo:825.capacity')?.sessionKey,
    'sess_after_retry_sync'
  );
  assert.ok(
    !readActiveSessions(workspace).some(entry => entry.sessionKey === syncedIdentity.sessionKey)
  );
  assert.deepEqual(readUnsyncedChangeEvidence(syncedIdentity), []);
  assert.deepEqual(
    readUnsyncedChangeEvidence({ ...syncedIdentity, sessionKey: 'sess_pending_1' }).map(
      entry => entry.filePath
    ),
    ['pending-1.ts']
  );
});

test('a byte-full manifest prunes synchronized retries and preserves live peers and pending evidence', () => {
  const { home, workspace } = isolatedWorkspace('Tough Leaf byte capacity');
  const protectedRetry = {
    workingDirectory: workspace,
    objectiveId: 'protected-objective',
    sessionKey: 'sess_protected'
  };
  assert.equal(
    writeActiveSession({ ...protectedRetry, missionId: 'coo:825', objectiveAliases: [] }),
    true
  );
  appendChangeEvidence({ ...protectedRetry, filePaths: ['unsynced.ts'], source: 'declared_edit' });
  assert.equal(finalizeActiveSession(protectedRetry), false);
  const directory = path.join(home, 'active-objective-sessions');
  const manifestPath = path.join(
    directory,
    readdirSync(directory).find(name => name.endsWith('.json'))!
  );
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    entries: ReturnType<typeof readActiveSessions>;
  };
  const aliases = Array.from({ length: 16 }, (_, index) => `${index}-${'a'.repeat(190)}`);
  for (let index = 0; ; index++) {
    manifest.entries.push({
      missionId: 'coo:825',
      objectiveId: `peer-${index}`,
      sessionKey: `sess_peer_${index}`,
      objectiveAliases: aliases,
      attachedAt: '2026-01-01T00:00:00.000Z',
      deliveryPendingSync: index === 0
    });
    if (Buffer.byteLength(JSON.stringify(manifest)) > 512 * 1024) {
      manifest.entries.pop();
      break;
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const livePeers = manifest.entries
    .filter(entry => !entry.deliveryPendingSync)
    .map(entry => entry.sessionKey);
  assert.equal(
    writeActiveSession({
      workingDirectory: workspace,
      missionId: 'coo:825',
      objectiveId: 'objective-after-byte-capacity',
      objectiveAliases: aliases,
      sessionKey: 'sess_new_capacity'
    }),
    true
  );
  const retained = readActiveSessions(workspace);
  assert.ok(livePeers.every(key => retained.some(entry => entry.sessionKey === key)));
  assert.ok(retained.some(entry => entry.sessionKey === protectedRetry.sessionKey));
  assert.ok(!retained.some(entry => entry.sessionKey === 'sess_peer_0'));
  assert.equal(
    resolveBoundSession(workspace, 'objective-after-byte-capacity')?.sessionKey,
    'sess_new_capacity'
  );
  assert.ok(statSync(manifestPath).size <= 512 * 1024);
  assert.deepEqual(
    readUnsyncedChangeEvidence(protectedRetry).map(entry => entry.filePath),
    ['unsynced.ts']
  );
});

test('an old session cannot remove a newer binding for the same objective', () => {
  const { workspace } = isolatedWorkspace('ovld-objective-session-replacement');
  const binding = {
    workingDirectory: workspace,
    missionId: 'coo:825',
    objectiveId: 'objective-replaced-uuid',
    objectiveAliases: ['coo:825.replaced']
  };
  writeActiveSession({ ...binding, sessionKey: 'sess_old' });
  writeActiveSession({ ...binding, sessionKey: 'sess_new' });

  assert.equal(
    finalizeActiveSession({
      workingDirectory: workspace,
      objectiveId: binding.objectiveId,
      sessionKey: 'sess_old'
    }),
    false
  );
  assert.equal(resolveBoundSession(workspace, binding.objectiveId)?.sessionKey, 'sess_new');

  assert.equal(
    finalizeActiveSession({
      workingDirectory: workspace,
      objectiveId: binding.objectiveId,
      sessionKey: 'sess_new'
    }),
    true
  );
  assert.equal(resolveBoundSession(workspace, binding.objectiveId), null);
});

test('reattach preserves an old unsynced ledger as retry state', () => {
  const { workspace } = isolatedWorkspace('ovld-objective-session-reattach');
  const binding = {
    workingDirectory: workspace,
    missionId: 'coo:825',
    objectiveId: 'objective-reattach-uuid',
    objectiveAliases: ['coo:825.reattach']
  };
  writeActiveSession({ ...binding, sessionKey: 'sess_old' });
  appendChangeEvidence({
    workingDirectory: workspace,
    objectiveId: binding.objectiveId,
    sessionKey: 'sess_old',
    filePaths: ['src/old-session.ts'],
    source: 'declared_edit'
  });

  assert.equal(writeActiveSession({ ...binding, sessionKey: 'sess_new' }), true);
  assert.deepEqual(
    readActiveSessions(workspace).map(entry => ({
      sessionKey: entry.sessionKey,
      deliveryPendingSync: entry.deliveryPendingSync
    })),
    [
      { sessionKey: 'sess_old', deliveryPendingSync: true },
      { sessionKey: 'sess_new', deliveryPendingSync: false }
    ]
  );
  assert.equal(resolveBoundSession(workspace, 'coo:825.reattach')?.sessionKey, 'sess_new');
  assert.deepEqual(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: binding.objectiveId,
      sessionKey: 'sess_old'
    }).map(entry => entry.filePath),
    ['src/old-session.ts']
  );
});

test('legacy and objective-alias-less session manifests are rejected instead of upgraded', () => {
  const { home, workspace } = isolatedWorkspace('ovld-session-schema');
  writeActiveSession({
    workingDirectory: workspace,
    missionId: 'coo:825',
    objectiveId: 'objective-uuid',
    objectiveAliases: ['coo:825.objective'],
    sessionKey: 'sess_schema'
  });
  const manifestDirectory = path.join(home, 'active-objective-sessions');
  const [manifestName] = readdirSync(manifestDirectory);
  assert.ok(manifestName);
  const manifestPath = path.join(manifestDirectory, manifestName);
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 2,
      workingDirectory: workspace,
      entries: [
        {
          missionId: 'coo:825',
          objectiveId: 'objective-uuid',
          sessionKey: 'sess_schema',
          attachedAt: new Date().toISOString()
        },
        {
          missionId: 'coo:825',
          objectiveAliases: ['coo:825.objective'],
          sessionKey: 'sess_missing_objective',
          attachedAt: new Date().toISOString()
        }
      ]
    })
  );

  assert.deepEqual(readActiveSessions(workspace), []);
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 3,
      workingDirectory: realpathSync(workspace),
      entries: [
        {
          missionId: 'coo:825',
          objectiveId: 'objective-uuid',
          sessionKey: 'sess_schema',
          attachedAt: new Date().toISOString(),
          deliveryPendingSync: false
        },
        {
          missionId: 'coo:825',
          objectiveAliases: ['coo:825.objective'],
          sessionKey: 'sess_missing_objective',
          attachedAt: new Date().toISOString(),
          deliveryPendingSync: false
        }
      ]
    })
  );
  assert.deepEqual(readActiveSessions(workspace), []);
});

test('strict active bindings do not discard unsynced work by wall-clock age', () => {
  const { home, workspace } = isolatedWorkspace('ovld-objective-session-age');
  const manifestDirectory = path.join(home, 'active-objective-sessions');
  mkdirSync(manifestDirectory, { recursive: true });
  // Create the canonical filename through the production writer, then replace
  // only its strict-schema contents with an old attachment timestamp.
  writeActiveSession({
    workingDirectory: workspace,
    missionId: 'coo:825',
    objectiveId: 'objective-old-uuid',
    objectiveAliases: ['coo:825.old'],
    sessionKey: 'sess_old'
  });
  const [targetName] = readdirSync(manifestDirectory);
  assert.ok(targetName);
  const target = path.join(manifestDirectory, targetName);
  writeFileSync(
    target,
    JSON.stringify({
      schemaVersion: 3,
      workingDirectory: realpathSync(workspace),
      entries: [
        {
          missionId: 'coo:825',
          objectiveId: 'objective-old-uuid',
          objectiveAliases: ['coo:825.old'],
          sessionKey: 'sess_old',
          attachedAt: '2020-01-01T00:00:00.000Z',
          deliveryPendingSync: false
        }
      ]
    })
  );

  assert.equal(resolveBoundSession(workspace, 'coo:825.old')?.sessionKey, 'sess_old');
});

test('oversized active-session state fails closed without replacing stored bindings', () => {
  const { home, workspace } = isolatedWorkspace('ovld-objective-session-oversized');
  assert.equal(
    writeActiveSession({
      workingDirectory: workspace,
      missionId: 'coo:825',
      objectiveId: 'objective-original',
      objectiveAliases: ['coo:825.original'],
      sessionKey: 'sess_original'
    }),
    true
  );
  const manifestDirectory = path.join(home, 'active-objective-sessions');
  const [manifestName] = readdirSync(manifestDirectory);
  assert.ok(manifestName);
  const target = path.join(manifestDirectory, manifestName);
  const oversizedBytes = 513 * 1024;
  truncateSync(target, oversizedBytes);

  assert.deepEqual(readActiveSessions(workspace), []);
  assert.equal(
    writeActiveSession({
      workingDirectory: workspace,
      missionId: 'coo:825',
      objectiveId: 'objective-replacement',
      objectiveAliases: ['coo:825.replacement'],
      sessionKey: 'sess_replacement'
    }),
    false
  );
  assert.equal(statSync(target).size, oversizedBytes);
});
