import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  finalizeActiveSession,
  readActiveSessions,
  writeActiveSession
} from '../src/active-objective-sessions.ts';
import { captureChangeFromPayload } from '../src/capture-change.ts';
import {
  appendChangeEvidence,
  readChangeLedgerSnapshot,
  readUnsyncedChangeEvidence,
  recordChangeLedgerHealth
} from '../src/change-ledger.ts';
import { runProtocolCommand } from '../src/commands.ts';
import type { CliRuntime } from '../src/runtime.ts';
import { readCachedSessionKey, writeCachedSessionKey } from '../src/session-key.ts';

const MISSION_ID = 'coo:825';
const OBJECTIVE_ID = 'objective-uuid';
const OBJECTIVE_DISPLAY_ID = 'coo:825.wyp4';
const SESSION_KEY = 'sess_me';

function makeWorkspace(): string {
  process.env.OVLD_HOME = mkdtempSync(path.join(os.tmpdir(), 'ovld-commands-home-'));
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'ovld-commands-workspace-'));
  writeActiveSession({
    workingDirectory: workspace,
    missionId: MISSION_ID,
    objectiveId: OBJECTIVE_ID,
    objectiveAliases: [OBJECTIVE_DISPLAY_ID],
    sessionKey: SESSION_KEY
  });
  return workspace;
}

async function captureStdoutText(action: () => Promise<void>): Promise<string> {
  let written = '';
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    written += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await action();
  } finally {
    process.stdout.write = originalWrite;
  }
  return written;
}

async function captureStdout(action: () => Promise<void>): Promise<unknown> {
  let written = '';
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    written += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await action();
  } finally {
    process.stdout.write = originalWrite;
  }
  return JSON.parse(written) as unknown;
}

test('deliver drains every ledger batch and sends no retired change-tracking flags', async () => {
  const workspace = makeWorkspace();
  appendChangeEvidence({
    workingDirectory: workspace,
    objectiveId: OBJECTIVE_ID,
    sessionKey: SESSION_KEY,
    filePaths: Array.from({ length: 31 }, (_, index) => `src/file-${index}.ts`),
    source: 'declared_edit'
  });

  const requests: Array<{ path: string; body: unknown }> = [];
  const runtime = {
    backend: {
      baseUrl: 'http://example.test',
      health: async () => ({ ok: true }),
      get: async () => {
        throw new Error('unexpected GET');
      },
      post: async ({ path: requestPath, body }: { path: string; body: unknown }) => {
        requests.push({ path: requestPath, body });
        if (requestPath === '/api/protocol/sync-changes') {
          const flags = (body as { flags: Record<string, string> }).flags;
          const entries = JSON.parse(flags['--changes-json'] ?? '[]') as Array<{
            idempotencyKey: string;
            filePath: string;
          }>;
          return {
            outcomes: entries.map(entry => ({
              idempotencyKey: entry.idempotencyKey,
              filePath: entry.filePath,
              status: 'accepted'
            }))
          };
        }
        return {};
      },
      patch: async () => {
        throw new Error('unexpected PATCH');
      },
      delete: async () => {
        throw new Error('unexpected DELETE');
      }
    },
    close: () => {}
  } satisfies CliRuntime;

  const pathsFile = path.join(workspace, 'declared-paths.json');
  writeFileSync(pathsFile, JSON.stringify(['generated/a,b.ts', 'src/removed.ts', '../escape.ts']));
  const originalCwd = process.cwd();
  process.chdir(workspace);
  try {
    await runProtocolCommand({
      runtime,
      subcommand: 'deliver',
      args: [
        '--session-key',
        SESSION_KEY,
        '--objective-id',
        OBJECTIVE_DISPLAY_ID,
        '--paths',
        'generated/one.ts,generated/two.ts',
        '--paths-file',
        pathsFile,
        '--summary',
        'Done.'
      ]
    });
  } finally {
    process.chdir(originalCwd);
  }

  assert.equal(requests.filter(request => request.path === '/api/protocol/sync-changes').length, 2);
  const delivery = requests.find(request => request.path === '/api/protocol/deliver');
  assert.ok(delivery);
  const flags = (delivery.body as { flags: Record<string, string | true> }).flags;
  assert.equal('--paths' in flags, false);
  assert.equal('--paths-file' in flags, false);
  assert.equal(
    '--paths-file' in (delivery.body as { fileInputs: Record<string, string> }).fileInputs,
    false
  );
  for (const retired of [
    '--changed-files-json',
    '--changed-files-file',
    '--observed-dirty-paths-json',
    '--observed-dirty-paths-file',
    '--no-file-changes',
    '--skip-rationale-for-json',
    '--skip-rationale-for-file'
  ]) {
    assert.equal(retired in flags, false);
  }
  const synced = requests
    .filter(request => request.path === '/api/protocol/sync-changes')
    .flatMap(request => {
      const syncFlags = (request.body as { flags: Record<string, string> }).flags;
      return JSON.parse(syncFlags['--changes-json'] ?? '[]') as Array<{
        filePath: string;
        source: string;
      }>;
    });
  const declared = synced
    .filter(entry => entry.source === 'agent_declared')
    .map(entry => entry.filePath);
  assert.deepEqual(declared, [
    'generated/one.ts',
    'generated/two.ts',
    'generated/a,b.ts',
    'src/removed.ts'
  ]);
  assert.equal(synced.filter(entry => entry.source === 'declared_edit').length, 31);
  assert.deepEqual(readActiveSessions(workspace), []);
  assert.deepEqual(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }),
    []
  );
});

