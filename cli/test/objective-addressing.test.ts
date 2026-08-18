import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runProtocolCommand } from '../src/commands.ts';
import type { CliRuntime } from '../src/runtime.ts';

type PostedBody = { flags: Record<string, string | boolean> };

/**
 * Capture the protocol body the CLI would send, without a backend. The flags it
 * emits are the contract: an agent holding only an objective display id must
 * produce the same `--mission-id` a human would have typed.
 */
function capturingRuntime(): { runtime: CliRuntime; posted: PostedBody[] } {
  const posted: PostedBody[] = [];
  const runtime = {
    backend: {
      baseUrl: 'http://127.0.0.1:4310',
      health: async () => ({ ok: true }),
      get: async () => ({}),
      post: async ({ body }: { path: string; body?: unknown }) => {
        posted.push(body as PostedBody);
        return {};
      },
      patch: async () => ({}),
      delete: async () => ({})
    },
    close: () => {}
  } satisfies CliRuntime;
  return { runtime, posted };
}

async function withIsolatedEnv(run: () => Promise<void>): Promise<void> {
  const saved = {
    home: process.env.OVLD_HOME,
    objective: process.env.OVERLORD_OBJECTIVE_ID,
    mission: process.env.MISSION_ID,
    overlordMission: process.env.OVERLORD_MISSION_ID,
    executionRequest: process.env.OVERLORD_EXECUTION_REQUEST_ID
  };
  process.env.OVLD_HOME = mkdtempSync(path.join(tmpdir(), 'ovld-objective-addressing-'));
  delete process.env.OVERLORD_OBJECTIVE_ID;
  delete process.env.MISSION_ID;
  delete process.env.OVERLORD_MISSION_ID;
  delete process.env.OVERLORD_EXECUTION_REQUEST_ID;
  try {
    await run();
  } finally {
    for (const [key, value] of [
      ['OVLD_HOME', saved.home],
      ['OVERLORD_OBJECTIVE_ID', saved.objective],
      ['MISSION_ID', saved.mission],
      ['OVERLORD_MISSION_ID', saved.overlordMission],
      ['OVERLORD_EXECUTION_REQUEST_ID', saved.executionRequest]
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('--objective-id alone supplies --mission-id to the protocol body', async () => {
  await withIsolatedEnv(async () => {
    const { runtime, posted } = capturingRuntime();

    await runProtocolCommand({
      runtime,
      subcommand: 'load-context',
      args: ['--objective-id', 'coo:756.k7xm']
    });

    assert.equal(posted.length, 1);
    assert.equal(posted[0]!.flags['--mission-id'], 'coo:756');
    assert.equal(posted[0]!.flags['--objective-id'], 'coo:756.k7xm');
  });
});

test('an explicit --mission-id is never overwritten by the derived one', async () => {
  await withIsolatedEnv(async () => {
    const { runtime, posted } = capturingRuntime();

    await runProtocolCommand({
      runtime,
      subcommand: 'load-context',
      args: ['--mission-id', 'coo:756', '--objective-id', 'coo:756.k7xm']
    });

    assert.equal(posted[0]!.flags['--mission-id'], 'coo:756');
  });
});

test('an objective UUID does not synthesize a mission id', async () => {
  await withIsolatedEnv(async () => {
    const { runtime, posted } = capturingRuntime();

    await runProtocolCommand({
      runtime,
      subcommand: 'load-context',
      args: ['--objective-id', '550e8400-e29b-41d4-a716-446655440000']
    });

    // A UUID names no parent mission, so the CLI forwards the call untouched and
    // lets the backend produce the "pass --mission-id" error.
    assert.equal(posted[0]!.flags['--mission-id'], undefined);
    assert.equal(posted[0]!.flags['--objective-id'], '550e8400-e29b-41d4-a716-446655440000');
  });
});

test('OVERLORD_OBJECTIVE_ID fills --objective-id beyond attach', async () => {
  await withIsolatedEnv(async () => {
    process.env.OVERLORD_OBJECTIVE_ID = 'coo:756.k7xm';
    const { runtime, posted } = capturingRuntime();

    for (const subcommand of ['update', 'deliver', 'load-context', 'connect', 'add-artifact']) {
      await runProtocolCommand({
        runtime,
        subcommand,
        args: ['--session-key', 'sess_test', '--summary', 'x', '--type', 'note', '--label', 'x']
      });
    }

    for (const [index, body] of posted.entries()) {
      assert.equal(body.flags['--objective-id'], 'coo:756.k7xm', `body ${index}`);
      assert.equal(body.flags['--mission-id'], 'coo:756', `body ${index}`);
    }
  });
});

test('discuss-objective and update-objective never inherit the env objective', async () => {
  await withIsolatedEnv(async () => {
    process.env.OVERLORD_OBJECTIVE_ID = 'coo:756.k7xm';
    const { runtime, posted } = capturingRuntime();

    // discuss-objective wants a *draft*; the env points at the executing
    // objective, so inheriting it would submit the wrong row (or fail).
    await runProtocolCommand({
      runtime,
      subcommand: 'discuss-objective',
      args: ['--mission-id', 'coo:756']
    });
    // update-objective's id names the row being mutated, so guessing it would
    // silently edit an objective the caller never named.
    await runProtocolCommand({
      runtime,
      subcommand: 'update-objective',
      args: ['--auto-advance']
    });

    assert.equal(posted[0]!.flags['--objective-id'], undefined);
    assert.equal(posted[1]!.flags['--objective-id'], undefined);
  });
});

test('ovld protocol changes accepts an objective display id in place of the mission', async () => {
  await withIsolatedEnv(async () => {
    const { runtime } = capturingRuntime();
    // `changes` is local-only, so reaching it at all proves the mission was
    // derived — it throws a usage error when no mission resolves.
    await assert.doesNotReject(() =>
      runProtocolCommand({
        runtime,
        subcommand: 'changes',
        args: ['--objective-id', 'coo:756.k7xm']
      })
    );

    await assert.rejects(
      () => runProtocolCommand({ runtime, subcommand: 'changes', args: [] }),
      /--mission-id/
    );
  });
});
