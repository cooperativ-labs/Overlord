import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runProtocolCommand } from '../src/commands.ts';
import { CliError } from '../src/errors.ts';
import {
  attemptRequestDigest,
  attemptsDirectory,
  markAttemptAccepted,
  prepareOperationAttempt,
  readAttempt,
  settleFailedAttempt
} from '../src/operation-attempts.ts';
import type { CliRuntime } from '../src/runtime.ts';

/**
 * Client retry identity (coo:1297.hk2v R4, ADR 0075): the attempt record is
 * saved before sending, survives a restart, refuses a changed retry body and
 * distinguishes a retry from intentionally separate identical record-work.
 */

function freshHome(label: string): string {
  const home = mkdtempSync(path.join(os.tmpdir(), `ovld-attempts-${label}-`));
  process.env.OVLD_HOME = home;
  return home;
}

function recordWorkFlags(summary = 'Fixed the parser.'): Record<string, string | true> {
  return { '--project-id': 'proj', '--objective': 'Fix the parser.', '--summary': summary };
}

test('an attempt is saved owner-only before sending and reused after a restart', () => {
  freshHome('restart');
  const flags = recordWorkFlags();
  const first = prepareOperationAttempt({
    kind: 'record_work',
    flags,
    fileInputs: {},
    positional: [],
    backendUrl: 'http://example.test'
  });
  assert.ok(first.operationId);
  assert.equal(first.persisted, true);
  assert.equal(flags['--operation-id'], first.operationId);
  const record = readAttempt(first.operationId!);
  assert.equal(record?.status, 'pending');
  assert.equal(statSync(attemptsDirectory()).mode & 0o777, 0o700);
  const [file] = readdirSync(attemptsDirectory());
  assert.equal(statSync(path.join(attemptsDirectory(), file!)).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(record).includes('Fixed the parser'), false, 'no raw body');

  // A new process with the same request (lost response) reuses the same id.
  const again = prepareOperationAttempt({
    kind: 'record_work',
    flags: recordWorkFlags(),
    fileInputs: {},
    positional: [],
    backendUrl: 'http://example.test'
  });
  assert.equal(again.operationId, first.operationId);
});

test('accepted identical record-work needs an explicit retry or new operation', () => {
  freshHome('accepted');
  const first = prepareOperationAttempt({
    kind: 'record_work',
    flags: recordWorkFlags(),
    fileInputs: {},
    positional: [],
    backendUrl: 'http://example.test'
  });
  markAttemptAccepted(first, { deliveryId: 'd1', mission: { displayId: 'coo:1' } });
  assert.equal(readAttempt(first.operationId!)?.status, 'accepted');

  assert.throws(
    () =>
      prepareOperationAttempt({
        kind: 'record_work',
        flags: recordWorkFlags(),
        fileInputs: {},
        positional: [],
        backendUrl: 'http://example.test'
      }),
    /already accepted.*--retry-operation.*--new-operation/s
  );

  const retry = prepareOperationAttempt({
    kind: 'record_work',
    flags: { ...recordWorkFlags(), '--retry-operation': first.operationId! },
    fileInputs: {},
    positional: [],
    backendUrl: 'http://example.test'
  });
  assert.equal(retry.operationId, first.operationId);

  const separate = prepareOperationAttempt({
    kind: 'record_work',
    flags: { ...recordWorkFlags(), '--new-operation': true },
    fileInputs: {},
    positional: [],
    backendUrl: 'http://example.test'
  });
  assert.notEqual(separate.operationId, first.operationId);

  assert.throws(
    () =>
      prepareOperationAttempt({
        kind: 'record_work',
        flags: { ...recordWorkFlags('Something else.'), '--retry-operation': first.operationId! },
        fileInputs: {},
        positional: [],
        backendUrl: 'http://example.test'
      }),
    /different request/
  );
});

test('the request digest excludes the session key and retry controls', () => {
  const base = { '--summary': 'Done.', '--mission-id': 'coo:1' };
  const digest = (flags: Record<string, string | true>) =>
    attemptRequestDigest({ kind: 'deliver', flags, fileInputs: {}, positional: [] });
  assert.equal(
    digest({ ...base, '--session-key': 'sess_a' }),
    digest({ ...base, '--session-key': 'sess_b', '--operation-id': 'x-op-00001' })
  );
  assert.notEqual(digest(base), digest({ ...base, '--summary': 'Other.' }));
});

test('an unavailable attempt store requires an explicit id for record-work only', () => {
  const home = freshHome('unavailable');
  // Make the attempt directory path a file so the store cannot be created.
  writeFileSync(path.join(home, 'operation-attempts'), 'not a directory');
  assert.throws(
    () =>
      prepareOperationAttempt({
        kind: 'record_work',
        flags: recordWorkFlags(),
        fileInputs: {},
        positional: [],
        backendUrl: 'http://example.test'
      }),
    /--operation-id/
  );
  const explicit = prepareOperationAttempt({
    kind: 'record_work',
    flags: { ...recordWorkFlags(), '--operation-id': 'caller-op-0001' },
    fileInputs: {},
    positional: [],
    backendUrl: 'http://example.test'
  });
  assert.equal(explicit.operationId, 'caller-op-0001');
  assert.equal(explicit.persisted, false);
  const deliver = prepareOperationAttempt({
    kind: 'deliver',
    flags: { '--summary': 'Done.', '--session-key': 'sess_x' },
    fileInputs: {},
    positional: [],
    backendUrl: 'http://example.test'
  });
  assert.equal(deliver.operationId, null);
});