test('deliver rejects the retired observed-dirty file surface before any backend call', async () => {
  let posted = false;
  const runtime = {
    backend: {
      baseUrl: 'http://example.test',
      health: async () => ({ ok: true }),
      get: async () => ({}),
      post: async () => {
        posted = true;
        return {};
      },
      patch: async () => ({}),
      delete: async () => ({})
    },
    close: () => {}
  } satisfies CliRuntime;

  await assert.rejects(
    () =>
      runProtocolCommand({
        runtime,
        subcommand: 'deliver',
        args: [
          '--objective-id',
          OBJECTIVE_DISPLAY_ID,
          '--session-key',
          SESSION_KEY,
          '--summary',
          'Done.',
          '--observed-dirty-paths-file',
          'retired.json'
        ]
      }),
    /--observed-dirty-paths-file was removed/
  );
  assert.equal(posted, false);
});

test('deliver preserves the exact binding when ledger synchronization cannot progress', async () => {
  const workspace = makeWorkspace();
  const newSessionKey = 'sess_reopened';
  const cacheIdentity = {
    missionId: MISSION_ID,
    workingDirectory: workspace,
    objectiveId: OBJECTIVE_DISPLAY_ID
  };
  const oldOnlyCacheIdentity = { ...cacheIdentity, objectiveId: 'old-session-cache-alias' };
  writeCachedSessionKey({ ...cacheIdentity, sessionKey: SESSION_KEY });
  writeCachedSessionKey({ ...oldOnlyCacheIdentity, sessionKey: SESSION_KEY });
  appendChangeEvidence({
    workingDirectory: workspace,
    objectiveId: OBJECTIVE_ID,
    sessionKey: SESSION_KEY,
    filePaths: ['src/retry.ts'],
    source: 'declared_edit'
  });
  let acceptSync = false;
  const runtime = {
    backend: {
      baseUrl: 'http://example.test',
      health: async () => ({ ok: true }),
      get: async () => {
        throw new Error('unexpected GET');
      },
      post: async ({ path: requestPath, body }: { path: string; body: unknown }) => {
        if (requestPath !== '/api/protocol/sync-changes') return {};
        if (!acceptSync) return { outcomes: [] };
        const entries = JSON.parse(
          (body as { flags: Record<string, string> }).flags['--changes-json'] ?? '[]'
        ) as Array<{ idempotencyKey: string; filePath: string }>;
        return {
          outcomes: entries.map(entry => ({
            idempotencyKey: entry.idempotencyKey,
            filePath: entry.filePath,
            status: 'accepted'
          }))
        };
      },
      patch: async () => {
        throw new Error('unexpected PATCH');
      },
      delete: async () => {
        throw new Error('unexpected DELETE');
      }
    },
    close: () => {}
  } satisfies CliRuntime;

  const originalCwd = process.cwd();
  process.chdir(workspace);
  try {
    await runProtocolCommand({
      runtime,
      subcommand: 'deliver',
      args: [
        '--session-key',
        SESSION_KEY,
        '--objective-id',
        OBJECTIVE_DISPLAY_ID,
        '--summary',
        'Done.'
      ]
    });
  } finally {
    process.chdir(originalCwd);
  }

  assert.equal(readActiveSessions(workspace)[0]?.sessionKey, SESSION_KEY);
  assert.equal(readActiveSessions(workspace)[0]?.deliveryPendingSync, true);
  assert.equal(readCachedSessionKey(cacheIdentity), SESSION_KEY);
  assert.deepEqual(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }).map(entry => entry.filePath),
    ['src/retry.ts']
  );
  assert.deepEqual(
    captureChangeFromPayload({
      agent: 'claude',
      rawPayload: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: 'src/after-delivery.ts' },
        cwd: workspace
      }),
      objectiveOverride: OBJECTIVE_DISPLAY_ID,
      fallbackCwd: workspace
    }),
    { recorded: false, reason: 'no matching objective session binding' }
  );

  writeActiveSession({
    workingDirectory: workspace,
    missionId: MISSION_ID,
    objectiveId: OBJECTIVE_ID,
    objectiveAliases: [OBJECTIVE_DISPLAY_ID],
    sessionKey: newSessionKey
  });
  writeCachedSessionKey({ ...cacheIdentity, sessionKey: newSessionKey });
  appendChangeEvidence({
    workingDirectory: workspace,
    objectiveId: OBJECTIVE_ID,
    sessionKey: newSessionKey,
    filePaths: ['src/reopened.ts'],
    source: 'declared_edit'
  });

  acceptSync = true;
  const retryCwd = process.cwd();
  process.chdir(workspace);
  try {
    await runProtocolCommand({
      runtime,
      subcommand: 'changes',
      args: ['--objective-id', OBJECTIVE_DISPLAY_ID]
    });
  } finally {
    process.chdir(retryCwd);
  }
  assert.deepEqual(
    readActiveSessions(workspace).map(entry => ({
      sessionKey: entry.sessionKey,
      deliveryPendingSync: entry.deliveryPendingSync
    })),
    [{ sessionKey: newSessionKey, deliveryPendingSync: false }]
  );
  assert.deepEqual(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }),
    []
  );
  assert.deepEqual(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: newSessionKey
    }),
    []
  );
  assert.equal(readCachedSessionKey(oldOnlyCacheIdentity), undefined);
  assert.equal(readCachedSessionKey(cacheIdentity), newSessionKey);
});

