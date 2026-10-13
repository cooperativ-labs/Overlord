import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ProtocolRequestBody } from '../../backend/protocol/flags.ts';
import { readActiveMissionPointer } from '../src/active-mission.ts';
import { readActiveSessions } from '../src/active-objective-sessions.ts';
import { runProtocolCommand } from '../src/commands.ts';
import type { CliRuntime } from '../src/runtime.ts';
import { readCachedSessionKey } from '../src/session-key.ts';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-objective-addressing-'));
const { bootstrapIntegrationTestDb } = await import('../../backend/test-helpers.ts');
const bootstrap = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'webapp.sqlite')
});

const { createMission, createProject } = await import('../../backend/repository.ts');
const { runProtocolSubcommand } = await import('../../backend/protocol.ts');
const { setActiveTokenAuth } = await import('../../backend/db.ts');

type ObjectiveRow = { id: string; displayId: string };

async function missionFixture(label: string): Promise<{
  missionId: string;
  missionDisplayId: string;
  objective: ObjectiveRow;
}> {
  const project = await createProject({ name: `${label} ${Date.now()}` });
  const mission = (await createMission({
    projectId: project.id,
    firstObjective: label
  })) as unknown as { id: string; displayId: string; objectives: ObjectiveRow[] };
  return {
    missionId: mission.id,
    missionDisplayId: mission.displayId,
    objective: mission.objectives[0]!
  };
}

