import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBackendClient } from '../cli/src/backend-client.ts';
import { runProtocolCommand } from '../cli/src/commands.ts';
import { buildLaunchPlan } from '../cli/src/launch.ts';
import { ServiceError } from '../packages/core/service/errors.ts';
import {
  claimNextExecutionRequest,
  createExecutionRequest,
  markExecutionLaunched,
  markExecutionLaunching
} from '../packages/core/service/execution-requests.ts';
import { addProjectResource, createProject } from '../packages/core/service/projects.ts';

import { bootstrapIntegrationTestDb } from './test-helpers.ts';

test('a runner-launched harness delivers, explicitly resumes and delivers again', async t => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'ovld-runner-follow-up-'));
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  t.after(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    rmSync(workspace, { recursive: true, force: true });
  });

  process.env.OVLD_HOME = path.join(workspace, 'home');
  process.env.OVERLORD_BACKEND_URL_DEV = 'http://example.test';
  process.env.OVERLORD_USER_TOKEN = 'fixture-user-token';
  delete process.env.OVERLORD_SESSION_CHANNEL_ID;

  const { db } = await bootstrapIntegrationTestDb({
    sqlitePath: path.join(workspace, 'fixture.sqlite')
  });
  const { buildWebappServiceContext } = await import('./db.ts');
  const { runProtocolSubcommand } = await import('./protocol.ts');
  const { getMissionDetail } = await import('./repository.ts');
  const ctx = buildWebappServiceContext();
  const project = await createProject({ ctx, name: 'Continuing Claude Code harness' });
  await addProjectResource({
    ctx,
    projectId: project.id,
    directoryPath: workspace,
    isPrimary: true
  });
  const created = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': project.id,
      '--objective-instructions': 'Review launch behavior, record the result, and deliver.',
      '--objective-summary': 'Review launch behavior.'
    }
  })) as {
    mission: { id: string; displayId: string };
    objectives: Array<{ id: string; displayId: string }>;
  };
  const { mission } = created;
  const objective = created.objectives[0]!;
  const request = await createExecutionRequest({
    ctx,
    missionId: mission.id,
    objectiveId: objective.id,
    requestedAgent: 'claude',
    requestedSource: 'test'
  });
  assert.equal((await claimNextExecutionRequest({ ctx }))?.id, request.id);
  await markExecutionLaunching({ ctx, requestId: request.id });
  await markExecutionLaunched({ ctx, requestId: request.id });

  // Exercise the production CLI error reader and backend protocol dispatcher with
  // the fixture operator, without starting a separate network listener.
  t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-user-token');
    const pathname = new URL(input).pathname;
    const protocolPrefix = '/api/protocol/';
    try {
      if (pathname.startsWith(protocolPrefix)) {
        const command = pathname.slice(protocolPrefix.length);
        return Response.json(await runProtocolSubcommand(command, JSON.parse(String(init?.body))));
      }
      if (pathname === `/api/missions/${encodeURIComponent(mission.displayId)}`) {
        return Response.json(await getMissionDetail(mission.displayId));
      }
      return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
  });
  const backend = createBackendClient();
  const runtime = { backend, close: () => {} };
  const plan = await buildLaunchPlan({
    runtime,
    options: {
      agent: 'claude',
      missionId: mission.displayId,
      objectiveId: objective.id,
      workingDirectory: workspace,
      executionRequestId: request.id,
      terminalLauncher: 'Terminal'
    }
  });

  process.chdir(workspace);
  Object.assign(process.env, plan.env);
  const target = ['--mission-id', mission.displayId, '--objective-id', objective.displayId];
  const nativeSession = ['--external-session-id', 'continuing-claude-fixture'];
  const run = async (subcommand: string, args: string[]) => {
    const output = t.mock.method(process.stdout, 'write', () => true);
    const diagnostics = t.mock.method(process.stderr, 'write', () => true);
    try {
      await runProtocolCommand({ runtime, subcommand, args: [...target, ...args] });
      return JSON.parse(String(output.mock.calls.at(-1)?.arguments[0]));
    } finally {
      output.mock.restore();
      diagnostics.mock.restore();
    }
  };
  const writeScratch = () =>
    execFileSync(
      '/bin/sh',
      ['-ec', 'file=$(mktemp "$TMPDIR/follow-up.XXXXXX"); printf verified > "$file"; cat "$file"'],
      {
        encoding: 'utf8'
      }
    );
  const resumeCommand = `ovld protocol resume-follow-up --mission-id ${mission.displayId} --objective-id ${objective.displayId}`;
  const attached = await run('attach', ['--agent', 'claude', ...nativeSession]);
  assert.equal(attached.objective.id, objective.id);
  assert.equal(writeScratch(), 'verified');

  const originalDelivery = await run('deliver', ['--summary', 'Initial delivery']);
  assert.ok(originalDelivery.instruction.includes(resumeCommand));
  assert.equal(writeScratch(), 'verified');

  await assert.rejects(
    run('update', [
      '--begin-follow-up-work',
      '--session-key',
      attached.sessionKey,
      '--summary',
      'Follow up'
    ]),
    (error: Error) => {
      assert.match(error.message, /invalid_session/);
      assert.ok(error.message.includes(resumeCommand));
      assert.doesNotMatch(error.message, /auth login|credentials were rejected/i);
      return true;
    }
  );

  for (const inheritedRequest of [true, false]) {
    if (!inheritedRequest) delete process.env.OVERLORD_EXECUTION_REQUEST_ID;
    await assert.rejects(run('attach', []), (error: Error) => {
      assert.match(error.message, /execution_request_already_linked/);
      assert.ok(error.message.includes(resumeCommand));
      assert.doesNotMatch(error.message, /auth login|credentials were rejected/i);
      return true;
    });
  }

  const mcpRecovery = (error: unknown) =>
    error instanceof ServiceError &&
    error.message.includes('ask them to start follow-up work from Overlord') &&
    !error.message.includes('ovld protocol');
  await assert.rejects(
    runProtocolSubcommand('attach', {
      flags: { '--objective-id': objective.displayId, '--connection-method': 'mcp' }
    }),
    error => mcpRecovery(error) && (error as ServiceError).code === 'no_active_objective'
  );
  assert.equal((await getMissionDetail(mission.displayId)).objectives[0]?.state, 'complete');

  // Simulate a pre-fix delivery that removed the inherited directory.
  rmSync(plan.env.TMPDIR!, { recursive: true });
  const resumed = await run('resume-follow-up', ['--summary', 'Begin follow-up']);
  assert.notEqual(resumed.sessionKey, attached.sessionKey);
  assert.equal(resumed.objective.id, objective.id);
  assert.equal(resumed.objective.state, 'pending_delivery');
  assert.equal(writeScratch(), 'verified');

  // Deliberately omit session flags to exercise the cache written by resume.
  const progress = await run('update', ['--summary', 'Follow-up progress']);
  const followUp = await run('deliver', ['--summary', 'Follow-up delivery']);
  assert.notEqual(followUp.deliveryId, originalDelivery.deliveryId);
  assert.equal(writeScratch(), 'verified');
  assert.equal((await getMissionDetail(mission.displayId)).objectives[0]?.state, 'complete');
  assert.deepEqual(
    db.prepare('SELECT launched_session_id FROM execution_requests WHERE id = ?').get(request.id),
    { launched_session_id: attached.session.id }
  );
  assert.deepEqual(
    db.prepare('SELECT session_id FROM mission_events WHERE id = ?').get(progress.eventId),
    { session_id: resumed.session.id }
  );
});
