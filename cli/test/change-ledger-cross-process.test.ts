import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readActiveSessions, writeActiveSession } from '../src/active-objective-sessions.ts';
import {
  appendChangeEvidence,
  markChangeEvidenceSynced,
  readChangeLedgerEvidence,
  readUnsyncedChangeEvidence
} from '../src/change-ledger.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const ledgerModuleUrl = pathToFileURL(path.join(here, '..', 'src', 'change-ledger.ts')).href;
const sessionsModuleUrl = pathToFileURL(
  path.join(here, '..', 'src', 'active-objective-sessions.ts')
).href;
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'));

function makeScope(prefix: string): { home: string; workspace: string } {
  const home = mkdtempSync(path.join(tmpdir(), `${prefix}-home-`));
  process.env.OVLD_HOME = home;
  return {
    home,
    workspace: mkdtempSync(path.join(tmpdir(), `${prefix}-workspace-`))
  };
}

async function waitForFiles(files: string[], timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!files.every(existsSync)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for child-process barrier');
    await delay(10);
  }
}

/** Load each subject first, then release all independent processes together. */
async function runSimultaneously({
  workingDirectory,
  home,
  moduleUrl,
  preloadModuleUrls = [],
  operations
}: {
  workingDirectory: string;
  home: string;
  moduleUrl: string;
  preloadModuleUrls?: string[];
  operations: string[];
}): Promise<void> {
  const coordination = mkdtempSync(path.join(tmpdir(), 'ovld-xproc-barrier-'));
  const barrier = path.join(coordination, 'go');
  const readyFiles = operations.map((_, index) => path.join(coordination, `ready-${index}`));
  const children = operations.map((operation, index) => {
    const script = `
      import { existsSync, writeFileSync } from 'node:fs';
      import { setTimeout as delay } from 'node:timers/promises';
      const subject = await import(${JSON.stringify(moduleUrl)});
      const preloaded = await Promise.all(
        ${JSON.stringify(preloadModuleUrls)}.map(moduleUrl => import(moduleUrl))
      );
      writeFileSync(${JSON.stringify(readyFiles[index])}, 'ready');
      while (!existsSync(${JSON.stringify(barrier)})) await delay(2);
      ${operation}
    `;
    const child = spawn(
      process.execPath,
      ['--import', tsxLoader, '--input-type=module', '-e', script],
      {
        cwd: workingDirectory,
        env: { ...process.env, OVLD_HOME: home },
        stdio: ['ignore', 'ignore', 'pipe']
      }
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    const done = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => {
        if (code === 0) resolve();
        else reject(new Error(`Child exited ${String(code)}: ${stderr}`));
      });
    });
    return { child, done };
  });

  try {
    await waitForFiles(readyFiles);
  } finally {
    writeFileSync(barrier, 'go');
  }
  await Promise.all(children.map(({ done }) => done));
}

test('simultaneous CLI writers lose no ledger evidence and keep storage owner-only', async () => {
  const { home, workspace } = makeScope('ovld-ledger-writers');
  const objectiveId = 'objective-concurrent';
  const sessionKey = 'sess_concurrent';
  const operations = Array.from(
    { length: 16 },
    (_, index) => `
      const appended = subject.appendChangeEvidence({
        workingDirectory: ${JSON.stringify(workspace)},
        objectiveId: ${JSON.stringify(objectiveId)},
        sessionKey: ${JSON.stringify(sessionKey)},
        filePaths: [${JSON.stringify(`src/file-${index}.ts`)}],
        source: 'declared_edit'
      });
      if (appended !== 1) throw new Error(${JSON.stringify(`append ${index} did not commit`)});
    `
  );

  await runSimultaneously({
    workingDirectory: workspace,
    home,
    moduleUrl: ledgerModuleUrl,
    operations
  });

  assert.deepEqual(
    readUnsyncedChangeEvidence({ workingDirectory: workspace, objectiveId, sessionKey })
      .map(entry => entry.filePath)
      .sort(),
    Array.from({ length: 16 }, (_, index) => `src/file-${index}.ts`).sort()
  );
  const ledgerDirectory = path.join(home, 'change-ledgers');
  const ledgerFiles = readdirSync(ledgerDirectory).filter(name => name.endsWith('.json'));
  assert.equal(ledgerFiles.length, 1);
  assert.equal(statSync(ledgerDirectory).mode & 0o777, 0o700);
  assert.equal(statSync(path.join(ledgerDirectory, ledgerFiles[0]!)).mode & 0o777, 0o600);
});