test('CLI cross-mission reads preserve bindings and state; subsequent update and delivery reach the origin', async () => {
  const origin = await missionFixture('Read origin');
  const target = await missionFixture('Read target');
  const originalCwd = process.cwd();
  const envKeys = [
    'OVLD_HOME',
    'OVERLORD_OBJECTIVE_ID',
    'MISSION_ID',
    'OVERLORD_MISSION_ID',
    'OVERLORD_EXECUTION_REQUEST_ID',
    'OVERLORD_SESSION_CHANNEL_ID',
    'OVERLORD_TMPDIR'
  ];
  const saved = envKeys.map(key => [key, process.env[key]] as const);
  const checkout = mkdtempSync(path.join(tempDir, 'read-checkout-'));
  const requests: Array<{ command: string; body: ProtocolRequestBody }> = [];
  const responses: unknown[] = [];
  const runtime = {
    backend: {
      baseUrl: 'http://127.0.0.1:4310',
      health: async () => ({ ok: true }),
      get: async <T>() => ({}) as T,
      getBytes: async () => Buffer.alloc(0),
      postRaw: async <T>() => ({}) as T,
      post: async <T>({ path: requestPath, body }: { path: string; body?: unknown }) => {
        const command = requestPath.split('/').at(-1)!;
        requests.push({ command, body: body as ProtocolRequestBody });
        const result = await runProtocolSubcommand(command, body as ProtocolRequestBody);
        responses.push(result);
        return result as T;
      },
      patch: async <T>() => ({}) as T,
      delete: async <T>() => ({}) as T
    },
    close: () => {}
  } satisfies CliRuntime;
  const run = (subcommand: string, args: string[]) =>
    runProtocolCommand({ runtime, subcommand, args });
  const snapshot = () =>
    Object.fromEntries(
      ['missions', 'objectives', 'agent_sessions', 'mission_events', 'deliveries'].map(table => [
        table,
        bootstrap.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
      ])
    );
  try {
    for (const key of envKeys) delete process.env[key];
    process.env.OVLD_HOME = mkdtempSync(path.join(tempDir, 'read-home-'));
    process.env.OVERLORD_OBJECTIVE_ID = origin.objective.displayId;
    process.env.MISSION_ID = origin.missionDisplayId;
    process.chdir(checkout);
    await run('attach', ['--objective-id', origin.objective.displayId]);
    const binding = readActiveSessions(checkout);
    const pointer = readActiveMissionPointer(checkout);
    const cachedKey = readCachedSessionKey({
      workingDirectory: checkout,
      missionId: origin.missionDisplayId,
      objectiveId: origin.objective.displayId
    });
    assert.ok(cachedKey);
    const before = snapshot();

    setActiveTokenAuth({
      workspaceUserId: bootstrap.operatorWorkspaceUserId,
      tokenId: 'read-denied',
      scopeGrants: ['mission:update']
    });
    try {
      await assert.rejects(
        run('load-context', ['--mission-id', target.missionDisplayId]),
        /Permission denied: mission:read/
      );
    } finally {
      bootstrap.setActiveWorkspaceUser(bootstrap.operatorWorkspaceUserId);
    }

    for (const subcommand of [
      'load-context',
      'read-context',
      'attachment-list',
      'list-deliveries'
    ]) {
      await run(subcommand, ['--mission-id', target.missionDisplayId]);
      assert.equal(requests.at(-1)!.body.flags?.['--objective-id'], undefined);
    }
    const crossContext = responses.find(
      result =>
        (result as { mission?: { displayId: string } }).mission?.displayId ===
        target.missionDisplayId
    ) as { objective: { id: string } };
    assert.equal(crossContext.objective.id, target.objective.id);
    await run('load-context', ['--mission-id', target.missionId]);
    assert.equal(requests.at(-1)!.body.flags?.['--objective-id'], undefined);
    await run('load-context', [
      '--mission-id',
      target.missionId,
      '--objective-id',
      target.objective.id
    ]);
    await assert.rejects(
      run('load-context', [
        '--mission-id',
        target.missionId,
        '--objective-id',
        origin.objective.id
      ]),
      /does not belong to the given mission/
    );
    // A missing attachment should reach attachment lookup, not fail selector validation.
    await assert.rejects(
      run('attachment-download-url', [
        '--mission-id',
        target.missionDisplayId,
        '--attachment-id',
        'missing'
      ]),
      /Attachment not found/
    );

    await run('load-context', ['--mission-id', origin.missionDisplayId]);
    assert.equal(requests.at(-1)!.body.flags?.['--objective-id'], origin.objective.displayId);
    await run('load-context', [
      '--mission-id',
      target.missionDisplayId,
      '--objective-id',
      target.objective.displayId
    ]);
    for (const subcommand of [
      'load-context',
      'read-context',
      'attachment-list',
      'attachment-download-url',
      'list-deliveries'
    ]) {
      await assert.rejects(
        run(subcommand, [
          '--mission-id',
          target.missionDisplayId,
          '--objective-id',
          origin.objective.displayId
        ]),
        /does not belong to the given mission/
      );
    }
    await run('load-context', ['--objective-id', target.objective.displayId]);
    delete process.env.OVERLORD_OBJECTIVE_ID;
    delete process.env.MISSION_ID;
    await run('load-context', ['--mission-id', target.missionDisplayId]);
    await assert.rejects(run('load-context', []), /Missing required flag: --mission-id/);

    assert.deepEqual(snapshot(), before);
    assert.deepEqual(readActiveSessions(checkout), binding);
    assert.deepEqual(readActiveMissionPointer(checkout), pointer);
    assert.equal(
      readCachedSessionKey({
        workingDirectory: checkout,
        missionId: origin.missionDisplayId,
        objectiveId: origin.objective.displayId
      }),
      cachedKey
    );
    assert.equal(
      readCachedSessionKey({
        workingDirectory: checkout,
        missionId: target.missionDisplayId,
        objectiveId: target.objective.displayId
      }),
      undefined
    );

    process.env.OVERLORD_OBJECTIVE_ID = origin.objective.displayId;
    await run('update', ['--summary', 'Origin progress after cross-mission read']);
    await run('deliver', ['--summary', 'Origin delivery after cross-mission read']);
    for (const command of ['update', 'deliver']) {
      const request = requests.findLast(entry => entry.command === command)!;
      assert.equal(request.body.flags?.['--mission-id'], origin.missionDisplayId);
      assert.equal(request.body.flags?.['--objective-id'], origin.objective.displayId);
      assert.equal(request.body.flags?.['--session-key'], cachedKey);
    }
    assert.deepEqual(
      bootstrap.db.prepare('SELECT state FROM objectives WHERE id = ?').get(origin.objective.id),
      { state: 'complete' }
    );
    assert.deepEqual(
      bootstrap.db.prepare('SELECT state FROM objectives WHERE id = ?').get(target.objective.id),
      { state: 'draft' }
    );
    const delivery = bootstrap.db
      .prepare('SELECT objective_id FROM deliveries ORDER BY created_at DESC LIMIT 1')
      .get();
    assert.deepEqual(delivery, { objective_id: origin.objective.id });
    const event = bootstrap.db
      .prepare('SELECT objective_id FROM mission_events WHERE summary = ?')
      .get('Origin progress after cross-mission read');
    assert.deepEqual(event, { objective_id: origin.objective.id });
  } finally {
    process.chdir(originalCwd);
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