test('changes returns the local objective read without inspecting the worktree', async () => {
  const workspace = makeWorkspace();
  const runtime = {
    backend: {
      baseUrl: 'http://example.test',
      health: async () => ({ ok: true }),
      get: async () => {
        throw new Error('unexpected GET');
      },
      post: async () => ({ outcomes: [] }),
      patch: async () => {
        throw new Error('unexpected PATCH');
      },
      delete: async () => {
        throw new Error('unexpected DELETE');
      }
    },
    close: () => {}
  } satisfies CliRuntime;

  const originalCwd = process.cwd();
  process.chdir(workspace);
  let output: unknown;
  try {
    output = await captureStdout(() =>
      runProtocolCommand({
        runtime,
        subcommand: 'changes',
        args: ['--session-key', SESSION_KEY, '--objective-id', OBJECTIVE_DISPLAY_ID]
      })
    );
  } finally {
    process.chdir(originalCwd);
  }

  assert.deepEqual(output, {
    scope: 'local_objective_sessions',
    objectiveId: OBJECTIVE_ID,
    coverage: 'available',
    items: [],
    total: 0,
    limit: 200,
    truncated: false,
    sync: { synced: 0, pending: 0, failed: false },
    capture: { bindingState: 'unknown', callbackObserved: false, healthCodes: [] },
    warnings: ['unknown_binding']
  });
});

