import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runProtocolCommand } from '../src/commands.ts';
import { CliError } from '../src/errors.ts';
import type { CliRuntime } from '../src/runtime.ts';

test('attach rejected for an already-linked execution request is not treated as auth failure', async () => {
  process.env.OVLD_HOME = mkdtempSync(path.join(os.tmpdir(), 'ovld-attach-already-linked-home-'));
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'ovld-attach-already-linked-workspace-'));

  const runtime = {
    backend: {
      baseUrl: 'http://example.test',
      health: async () => ({ ok: true }),
      get: async () => {
        throw new Error('unexpected GET');
      },
      post: async () => {
        throw new CliError({
          message:
            'Execution request is already linked to another session (execution_request_already_linked). Run ovld protocol resume-follow-up --mission-id coo:830 --objective-id coo:830.abcd.'
        });
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
  } satisfies CliRuntime;

  const originalCwd = process.cwd();
  process.chdir(workspace);
  try {
    await assert.rejects(
      () =>
        runProtocolCommand({
          runtime,
          subcommand: 'attach',
          args: [
            '--mission-id',
            'coo:830',
            '--execution-request-id',
            'req_already_linked',
            '--execution-target-id',
            'target_1'
          ]
        }),
      (error: unknown) => {
        assert.ok(error instanceof CliError);
        assert.match(
          error.message,
          /resume-follow-up --mission-id coo:830 --objective-id coo:830.abcd/
        );
        assert.doesNotMatch(error.message, /auth login|credentials were rejected/i);
        return true;
      }
    );
  } finally {
    process.chdir(originalCwd);
  }
});
