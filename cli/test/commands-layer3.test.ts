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
    source: 'declared_edit',
    quality: 'direct'
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

  assert.equal(requests.filter(request => request.path === '/api/protocol/sync-changes').length, 2);
  const delivery = requests.find(request => request.path === '/api/protocol/deliver');
  assert.ok(delivery);
  const flags = (delivery.body as { flags: Record<string, string | true> }).flags;
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

test('changes reports objective ledger health without inspecting the worktree', async () => {
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
    objectiveId: OBJECTIVE_ID,
    synced: 0,
    warning: null,
    unsyncedEvidence: 0,
    health: []
  });
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

  assert.deepEqual(requests, []);
  assert.deepEqual(output, {
    objectiveId: OBJECTIVE_ID,
    synced: 0,
    warning: null,
    unsyncedEvidence: 0,
    health: []
  });
  assert.doesNotMatch(JSON.stringify(output), /raw secret|private\/repository|vcsStatus|state/);

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

  assert.equal((output as { synced: number }).synced, 1);
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
  assert.equal((output as { warning: unknown }).warning, 'change ledger sync made no progress');
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
  await runSync([{ ...first, source: 'window_observed', quality: 'window' }]);
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

  assert.equal((output as { health: unknown[] }).health.length, 128);
  assert.equal((output as { unsyncedEvidence: number }).unsyncedEvidence, 5);
});