test('changes reports unavailable coverage, not an empty list, without a local session', async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'ovld-layer3-unbound-'));
  const runtime = {
    backend: {
      baseUrl: 'http://example.test',
      health: async () => ({ ok: true }),
      get: async () => {
        throw new Error('unexpected GET');
      },
      post: async () => {
        throw new Error('the local read never reaches the backend without a session');
      },
      patch: async () => ({}),
      delete: async () => ({})
    },
    close: () => {}
  } satisfies CliRuntime;
  const originalCwd = process.cwd();
  process.chdir(workspace);
  try {
    const output = (await captureStdout(() =>
      runProtocolCommand({
        runtime,
        subcommand: 'changes',
        args: ['--objective-id', OBJECTIVE_DISPLAY_ID]
      })
    )) as { coverage: string; items: unknown[] };
    assert.equal(output.coverage, 'unavailable');
    assert.deepEqual(output.items, []);
    await assert.rejects(
      () =>
        runProtocolCommand({
          runtime,
          subcommand: 'changes',
          args: ['--objective-id', OBJECTIVE_DISPLAY_ID, '--mission-id', 'coo:999']
        }),
      /does not belong to mission coo:999/
    );
    await assert.rejects(
      () =>
        runProtocolCommand({
          runtime,
          subcommand: 'changes',
          args: ['--objective-id', OBJECTIVE_DISPLAY_ID, '--session-key', 'sess_foreign']
        }),
      /does not identify a local session/
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('changes never prints or transmits stored ledger rows with hostile extra fields', async () => {
  const workspace = makeWorkspace();
  const identity = {
    workingDirectory: workspace,
    objectiveId: OBJECTIVE_ID,
    sessionKey: SESSION_KEY
  };
  appendChangeEvidence({
    ...identity,
    filePaths: ['src/hostile.ts'],
    source: 'declared_edit'
  });
  recordChangeLedgerHealth({ ...identity, code: 'direct_path_observed' });

  const ledgerDirectory = path.join(process.env.OVLD_HOME ?? '', 'change-ledgers');
  const [ledgerName] = readdirSync(ledgerDirectory);
  assert.ok(ledgerName);
  const ledgerPath = path.join(ledgerDirectory, ledgerName);
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as {
    evidence: Array<Record<string, unknown>>;
    health: Array<Record<string, unknown>>;
  };
  const secret = 'raw secret /private/repository/token';
  const validEvidence = ledger.evidence[0];
  const validHealth = ledger.health[0];
  assert.ok(validEvidence);
  assert.ok(validHealth);
  ledger.evidence = [
    {
      ...validEvidence,
      vcsStatus: 'M',
      state: 'modified',
      absolutePath: '/private/repository/hostile.ts',
      content: secret
    },
    { ...validEvidence, idempotencyKey: secret },
    { ...validEvidence, observedAt: secret },
    { ...validEvidence, syncedAt: secret }
  ];
  ledger.health = [
    { ...validHealth, content: secret },
    { ...validHealth, at: secret }
  ];
  writeFileSync(ledgerPath, JSON.stringify(ledger));

  const requests: unknown[] = [];
  const runtime = {
    backend: {
      baseUrl: 'http://example.test',
      health: async () => ({ ok: true }),
      get: async () => ({}),
      post: async (request: unknown) => {
        requests.push(request);
        return { outcomes: [] };
      },
      patch: async () => ({}),
      delete: async () => ({})
    },
    close: () => {}
  } satisfies CliRuntime;

  const originalCwd = process.cwd();
  process.chdir(workspace);
  let output: unknown;
  try {
    output = await captureStdout(() =>
      runProtocolCommand({
        runtime,
        subcommand: 'changes',
        args: ['--session-key', SESSION_KEY, '--objective-id', OBJECTIVE_DISPLAY_ID]
      })
    );
  } finally {
    process.chdir(originalCwd);
  }

  // Only bounded capture diagnostics travel; no hostile stored row is transmitted.
  assert.equal(requests.length, 1);
  const sentFlags = (requests[0] as { body: { flags: Record<string, string> } }).body.flags;
  assert.equal(sentFlags['--changes-json'], '[]');
  assert.doesNotMatch(JSON.stringify(requests), /raw secret|private\/repository|vcsStatus/);
  assert.deepEqual((output as { items: unknown[] }).items, []);
  assert.deepEqual((output as { capture: { healthCodes: string[] } }).capture.healthCodes, []);
  assert.doesNotMatch(JSON.stringify(output), /raw secret|private\/repository|vcsStatus|"state"/);

  recordChangeLedgerHealth({ ...identity, code: 'invalid_stored_rows_rejected' });
  const rewritten = readFileSync(ledgerPath, 'utf8');
  assert.doesNotMatch(rewritten, /raw secret|private\/repository|vcsStatus|"state"/);
});

test('changes recovers the live exact binding when its session-key cache is missing', async () => {
  const workspace = makeWorkspace();
  appendChangeEvidence({
    workingDirectory: workspace,
    objectiveId: OBJECTIVE_ID,
    sessionKey: SESSION_KEY,
    filePaths: ['src/cacheless.ts'],
    source: 'declared_edit'
  });
  const runtime = {
    backend: {
      baseUrl: 'http://example.test',
      health: async () => ({ ok: true }),
      get: async () => ({}),
      post: async ({ body }: { body: unknown }) => {
        const entries = JSON.parse(
          (body as { flags: Record<string, string> }).flags['--changes-json'] ?? '[]'
        ) as Array<{ idempotencyKey: string; filePath: string }>;
        return {
          outcomes: entries.map(entry => ({
            status: 'accepted',
            idempotencyKey: entry.idempotencyKey,
            filePath: entry.filePath
          }))
        };
      },
      patch: async () => ({}),
      delete: async () => ({})
    },
    close: () => {}
  } satisfies CliRuntime;

  const originalCwd = process.cwd();
  process.chdir(workspace);
  let output: unknown;
  try {
    output = await captureStdout(() =>
      runProtocolCommand({
        runtime,
        subcommand: 'changes',
        args: ['--objective-id', OBJECTIVE_DISPLAY_ID]
      })
    );
  } finally {
    process.chdir(originalCwd);
  }

  const local = output as {
    total: number;
    items: Array<{ filePath: string; source: string; syncState: string }>;
    sync: { pending: number };
  };
  assert.equal(local.total, 1);
  assert.deepEqual(
    local.items.map(item => [item.filePath, item.source, item.syncState]),
    [['src/cacheless.ts', 'declared_edit', 'synced']]
  );
  assert.equal(local.sync.pending, 0);
  assert.deepEqual(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }),
    []
  );
});