test('simultaneous append and mark-synced transactions preserve both updates', async () => {
  const { home, workspace } = makeScope('ovld-ledger-mark-race');
  const identity = {
    workingDirectory: workspace,
    objectiveId: 'objective-mark-race',
    sessionKey: 'sess_mark_race'
  };
  const seedPaths = Array.from({ length: 8 }, (_, index) => `seed-${index}.ts`);
  assert.equal(
    appendChangeEvidence({ ...identity, filePaths: seedPaths, source: 'declared_edit' }),
    seedPaths.length
  );
  const seed = readUnsyncedChangeEvidence(identity);
  const operations = [
    ...seed.map(
      entry => `
        subject.markChangeEvidenceSynced({
          workingDirectory: ${JSON.stringify(workspace)},
          objectiveId: ${JSON.stringify(identity.objectiveId)},
          sessionKey: ${JSON.stringify(identity.sessionKey)},
          evidence: [{
            idempotencyKey: ${JSON.stringify(entry.idempotencyKey)},
            filePath: ${JSON.stringify(entry.filePath)}
          }]
        });
      `
    ),
    ...Array.from(
      { length: 8 },
      (_, index) => `
        const appended = subject.appendChangeEvidence({
          workingDirectory: ${JSON.stringify(workspace)},
          objectiveId: ${JSON.stringify(identity.objectiveId)},
          sessionKey: ${JSON.stringify(identity.sessionKey)},
          filePaths: [${JSON.stringify(`appended-${index}.ts`)}],
          source: 'declared_edit'
        });
        if (appended !== 1) throw new Error(${JSON.stringify(`append ${index} did not commit`)});
      `
    )
  ];

  await runSimultaneously({
    workingDirectory: workspace,
    home,
    moduleUrl: ledgerModuleUrl,
    operations
  });

  const evidence = readChangeLedgerEvidence(identity);
  assert.equal(evidence.length, 16);
  assert.ok(
    evidence.filter(entry => entry.filePath.startsWith('seed-')).every(entry => entry.syncedAt)
  );
  assert.ok(
    evidence.filter(entry => entry.filePath.startsWith('appended-')).every(entry => !entry.syncedAt)
  );
});

test('simultaneous session-manifest writers retain every canonical objective binding', async () => {
  const { home, workspace } = makeScope('ovld-session-writers');
  const operations = Array.from(
    { length: 12 },
    (_, index) => `
      subject.writeActiveSession({
        workingDirectory: ${JSON.stringify(workspace)},
        missionId: 'coo:825',
        objectiveId: ${JSON.stringify(`objective-${index}-uuid`)},
        objectiveAliases: [${JSON.stringify(`coo:825.${index}`)}],
        sessionKey: ${JSON.stringify(`sess_${index}`)}
      });
    `
  );

  await runSimultaneously({
    workingDirectory: workspace,
    home,
    moduleUrl: sessionsModuleUrl,
    operations
  });

  assert.deepEqual(
    readActiveSessions(workspace)
      .map(entry => entry.objectiveId)
      .sort(),
    Array.from({ length: 12 }, (_, index) => `objective-${index}-uuid`).sort()
  );
  const manifestDirectory = path.join(home, 'active-objective-sessions');
  const manifests = readdirSync(manifestDirectory).filter(name => name.endsWith('.json'));
  assert.equal(manifests.length, 1);
  assert.equal(statSync(manifestDirectory).mode & 0o777, 0o700);
  assert.equal(statSync(path.join(manifestDirectory, manifests[0]!)).mode & 0o777, 0o600);
});

test('finalization cannot orphan a capture holding the active-session transaction', async () => {
  const { home, workspace } = makeScope('ovld-capture-finalize-race');
  const objectiveId = 'objective-finalize-race';
  const objectiveAlias = 'coo:825.finalize';
  const sessionKey = 'sess_finalize_race';
  const identity = { workingDirectory: workspace, objectiveId, sessionKey };
  writeActiveSession({
    workingDirectory: workspace,
    missionId: 'coo:825',
    objectiveId,
    objectiveAliases: [objectiveAlias],
    sessionKey
  });
  appendChangeEvidence({
    ...identity,
    filePaths: ['already-synced.ts'],
    source: 'declared_edit'
  });
  const [seed] = readUnsyncedChangeEvidence(identity);
  assert.ok(seed);
  markChangeEvidenceSynced({
    ...identity,
    evidence: [{ idempotencyKey: seed.idempotencyKey, filePath: seed.filePath }]
  });

  const captureHoldingLock = path.join(workspace, '.capture-holding-manifest-lock');
  await runSimultaneously({
    workingDirectory: workspace,
    home,
    moduleUrl: sessionsModuleUrl,
    preloadModuleUrls: [ledgerModuleUrl],
    operations: [
      `
        subject.withActiveObjectiveSession({
          workingDirectory: ${JSON.stringify(workspace)},
          objectiveId: ${JSON.stringify(objectiveAlias)},
          fallback: 0,
          action: session => {
            writeFileSync(${JSON.stringify(captureHoldingLock)}, 'held');
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
            return preloaded[0].appendChangeEvidence({
              workingDirectory: ${JSON.stringify(workspace)},
              objectiveId: session.objectiveId,
              sessionKey: session.sessionKey,
              filePaths: ['captured-during-finalize.ts'],
              source: 'declared_edit'
            });
          }
        });
      `,
      `
        while (!existsSync(${JSON.stringify(captureHoldingLock)})) await delay(2);
        subject.finalizeActiveSession({
          workingDirectory: ${JSON.stringify(workspace)},
          objectiveId: ${JSON.stringify(objectiveId)},
          sessionKey: ${JSON.stringify(sessionKey)}
        });
      `
    ]
  });

  assert.equal(readActiveSessions(workspace)[0]?.sessionKey, sessionKey);
  assert.deepEqual(
    readUnsyncedChangeEvidence(identity).map(entry => entry.filePath),
    ['captured-during-finalize.ts']
  );
});
