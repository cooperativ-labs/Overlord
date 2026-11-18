import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runProtocolCommand } from '../src/commands.ts';
import { CliError } from '../src/errors.ts';
import type { CliRuntime } from '../src/runtime.ts';

/**
 * Draft report evidence through the CLI (coo:1297.c6h4, ADR 0078): the batch
 * travels as --report-draft-file with the caller's own operationId (the CLI
 * never mints or rewrites it), --summary is optional with a batch, a retried
 * command resends the identical batch, and a draft refusal prints its fresh
 * draft on stdout.
 */

type Sent = { path: string; flags: Record<string, unknown>; fileInputs?: Record<string, string> };

function fakeRuntime(answer: (sent: Sent) => unknown): { runtime: CliRuntime; sent: Sent[] } {
  const sent: Sent[] = [];
  const runtime = {
    backend: {
      baseUrl: 'http://example.test',
      health: async () => ({ ok: true }),
      get: async () => {
        throw new Error('unexpected GET');
      },
      post: async ({ path: requestPath, body }: { path: string; body?: unknown }) => {
        const record = body as {
          flags: Record<string, unknown>;
          fileInputs?: Record<string, string>;
        };
        const entry = { path: requestPath, flags: record.flags, fileInputs: record.fileInputs };
        sent.push(entry);
        return answer(entry);
      },
      patch: async () => {
        throw new Error('unexpected PATCH');
      },
      delete: async () => {
        throw new Error('unexpected DELETE');
      },
      postRaw: async () => {
        throw new Error('unexpected postRaw');
      }
    },
    close: () => {}
  } as unknown as CliRuntime;
  return { runtime, sent };
}

async function inWorkspace<T>(run: () => Promise<T>): Promise<{ result: T; stdout: string }> {
  process.env.OVLD_HOME = mkdtempSync(path.join(os.tmpdir(), 'ovld-draft-home-'));
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'ovld-draft-workspace-'));
  const originalCwd = process.cwd();
  const originalWrite = process.stdout.write.bind(process.stdout);
  let stdout = '';
  process.chdir(workspace);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    return { result: await run(), stdout };
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }
}

test('update sends the caller-retained draft batch unchanged and needs no summary', async () => {
  const batch = {
    operationId: 'cli-batch-00001',
    expectedRevision: 0,
    operations: [{ op: 'upsert', entryId: 'r1', kind: 'known_risk', content: { text: 'x' } }]
  };
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'ovld-draft-file-')), 'batch.json');
  writeFileSync(file, JSON.stringify(batch));
  const { runtime, sent } = fakeRuntime(() => ({
    eventId: 'e1',
    reportDraft: { draftId: 'd1', operationId: 'cli-batch-00001', revision: 1 }
  }));
  const args = [
    '--mission-id',
    'coo:9',
    '--session-key',
    'session-key',
    '--report-draft-file',
    file
  ];
  const { stdout } = await inWorkspace(async () => {
    await runProtocolCommand({ runtime, subcommand: 'update', args });
    // A lost response: the same command resends the same batch identity.
    await runProtocolCommand({ runtime, subcommand: 'update', args });
  });
  assert.equal(sent.length, 2);
  for (const request of sent) {
    assert.equal(request.path, '/api/protocol/update');
    assert.equal('--summary' in request.flags, false);
    assert.equal('--operation-id' in request.flags, false, 'no finalization id is minted');
    assert.deepEqual(JSON.parse(request.fileInputs!['--report-draft-file']!), batch);
  }
  assert.match(stdout, /"revision": 1/);
});

test('a draft conflict prints the fresh draft on stdout', async () => {
  const { runtime } = fakeRuntime(() => {
    throw new CliError({
      message: 'reportDraft.expectedRevision 0 does not match the current draft revision 2.',
      status: 409,
      payload: {
        error: 'stale',
        code: 'report_draft_conflict',
        details: { currentRevision: 2, draft: { id: 'd1', revision: 2, entries: [] } }
      }
    });
  });
  const { stdout } = await inWorkspace(async () => {
    await assert.rejects(
      runProtocolCommand({
        runtime,
        subcommand: 'update',
        args: [
          '--mission-id',
          'coo:9',
          '--session-key',
          'session-key',
          '--report-draft-json',
          JSON.stringify({ operationId: 'cli-batch-00002', expectedRevision: 0, operations: [] })
        ]
      })
    );
  });
  const printed = JSON.parse(stdout) as { code: string; details: { currentRevision: number } };
  assert.equal(printed.code, 'report_draft_conflict');
  assert.equal(printed.details.currentRevision, 2);
});

test('report-draft and a draft-aware deliver reach the backend with their flags', async () => {
  const { runtime, sent } = fakeRuntime(({ path: requestPath }) =>
    requestPath.endsWith('/report-draft')
      ? { draft: null, revision: 0, inspection: null, abandoned: [] }
      : { deliveryId: 'd1', eventId: 'e1', instruction: 'Delivered.' }
  );
  await inWorkspace(async () => {
    await runProtocolCommand({
      runtime,
      subcommand: 'report-draft',
      args: ['--mission-id', 'coo:9', '--session-key', 'session-key', '--include-withdrawn']
    });
    await runProtocolCommand({
      runtime,
      subcommand: 'deliver',
      args: [
        '--mission-id',
        'coo:9',
        '--session-key',
        'session-key',
        '--summary',
        'Done.',
        '--expected-draft-revision',
        '4'
      ]
    });
  });
  assert.equal(sent[0]!.path, '/api/protocol/report-draft');
  assert.equal(sent[0]!.flags['--include-withdrawn'], true);
  assert.equal(sent[1]!.path, '/api/protocol/deliver');
  assert.equal(sent[1]!.flags['--expected-draft-revision'], '4');
  assert.equal(
    typeof sent[1]!.flags['--operation-id'],
    'string',
    'deliver keeps its retry identity'
  );
});