test('changes stops when backend acknowledgements do not match exact batch key and path', async () => {
  const workspace = makeWorkspace();
  appendChangeEvidence({
    workingDirectory: workspace,
    objectiveId: OBJECTIVE_ID,
    sessionKey: SESSION_KEY,
    filePaths: ['src/still-pending.ts'],
    source: 'declared_edit'
  });
  let syncCalls = 0;
  const runtime = {
    backend: {
      baseUrl: 'http://example.test',
      health: async () => ({ ok: true }),
      get: async () => ({}),
      post: async ({ body }: { body: unknown }) => {
        syncCalls += 1;
        if (syncCalls > 1) throw new Error('drain repeated without progress');
        const [submitted] = JSON.parse(
          (body as { flags: Record<string, string> }).flags['--changes-json'] ?? '[]'
        ) as Array<{ idempotencyKey: string }>;
        assert.ok(submitted);
        return {
          outcomes: [
            {
              status: 'accepted',
              idempotencyKey: submitted.idempotencyKey,
              filePath: 'src/wrong-path.ts'
            },
            {
              status: 'accepted',
              idempotencyKey: 'not-in-the-batch',
              filePath: 'src/still-pending.ts'
            }
          ]
        };
      },
      patch: async () => ({}),
      delete: async () => ({})
    },
    close: () => {}
  } satisfies CliRuntime;

  const originalCwd = process.cwd();
  process.chdir(workspace);
  let output: unknown;
  try {
    output = await captureStdout(() =>
      runProtocolCommand({
        runtime,
        subcommand: 'changes',
        args: ['--session-key', SESSION_KEY, '--objective-id', OBJECTIVE_DISPLAY_ID]
      })
    );
  } finally {
    process.chdir(originalCwd);
  }

  assert.equal(syncCalls, 1);
  const local = output as {
    items: Array<{ syncState: string }>;
    sync: { failed: boolean; pending: number };
    warnings: string[];
  };
  assert.deepEqual(local.sync, { synced: 0, pending: 1, failed: true });
  assert.equal(local.items[0]?.syncState, 'pending');
  assert.ok(local.warnings.includes('sync_failed'));
  assert.equal(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }).length,
    1
  );
});

