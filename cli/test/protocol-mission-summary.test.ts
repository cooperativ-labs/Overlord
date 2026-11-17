import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveProtocolFileInputs, runProtocolCommand } from '../src/commands.ts';
import { CliError, missionSummaryConflictOutput } from '../src/errors.ts';
import type { CliRuntime } from '../src/runtime.ts';

/** CLI side of the agent-authored mission summary (coo:1260.shmg). */

function runtimeWithPost(post: CliRuntime['backend']['post']): CliRuntime {
  return {
    backend: {
      baseUrl: 'http://example.test',
      health: async () => ({ ok: true }),
      get: async () => {
        throw new Error('unexpected GET');
      },
      post,
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
  } satisfies CliRuntime;
}

async function inWorkspace<T>(run: () => Promise<T>): Promise<T> {
  process.env.OVLD_HOME = mkdtempSync(path.join(os.tmpdir(), 'ovld-mission-summary-home-'));
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'ovld-mission-summary-workspace-'));
  const originalCwd = process.cwd();
  process.chdir(workspace);
  try {
    return await run();
  } finally {
    process.chdir(originalCwd);
  }
}

async function captureStdout(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;
  try {
    await run();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
}

const summaryJson = JSON.stringify({
  baseContentRevision: 2,
  headline: 'The export works.',
  summary: 'Tested, not deployed.',
  closeItems: [{ id: 'item-1', status: 'done', reason: 'Fixed here.' }]
});

test('--mission-summary-file - streams the summary write as its own file input', async () => {
  const flags = new Map<string, string | true>([['--mission-summary-file', '-']]);
  const { fileInputs } = await resolveProtocolFileInputs({ flags, stdin: summaryJson });
  assert.equal(fileInputs['--mission-summary-file'], summaryJson);
});

test('deliver forwards --mission-summary-file to the backend', async () => {
  let posted: { path: string; body: Record<string, any> } | null = null;
  const runtime = runtimeWithPost(async ({ path: postPath, body }) => {
    posted = { path: postPath, body: body as Record<string, any> };
    return { deliveryId: 'delivery-1', eventId: 'event-1' } as never;
  });
  await inWorkspace(async () => {
    await captureStdout(() =>
      runProtocolCommand({
        runtime,
        subcommand: 'deliver',
        args: [
          '--mission-id',
          'coo:1',
          '--session-key',
          'sess_x',
          '--summary',
          'Delivered.',
          '--mission-summary-file',
          '-'
        ],
        stdin: summaryJson
      })
    );
  });
  assert.equal(posted!.path, '/api/protocol/deliver');
  assert.equal(posted!.body.flags['--mission-summary-file'], '-');
  assert.equal(posted!.body.fileInputs['--mission-summary-file'], summaryJson);
});

test('a mission_summary_conflict prints the fresh baseline on stdout and fails', async () => {
  const baseline = {
    contentRevision: 3,
    headline: 'Another objective landed.',
    summary: 'Tested.',
    author: 'agent',
    openItems: [{ id: 'item-2', kind: 'risk', objective: 'coo:1.abcd', text: 'Slow.' }],
    truncated: false
  };
  const payload = {
    error: 'The mission summary changed since you attached.',
    code: 'mission_summary_conflict',
    details: { baseContentRevision: 2, missionSummary: baseline }
  };
  const runtime = runtimeWithPost(async () => {
    throw new CliError({ message: `${payload.error} — (${payload.code})`, payload });
  });

  let stdout = '';
  await inWorkspace(async () => {
    stdout = await captureStdout(async () => {
      await assert.rejects(
        () =>
          runProtocolCommand({
            runtime,
            subcommand: 'deliver',
            args: [
              '--mission-id',
              'coo:1',
              '--session-key',
              'sess_x',
              '--summary',
              'Delivered.',
              '--mission-summary-file',
              '-'
            ],
            stdin: summaryJson
          }),
        (error: unknown) =>
          error instanceof CliError && /mission_summary_conflict/.test(error.message)
      );
    });
  });
  const printed = JSON.parse(stdout.slice(stdout.indexOf('{')));
  assert.equal(printed.code, 'mission_summary_conflict');
  assert.equal(printed.baseContentRevision, 2);
  assert.deepEqual(printed.missionSummary, baseline);
});

test('other errors print no conflict output', () => {
  assert.equal(
    missionSummaryConflictOutput(new CliError({ message: 'x', payload: { code: 'other' } })),
    null
  );
  assert.equal(missionSummaryConflictOutput(new Error('x')), null);
});

test('close-items accepts closures streamed on stdin and forwards them', async () => {
  const input = JSON.stringify([{ id: 'item', status: 'done', reason: 'Verified.' }]);
  const flags = new Map<string, string | true>([['--close-items-file', '-']]);
  assert.equal(
    (await resolveProtocolFileInputs({ flags, stdin: input })).fileInputs['--close-items-file'],
    input
  );
  let posted: any;
  const runtime = runtimeWithPost(async ({ path, body }) => {
    posted = { path, body };
    return {} as never;
  });
  await inWorkspace(async () => {
    await captureStdout(() =>
      runProtocolCommand({
        runtime,
        subcommand: 'close-items',
        args: ['--objective-id', 'coo:1.abcd', '--session-key', 'key', '--close-items-file', '-'],
        stdin: input
      })
    );
  });
  assert.equal(posted.path, '/api/protocol/close-items');
  assert.equal(posted.body.fileInputs['--close-items-file'], input);
});