test('a definite 4xx drops the pending attempt; an unknown outcome keeps it', () => {
  freshHome('settle');
  const rejected = prepareOperationAttempt({
    kind: 'record_work',
    flags: recordWorkFlags('Rejected.'),
    fileInputs: {},
    positional: [],
    backendUrl: 'http://example.test'
  });
  settleFailedAttempt(rejected, new CliError({ message: 'bad', status: 400, payload: {} }));
  assert.equal(readAttempt(rejected.operationId!), null);

  const unknown = prepareOperationAttempt({
    kind: 'record_work',
    flags: recordWorkFlags('Unknown.'),
    fileInputs: {},
    positional: [],
    backendUrl: 'http://example.test'
  });
  settleFailedAttempt(unknown, new CliError({ message: 'Could not reach Overlord backend' }));
  assert.equal(readAttempt(unknown.operationId!)?.status, 'pending');
});

test('ovld protocol record-work retries a lost response with the same operation id', async () => {
  freshHome('e2e');
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'ovld-attempts-e2e-workspace-'));
  const sent: Array<Record<string, unknown>> = [];
  let failNext = true;
  const runtime = {
    backend: {
      baseUrl: 'http://example.test',
      health: async () => ({ ok: true }),
      get: async () => {
        throw new Error('unexpected GET');
      },
      post: async ({ body }: { path: string; body?: unknown }) => {
        const flags = (body as { flags: Record<string, unknown> }).flags;
        sent.push(flags);
        if (failNext) {
          failNext = false;
          // The server committed, but the response never arrived.
          throw new CliError({
            message: 'Could not reach Overlord backend at http://example.test.'
          });
        }
        return {
          mission: { id: 'm1', displayId: 'coo:9' },
          deliveryId: 'd1',
          operationId: flags['--operation-id']
        };
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

  const args = ['--project-id', 'proj', '--objective', 'Fix it.', '--summary', 'Fixed it.'];
  const originalCwd = process.cwd();
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.chdir(workspace);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    await assert.rejects(runProtocolCommand({ runtime, subcommand: 'record-work', args }));
    await runProtocolCommand({ runtime, subcommand: 'record-work', args });
    await assert.rejects(
      runProtocolCommand({ runtime, subcommand: 'record-work', args }),
      /already accepted/
    );
    await runProtocolCommand({
      runtime,
      subcommand: 'record-work',
      args: [...args, '--new-operation']
    });
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }
  assert.equal(sent.length, 3);
  assert.ok(typeof sent[0]!['--operation-id'] === 'string');
  assert.equal(sent[1]!['--operation-id'], sent[0]!['--operation-id'], 'retry keeps the id');
  assert.notEqual(sent[2]!['--operation-id'], sent[0]!['--operation-id'], 'new work, new id');
  for (const flags of sent) {
    assert.equal('--new-operation' in flags, false, 'CLI-only controls are not sent');
    assert.equal('--retry-operation' in flags, false);
  }
});

test('publish-delivery-summary uses the same attempt boundary, scoped to one delivery', () => {
  freshHome('publish');
  const flags = (deliveryId: string): Record<string, string | true> => ({
    '--mission-id': 'coo:1',
    '--delivery-id': deliveryId,
    '--session-key': 'ovld_session_secret',
    '--payload-json': JSON.stringify({
      baseContentRevision: 3,
      baseEvidenceRevision: 9,
      headline: 'Done.',
      summary: 'Tested.'
    })
  });
  const prepare = (deliveryId: string) =>
    prepareOperationAttempt({
      kind: 'publish_summary',
      flags: flags(deliveryId),
      fileInputs: {},
      positional: [],
      backendUrl: 'http://example.test'
    });
  const first = prepare('delivery-a');
  assert.match(first.operationId ?? '', /^ovld-pub-/);
  assert.equal(first.persisted, true);
  // A lost response retried with the same request reuses the id, even after acceptance.
  assert.equal(prepare('delivery-a').operationId, first.operationId);
  markAttemptAccepted(first, { publication: { id: 'p' } });
  assert.equal(prepare('delivery-a').operationId, first.operationId);
  // The same text for another delivery is a different publication.
  assert.notEqual(prepare('delivery-b').operationId, first.operationId);
  // A definitive "already published" keeps the record, like an operation conflict.
  const other = prepare('delivery-c');
  settleFailedAttempt(
    other,
    new CliError({
      message: 'published',
      status: 409,
      payload: { code: 'mission_summary_already_published' }
    })
  );
  assert.equal(readAttempt(other.operationId!)?.status, 'pending');
});