test('explicit sync-changes requires an exact local tuple and exact acknowledgement identity', async () => {
  const workspace = makeWorkspace();
  appendChangeEvidence({
    workingDirectory: workspace,
    objectiveId: OBJECTIVE_ID,
    sessionKey: SESSION_KEY,
    filePaths: ['src/one.ts', 'src/two.ts'],
    source: 'declared_edit'
  });
  const [first] = readUnsyncedChangeEvidence({
    workingDirectory: workspace,
    objectiveId: OBJECTIVE_ID,
    sessionKey: SESSION_KEY
  });
  assert.ok(first);
  const runtime = {
    backend: {
      baseUrl: 'http://example.test',
      health: async () => ({ ok: true }),
      get: async () => ({}),
      post: async ({ body }: { body: unknown }) => {
        const changes = JSON.parse(
          (body as { flags: Record<string, string> }).flags['--changes-json'] ?? '[]'
        ) as Array<{ idempotencyKey: string; filePath: string }>;
        return {
          outcomes: changes.slice(0, 1).flatMap(change => [
            { status: 'accepted', ...change },
            { status: 'accepted', ...change },
            {
              status: 'accepted',
              idempotencyKey: 'not-submitted',
              filePath: change.filePath
            }
          ])
        };
      },
      patch: async () => ({}),
      delete: async () => ({})
    },
    close: () => {}
  } satisfies CliRuntime;

  const runSync = async (changes?: unknown[]) => {
    const originalCwd = process.cwd();
    process.chdir(workspace);
    try {
      await captureStdout(() =>
        runProtocolCommand({
          runtime,
          subcommand: 'sync-changes',
          args: [
            '--session-key',
            SESSION_KEY,
            '--objective-id',
            OBJECTIVE_DISPLAY_ID,
            ...(changes ? ['--changes-json', JSON.stringify(changes)] : [])
          ]
        })
      );
    } finally {
      process.chdir(originalCwd);
    }
  };

  await runSync([{ ...first, filePath: 'src/typo.ts' }]);
  assert.equal(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }).length,
    2
  );
  await runSync([{ ...first, source: 'agent_declared' }]);
  assert.equal(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }).length,
    2
  );
  await runSync();
  assert.deepEqual(
    readUnsyncedChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey: SESSION_KEY
    }).map(entry => entry.filePath),
    ['src/two.ts']
  );
});

test('changes bounds aggregate health across pending retry bindings', async () => {
  const workspace = makeWorkspace();
  for (let sessionIndex = 0; sessionIndex < 5; sessionIndex += 1) {
    const sessionKey = `sess_health_${sessionIndex}`;
    writeActiveSession({
      workingDirectory: workspace,
      missionId: MISSION_ID,
      objectiveId: OBJECTIVE_ID,
      objectiveAliases: [OBJECTIVE_DISPLAY_ID],
      sessionKey
    });
    appendChangeEvidence({
      workingDirectory: workspace,
      objectiveId: OBJECTIVE_ID,
      sessionKey,
      filePaths: [`pending-${sessionIndex}.ts`],
      source: 'declared_edit'
    });
    for (let codeIndex = 0; codeIndex < 32; codeIndex += 1) {
      recordChangeLedgerHealth({
        workingDirectory: workspace,
        objectiveId: OBJECTIVE_ID,
        sessionKey,
        code: `diagnostic_${sessionIndex}_${codeIndex}`
      });
    }
    assert.equal(
      finalizeActiveSession({ workingDirectory: workspace, objectiveId: OBJECTIVE_ID, sessionKey }),
      false
    );
  }
  const runtime = {
    backend: {
      baseUrl: 'http://example.test',
      health: async () => ({ ok: true }),
      get: async () => ({}),
      post: async () => ({ outcomes: [] }),
      patch: async () => ({}),
      delete: async () => ({})
    },
    close: () => {}
  } satisfies CliRuntime;

  const originalCwd = process.cwd();
  process.chdir(workspace);
  let output: unknown;
  try {
    output = await captureStdout(() =>
      runProtocolCommand({
        runtime,
        subcommand: 'changes',
        args: ['--objective-id', OBJECTIVE_DISPLAY_ID]
      })
    );
  } finally {
    process.chdir(originalCwd);
  }

  const local = output as {
    total: number;
    capture: { healthCodes: string[] };
    sync: { pending: number };
  };
  assert.equal(local.capture.healthCodes.length, 32);
  assert.equal(local.total, 5);
  assert.equal(local.sync.pending, 5);
});

test('attach records an honest capture binding from the explicit launch objective', async () => {
  const attachWith = async (launchObjective: string | undefined) => {
    process.env.OVLD_HOME = mkdtempSync(path.join(os.tmpdir(), 'ovld-attach-binding-home-'));
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'ovld-attach-binding-workspace-'));
    const sessionKey = 'sess_binding';
    const attachFlags: Array<Record<string, unknown>> = [];
    const runtime = {
      backend: {
        baseUrl: 'http://example.test',
        health: async () => ({ ok: true }),
        get: async () => ({}),
        post: async ({ path: requestPath, body }: { path: string; body: unknown }) => {
          if (requestPath !== '/api/protocol/attach') return {};
          attachFlags.push((body as { flags: Record<string, unknown> }).flags);
          return {
            sessionKey,
            mission: { id: 'mission-uuid', displayId: MISSION_ID, title: 'Mission' },
            objective: { id: OBJECTIVE_ID, displayId: OBJECTIVE_DISPLAY_ID }
          };
        },
        patch: async () => ({}),
        delete: async () => ({})
      },
      close: () => {}
    } satisfies CliRuntime;
    const previous = process.env.OVERLORD_OBJECTIVE_ID;
    if (launchObjective === undefined) delete process.env.OVERLORD_OBJECTIVE_ID;
    else process.env.OVERLORD_OBJECTIVE_ID = launchObjective;
    const originalCwd = process.cwd();
    process.chdir(workspace);
    try {
      await captureStdoutText(() =>
        runProtocolCommand({
          runtime,
          subcommand: 'attach',
          args: ['--objective-id', OBJECTIVE_DISPLAY_ID, '--capture-binding', 'bound']
        })
      );
    } finally {
      process.chdir(originalCwd);
      if (previous === undefined) delete process.env.OVERLORD_OBJECTIVE_ID;
      else process.env.OVERLORD_OBJECTIVE_ID = previous;
    }
    return {
      sent: attachFlags[0]?.['--capture-binding'],
      local: readChangeLedgerSnapshot({
        workingDirectory: workspace,
        objectiveId: OBJECTIVE_ID,
        sessionKey
      })?.capture
    };
  };

  // No launch objective: the hook cannot capture; a caller-supplied claim is ignored.
  assert.deepEqual(await attachWith(undefined), {
    sent: 'unbound',
    local: { bindingState: 'unbound' }
  });
  assert.deepEqual(await attachWith(OBJECTIVE_DISPLAY_ID), {
    sent: 'bound',
    local: { bindingState: 'bound' }
  });
  // Same objective in another form resolves against the attach response.
  assert.deepEqual(await attachWith(OBJECTIVE_ID), {
    sent: undefined,
    local: { bindingState: 'bound' }
  });
  assert.deepEqual(await attachWith('coo:1.other'), {
    sent: undefined,
    local: { bindingState: 'unbound' }
  });
});

for (const mode of ['no-callback', 'claude-edit', 'unavailable-storage', 'sync-failure'] as const) {
  test(`attach then deliver declared paths after 64 objectives: ${mode}`, async () => {
    process.env.OVLD_HOME = mkdtempSync(path.join(os.tmpdir(), 'ovld-declaration-home-'));
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'Tough Leaf declaration '));
    // Reproduce the real checkout's accumulated bindings, without evicting them.
    for (let index = 0; index < 64; index++) {
      assert.equal(
        writeActiveSession({
          workingDirectory: workspace,
          missionId: MISSION_ID,
          objectiveId: `prior-${index}`,
          objectiveAliases: [],
          sessionKey: `sess_prior_${index}`
        }),
        true
      );
    }
    if (mode === 'unavailable-storage' || mode === 'sync-failure') {
      const directory = path.join(process.env.OVLD_HOME, 'active-objective-sessions');
      for (const file of readdirSync(directory).filter(file => file.endsWith('.json'))) {
        writeFileSync(path.join(directory, file), '{invalid manifest');
      }
    }
    const requests: Array<{ path: string; body: { flags: Record<string, string> } }> = [];
    const runtime = {
      backend: {
        baseUrl: 'http://example.test',
        health: async () => ({ ok: true }),
        get: async () => ({}),
        post: async ({ path: requestPath, body }: { path: string; body: unknown }) => {
          const typed = body as { flags: Record<string, string> };
          requests.push({ path: requestPath, body: typed });
          if (requestPath === '/api/protocol/attach')
            return {
              sessionKey: SESSION_KEY,
              mission: { id: 'mission-uuid', displayId: MISSION_ID },
              objective: { id: OBJECTIVE_ID, displayId: OBJECTIVE_DISPLAY_ID }
            };
          if (mode === 'sync-failure' && requestPath === '/api/protocol/sync-changes')
            throw new Error('offline');
          if (requestPath === '/api/protocol/sync-changes')
            return {
              capture: { status: 'accepted' },
              outcomes: (
                JSON.parse(typed.flags['--changes-json'] ?? '[]') as Array<Record<string, unknown>>
              ).map(entry => ({ ...entry, status: 'accepted' }))
            };
          return {};
        },
        patch: async () => ({}),
        delete: async () => ({})
      },
      close: () => {}
    } satisfies CliRuntime;
    const priorCwd = process.cwd();
    const priorObjective = process.env.OVERLORD_OBJECTIVE_ID;
    process.env.OVERLORD_OBJECTIVE_ID = OBJECTIVE_DISPLAY_ID;
    process.chdir(workspace);
    try {
      await captureStdoutText(() =>
        runProtocolCommand({
          runtime,
          subcommand: 'attach',
          args: ['--objective-id', OBJECTIVE_DISPLAY_ID]
        })
      );
      if (mode !== 'unavailable-storage' && mode !== 'sync-failure')
        assert.equal(readActiveSessions(workspace).length, 65);
      if (mode === 'claude-edit') {
        captureChangeFromPayload({
          agent: 'claude',
          objectiveOverride: OBJECTIVE_DISPLAY_ID,
          fallbackCwd: workspace,
          rawPayload: JSON.stringify({
            cwd: workspace,
            hook_event_name: 'PostToolUse',
            tool_name: 'Edit',
            tool_input: { file_path: path.join(workspace, 'native edit.ts') },
            tool_response: { success: true }
          })
        });
      }
      const changes = (await captureStdout(() =>
        runProtocolCommand({
          runtime,
          subcommand: 'changes',
          args: ['--objective-id', OBJECTIVE_DISPLAY_ID]
        })
      )) as {
        coverage: string;
        capture: { callbackObserved: boolean; healthCodes: string[] };
        warnings: string[];
      };
      assert.equal(changes.capture.callbackObserved, mode === 'claude-edit');
      if (mode === 'unavailable-storage' || mode === 'sync-failure') {
        assert.equal(changes.coverage, 'unavailable');
        assert.deepEqual(changes.capture.healthCodes, ['binding_file_unreadable_or_invalid']);
      }
      if (mode === 'no-callback') assert.ok(changes.warnings.includes('bound_no_callback'));
      writeFileSync(path.join(workspace, '.overlordignore'), 'ignored.ts\n');
      const pathsFile = path.join(workspace, 'paths.json');
      writeFileSync(
        pathsFile,
        JSON.stringify([
          ...Array.from({ length: 27 }, (_, index) => `generated/file ${index}.ts`),
          '../escape.ts',
          'ignored.ts',
          '.overlord/project.json'
        ])
      );
      await captureStdoutText(() =>
        runProtocolCommand({
          runtime,
          subcommand: 'deliver',
          args: [
            '--objective-id',
            OBJECTIVE_DISPLAY_ID,
            '--session-key',
            SESSION_KEY,
            '--summary',
            'Done',
            '--paths',
            'inline.ts',
            '--paths-file',
            pathsFile
          ]
        })
      );
      const evidence = requests
        .filter(request => request.path === '/api/protocol/sync-changes')
        .flatMap(request => JSON.parse(request.body.flags['--changes-json'] ?? '[]')) as Array<{
        filePath: string;
        source: string;
      }>;
      assert.equal(evidence.filter(entry => entry.source === 'agent_declared').length, 28);
      assert.equal(
        evidence.filter(entry => entry.source === 'declared_edit').length,
        mode === 'claude-edit' ? 1 : 0
      );
      assert.ok(
        !evidence.some(entry =>
          ['../escape.ts', 'ignored.ts', '.overlord/project.json'].includes(entry.filePath)
        )
      );
      assert.equal(requests.at(-1)?.path, '/api/protocol/deliver');
      assert.equal(requests.at(-1)?.body.flags['--paths'], undefined);
    } finally {
      process.chdir(priorCwd);
      if (priorObjective === undefined) delete process.env.OVERLORD_OBJECTIVE_ID;
      else process.env.OVERLORD_OBJECTIVE_ID = priorObjective;
    }
  });
}
