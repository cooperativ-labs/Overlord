import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { listenForTest, routerTestApp } from './http/test-app-fixture.ts';

const { createIntegrationTestDb } = await import('./test-helpers.ts');
const harness = await createIntegrationTestDb('ovld-end-terminal-');
const dbModule = await import('./db.ts');
const client = dbModule.requireDatabaseClient();
const { createProject, createProjectResource, createMission, createObjective, getMissionDetail } =
  await import('./repository.ts');
const { launchObjective } = await import('./execution/launch.ts');
const { TerminalSessionObserver } = await import('./terminal-session-observer.ts');
const { recordTerminalObservation } =
  await import('../packages/core/service/terminal-session-lifecycle.ts');
const { readMissionTerminalHistory, forgetMissionLatchSession } =
  await import('./execution/latch-sessions.ts');
const { endMissionLatchSession } = await import('./execution/end-latch-session.ts');
const { createIsolatedCheckout } = await import('../packages/core/service/test-checkout.ts');
const { ensureCallerDeviceTarget } = await import('../packages/core/service/execution-targets.ts');
const { recordRunnerHeartbeat } =
  await import('../packages/core/service/execution-target-runners.ts');
const { parseLocalTargetMutation, completeLocalTargetMutationRequest } =
  await import('../packages/core/service/local-target-mutations.ts');
const { executeLocalTargetMutation } =
  await import('../packages/core/service/local-target-mutation-runner.ts');
const { FakeLocalTargetProvider } =
  await import('../packages/core/service/local-target/fake-provider.ts');
const { getProjectRunQueues, postRunQueueEntry } = await import('./run-queue.ts');
const { inspectLatchSession, stopLatchSession } =
  await import('../packages/core/service/latch-session.ts');
const { resolveLatchBinaryPath } = await import('../packages/core/service/latch-binary.ts');

const server = await listenForTest(
  routerTestApp((app, handle) => {
    app.get(
      '/api/missions/:id/terminal-sessions/history',
      handle(req => readMissionTerminalHistory(req.params.id, req.query))
    );
    app.post(
      '/api/missions/:id/terminal-sessions/end',
      handle(req => endMissionLatchSession(req.params.id, req.body), { mutates: true })
    );
  })
);
after(async () => {
  await server.close();
  harness.db.close();
  rmSync(harness.tempDir, { recursive: true, force: true });
});

async function fixture() {
  const ctx = await dbModule.buildWebappServiceContextForWorkspace(
    'local-workspace',
    client,
    harness.operatorWorkspaceUserId
  );
  const target = await ensureCallerDeviceTarget({ ctx });
  await recordRunnerHeartbeat({
    ctx,
    executionTargetId: target.executionTargetId,
    runnerInstanceId: 'end-test-runner',
    relation: 'native'
  });
  const project = await createProject({ name: `End session ${crypto.randomUUID()}` });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('end-terminal-'),
    executionTargetId: target.executionTargetId,
    isPrimary: true
  });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Stop this attempt'
  });
  const objectiveId = mission.objectives[0]!.id;
  await postRunQueueEntry(project.id, { objectiveId });
  const sibling = await createObjective({
    missionId: mission.id,
    instructionText: 'Wait for explicit restart'
  });
  await postRunQueueEntry(project.id, { objectiveId: sibling.id });
  const request = await launchObjective(objectiveId, { agent: 'codex' });
  const mapping = {
    provider: 'latch',
    providerSessionId: `ses_${request.id}`,
    sessionName: 'test-terminal',
    executionTargetId: target.executionTargetId,
    agentSessionId: null,
    createdAt: new Date().toISOString(),
    lastObservedState: 'running'
  };
  await client.run(
    `UPDATE execution_requests SET status = 'launched', metadata_json = ? WHERE id = ?`,
    [JSON.stringify({ providerSession: mapping }), request.id]
  );
  await client.run(`UPDATE objectives SET state = 'executing' WHERE id = ?`, [objectiveId]);
  return { ctx, target, project, mission, objectiveId, request, mapping };
}

async function post(missionId: string, executionRequestId: string) {
  const result = await fetch(`${server.baseUrl}/api/missions/${missionId}/terminal-sessions/end`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ executionRequestId })
  });
  const body = await result.json();
  assert.equal(result.status, 200, JSON.stringify(body));
  return body as { state: string; reason: string | null; lastObservedState: string };
}

/** Exercise the actual queue, generic runner dispatch and completion persistence. */
async function withRunner<T>(
  f: Awaited<ReturnType<typeof fixture>>,
  action: () => Promise<T>,
  stopState: 'exited' | 'stopping' = 'exited',
  inspectState: 'running' | 'exited' | 'lost' | 'absent' = 'running',
  realLatch = false
) {
  let done = false;
  let stops = 0;
  const provider: InstanceType<typeof FakeLocalTargetProvider> = new FakeLocalTargetProvider({
    target: {
      executionTargetId: f.target.executionTargetId,
      transport: 'fake',
      deviceLabel: 'test runner'
    },
    handlers: {
      inspectLatchSession: async input =>
        inspectState === 'absent'
          ? {
              ok: false,
              code: 'LATCH_SESSION_ABSENT',
              message: `no session named ${input.providerSessionId}`,
              target: provider.target
            }
          : {
              ok: true,
              target: provider.target,
              value: realLatch
                ? await inspectLatchSession({
                    ...input,
                    executable: process.env.OVERLORD_LIVE_LATCH_EXECUTABLE ?? input.executable
                  }).catch(() => ({
                    providerSessionId: input.providerSessionId,
                    name: 'absent',
                    state: 'lost' as const,
                    exitCode: null,
                    inspectedAt: new Date().toISOString()
                  }))
                : {
                    providerSessionId: input.providerSessionId,
                    name: 'test',
                    state: inspectState,
                    exitCode: null,
                    inspectedAt: new Date().toISOString()
                  }
            },
      stopLatchSession: async input => {
        stops++;
        return {
          ok: true,
          target: provider.target,
          value: realLatch
            ? await stopLatchSession({
                ...input,
                executable: process.env.OVERLORD_LIVE_LATCH_EXECUTABLE ?? input.executable
              })
            : { providerSessionId: input.providerSessionId, state: stopState }
        };
      }
    }
  });
  const pending = action().finally(() => {
    done = true;
  });
  const deadline = Date.now() + 20_000;
  while (!done && Date.now() < deadline) {
    const row = await client.get<{ id: string; metadata_json: string }>(
      `SELECT id, metadata_json FROM execution_requests WHERE execution_target_id = ?
        AND requested_source = 'local_target_mutation' AND status = 'queued' LIMIT 1`,
      [f.target.executionTargetId]
    );
    if (row) {
      const mutation = parseLocalTargetMutation(row.metadata_json);
      assert.ok(mutation);
      await client.run(`UPDATE execution_requests SET status = 'claimed' WHERE id = ?`, [row.id]);
      const result = await executeLocalTargetMutation({ mutation, provider });
      await completeLocalTargetMutationRequest({ ctx: f.ctx, requestId: row.id, result });
    } else await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(done, 'HTTP request completed within runner test deadline');
  return { result: await pending, stops };
}

test('observer confirms spontaneous exit through the runner queue and emits a live update', async () => {
  const f = await fixture();
  // Logical delivery must not stop observation or imply terminal termination.
  await client.run("UPDATE objectives SET state = 'complete' WHERE id = ?", [f.objectiveId]);
  await withRunner(f, () => new TerminalSessionObserver().runOnce(), 'exited', 'exited');
  const session = (await getMissionDetail(f.mission.id)).terminalSessions[0]!;
  assert.equal(session.lastObservedState, 'exited');
  assert.equal(session.endReason, 'exited');
  assert.ok(session.endedAt);
  assert.equal((await getMissionDetail(f.mission.id)).objectives[0]!.state, 'complete');
  const events = await client.all<{ id: string }>(
    "SELECT id FROM mission_events WHERE mission_id = ? AND summary = 'Terminal session ended.'",
    [f.mission.id]
  );
  assert.equal(events.length, 1);
  await recordTerminalObservation({
    ctx: f.ctx,
    executionRequestId: f.request.id,
    providerSessionId: f.mapping.providerSessionId,
    state: 'lost'
  });
  assert.equal((await getMissionDetail(f.mission.id)).terminalSessions[0]!.endReason, 'exited');
});

test('observer recovers an automated launch with no requester on its claiming target', async () => {
  const f = await fixture();
  await client.run(
    `UPDATE execution_requests
        SET requested_source = 'run_queue', idempotency_key = id,
            requested_by_workspace_user_id = NULL, execution_target_id = ?
      WHERE id = ?`,
    [f.target.executionTargetId, f.request.id]
  );

  const observe = () => withRunner(f, () => new TerminalSessionObserver().runOnce());
  const readState = async () =>
    (await getMissionDetail(f.mission.id)).terminalSessions[0]?.lastObservedState;
  await observe();
  assert.equal(await readState(), 'lost', 'a requested target alone cannot authorize a probe');

  await client.run(
    'UPDATE execution_requests SET claimed_by_execution_target_id = ? WHERE id = ?',
    [f.target.executionTargetId, f.request.id]
  );
  await observe();
  assert.equal(await readState(), 'running');
  const event = await client.get<{ actor_workspace_user_id: string | null }>(
    "SELECT actor_workspace_user_id FROM mission_events WHERE mission_id = ? AND summary = 'Terminal session running.'",
    [f.mission.id]
  );
  assert.ok(event);
  assert.equal(event.actor_workspace_user_id, null);
  const probe = await client.get<{ requested_by_workspace_user_id: string | null }>(
    `SELECT requested_by_workspace_user_id FROM execution_requests
      WHERE mission_id = ? AND requested_source = 'local_target_mutation'`,
    [f.mission.id]
  );
  assert.ok(probe);
  assert.equal(probe.requested_by_workspace_user_id, null);
});

test('history is bounded, paged, mission scoped and retained when forgotten', async () => {
  const f = await fixture();
  for (let index = 0; index < 7; index++) {
    const current = index === 0 ? f : await fixture();
    if (index)
      await client.run('UPDATE execution_requests SET mission_id = ? WHERE id = ?', [
        f.mission.id,
        current.request.id
      ]);
    await recordTerminalObservation({
      ctx: f.ctx,
      executionRequestId: current.request.id,
      providerSessionId: current.mapping.providerSessionId,
      state: 'exited',
      endReason: 'unknown'
    });
  }
  assert.equal((await getMissionDetail(f.mission.id)).terminalSessions.length, 5);
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const response: Response = await fetch(
      `${server.baseUrl}/api/missions/${f.mission.id}/terminal-sessions/history?limit=2${cursor ? `&cursor=${cursor}` : ''}`
    );
    assert.equal(response.status, 200);
    const page = (await response.json()) as {
      sessions: Array<{ executionRequestId: string; endedAt: string; endReason: string }>;
      nextCursor: string | null;
    };
    assert.ok(page.sessions.length <= 2);
    for (const session of page.sessions) {
      assert.ok(!seen.has(session.executionRequestId));
      seen.add(session.executionRequestId);
      assert.ok(session.endedAt);
      assert.equal(session.endReason, 'unknown');
    }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 7);
  await forgetMissionLatchSession(f.mission.id, {
    executionRequestId: f.request.id,
    providerSessionId: f.mapping.providerSessionId
  });
  assert.equal((await readMissionTerminalHistory(f.mission.id, {})).sessions.length, 7);
  const foreign = await fixture();
  const invalid = await fetch(
    `${server.baseUrl}/api/missions/${foreign.mission.id}/terminal-sessions/history?cursor=${f.request.id}`
  );
  assert.equal(invalid.status, 400);
  await recordTerminalObservation({
    ctx: foreign.ctx,
    executionRequestId: foreign.request.id,
    providerSessionId: foreign.mapping.providerSessionId,
    state: 'lost'
  });
  const lost = (await getMissionDetail(foreign.mission.id)).terminalSessions[0]!;
  assert.equal(lost.endedAt, null);
  assert.equal(lost.endReason, null);
  assert.equal((await readMissionTerminalHistory(foreign.mission.id, {})).sessions.length, 0);
});

test('confirmed end is idempotent, visible on mission read, and parks the current attempt', async () => {
  const f = await fixture();
  const { result, stops } = await withRunner(f, () => post(f.mission.id, f.request.id));
  assert.equal(result.state, 'ended');
  assert.equal(stops, 1);
  assert.equal((await post(f.mission.id, f.request.id)).state, 'ended');
  const detail = await getMissionDetail(f.mission.id);
  assert.equal(detail.terminalSessions[0]!.lastObservedState, 'exited');
  assert.equal(detail.terminalSessions[0]!.endReason, 'ended_by_person');
  assert.ok(detail.terminalSessions[0]!.endedAt);
  assert.equal(detail.objectives[0]!.state, 'submitted');
  const queues = (await getProjectRunQueues(f.project.id)).queues;
  assert.equal(queues.length, 1);
  assert.equal(queues[0]!.paused, true);
  assert.equal(queues[0]!.entries.length, 1);
  assert.equal(
    (await client.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM run_queue_entries WHERE objective_id = ? AND deleted_at IS NULL',
      [f.objectiveId]
    ))!.n,
    0
  );
  assert.ok(
    await client.get(
      `SELECT id FROM mission_events WHERE mission_id = ? AND summary = 'Terminal session ended.'`,
      [f.mission.id]
    )
  );
  assert.ok(
    await client.get(
      `SELECT id FROM entity_changes WHERE entity_id = ? AND entity_type = 'execution_request'`,
      [f.request.id]
    )
  );
});

test('concurrent requests share one stop job', async () => {
  const f = await fixture();
  const { result, stops } = await withRunner(f, () =>
    Promise.all([post(f.mission.id, f.request.id), post(f.mission.id, f.request.id)])
  );
  assert.ok(result.every(reply => reply.state === 'ended'));
  assert.equal(stops, 1);
  const ledger = await client.get<{ status: string }>(
    'SELECT status FROM idempotency_keys WHERE scope = ? AND key = ?',
    ['api.mission.terminal-session.end', f.request.id]
  );
  assert.equal(ledger?.status, 'completed');
});

test('stopping is unconfirmed and a retry can observe confirmed exit without a second stop', async () => {
  const f = await fixture();
  const first = await withRunner(f, () => post(f.mission.id, f.request.id), 'stopping');
  assert.equal(first.result.state, 'unconfirmed');
  assert.equal(first.result.reason, 'stop_unconfirmed');
  assert.equal(
    (await getMissionDetail(f.mission.id)).terminalSessions[0]!.lastObservedState,
    'stopping'
  );
  const retry = await withRunner(f, () => post(f.mission.id, f.request.id), 'exited', 'exited');
  assert.equal(retry.result.state, 'ended');
  assert.equal(retry.stops, 0);
});

test('offline and lost sessions never report ended', async () => {
  const f = await fixture();
  const lost = await withRunner(f, () => post(f.mission.id, f.request.id), 'exited', 'lost');
  assert.equal(lost.result.state, 'unconfirmed');
  assert.equal(lost.result.reason, 'session_unreachable');
  assert.equal(lost.stops, 0);
  await client.run(
    `UPDATE execution_target_runner_registrations SET last_heartbeat_at = '2000-01-01T00:00:00.000Z'`
  );
  const offline = await post(f.mission.id, f.request.id);
  assert.equal(offline.state, 'unconfirmed');
  assert.equal(offline.reason, 'target_offline');
  assert.equal(
    (await getMissionDetail(f.mission.id)).terminalSessions[0]!.lastObservedState,
    'lost'
  );
});

test('completed objectives stay complete and historical sessions do not disconnect a newer attempt', async () => {
  const f = await fixture();
  await client.run(`UPDATE objectives SET state = 'complete' WHERE id = ?`, [f.objectiveId]);
  await withRunner(f, () => post(f.mission.id, f.request.id));
  assert.equal((await getMissionDetail(f.mission.id)).objectives[0]!.state, 'complete');
  const old = await fixture();
  await client.run(
    `INSERT INTO execution_requests
    (id, workspace_id, project_id, mission_id, objective_id, requested_source, status,
     launch_mode, launch_flags_json, metadata_json, created_at, updated_at, revision)
    VALUES (?, 'local-workspace', ?, ?, ?, 'manual_run', 'launched', 'run', '{}', '{}', ?, ?, 1)`,
    [
      crypto.randomUUID(),
      old.project.id,
      old.mission.id,
      old.objectiveId,
      new Date(Date.now() + 1000).toISOString(),
      new Date().toISOString()
    ]
  );
  await withRunner(old, () => post(old.mission.id, old.request.id));
  assert.equal((await getMissionDetail(old.mission.id)).objectives[0]!.state, 'executing');
});

test('mission read permission alone cannot end a session; foreign request ids are hidden', async () => {
  const f = await fixture();
  await dbModule.withRequestContextAsync(async () => {
    dbModule.setActiveTokenAuth({
      workspaceUserId: harness.operatorWorkspaceUserId,
      tokenId: 'read-only',
      scopeGrants: ['mission:read', 'session:*']
    });
    await assert.rejects(
      endMissionLatchSession(f.mission.id, { executionRequestId: f.request.id }),
      { status: 403, message: 'Permission denied: mission:update' }
    );
  });
  const other = await createMission({ projectId: f.project.id, firstObjective: 'Other mission' });
  await assert.rejects(endMissionLatchSession(other.id, { executionRequestId: f.request.id }), {
    status: 404
  });
});

test(
  'live Latch: HTTP end through runner queue terminates an isolated real process',
  {
    skip: process.env.OVERLORD_LIVE_LATCH_TEST !== '1'
  },
  async () => {
    const f = await fixture();
    const home = mkdtempSync('/tmp/ovld-end-latch-');
    const keys = [
      'LATCH_HOME',
      'LATCHD_SOCKET_DIR',
      'LATCH_LATCHD_BIN',
      'LATCH_SESSION_ID',
      'TMUX'
    ] as const;
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const executable = resolveLatchBinaryPath(
      process.env.OVERLORD_LIVE_LATCH_EXECUTABLE ?? 'latch'
    );
    assert.ok(executable, 'Install Latch before running this opt-in test');
    process.env.LATCH_HOME = `${home}/home`;
    process.env.LATCHD_SOCKET_DIR = `${home}/s`;
    process.env.LATCH_LATCHD_BIN = previous.LATCH_LATCHD_BIN ?? join(dirname(executable), 'latchd');
    delete process.env.LATCH_SESSION_ID;
    delete process.env.TMUX;
    let sessionId: string | undefined;
    try {
      const created = JSON.parse(
        execFileSync(executable, ['create', '--manifest-file', '-', '--json'], {
          input: JSON.stringify({
            format_version: 1,
            launch: {
              argv: ['/bin/sleep', '300'],
              cwd: home,
              env: {},
              size: { cols: 80, rows: 24 }
            },
            display: { name: 'overlord-disposable-end-test', source: { kind: 'overlord' } }
          }),
          encoding: 'utf8',
          timeout: 15_000
        })
      );
      sessionId = created.session.id;
      assert.equal(
        (await inspectLatchSession({ executable, providerSessionId: sessionId! })).state,
        'running'
      );
      await client.run('UPDATE execution_requests SET metadata_json = ? WHERE id = ?', [
        JSON.stringify({ providerSession: { ...f.mapping, providerSessionId: sessionId } }),
        f.request.id
      ]);
      const { result, stops } = await withRunner(
        f,
        () => post(f.mission.id, f.request.id),
        'exited',
        'running',
        true
      );
      assert.equal(result.state, 'ended');
      assert.equal(stops, 1);
      assert.equal(
        (await inspectLatchSession({ executable, providerSessionId: sessionId! })).state,
        'exited'
      );
      assert.equal((await post(f.mission.id, f.request.id)).state, 'ended');
      assert.equal(
        (await getMissionDetail(f.mission.id)).terminalSessions[0]!.lastObservedState,
        'exited'
      );
    } finally {
      if (sessionId)
        await stopLatchSession({ executable, providerSessionId: sessionId }).catch(() => {});
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      rmSync(home, { recursive: true, force: true });
    }
  }
);

test(
  'live Latch: spontaneous exit is observed and recorded through the runner queue',
  {
    skip: process.env.OVERLORD_LIVE_LATCH_TEST !== '1'
  },
  async () => {
    const f = await fixture();
    const home = mkdtempSync('/tmp/ovld-end-latch-');
    const keys = [
      'LATCH_HOME',
      'LATCHD_SOCKET_DIR',
      'LATCH_LATCHD_BIN',
      'LATCH_SESSION_ID',
      'TMUX'
    ] as const;
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const executable = resolveLatchBinaryPath(
      process.env.OVERLORD_LIVE_LATCH_EXECUTABLE ?? 'latch'
    );
    assert.ok(executable, 'Install Latch before running this opt-in test');
    process.env.LATCH_HOME = `${home}/home`;
    process.env.LATCHD_SOCKET_DIR = `${home}/s`;
    process.env.LATCH_LATCHD_BIN = previous.LATCH_LATCHD_BIN ?? join(dirname(executable), 'latchd');
    delete process.env.LATCH_SESSION_ID;
    delete process.env.TMUX;
    let sessionId: string | undefined;
    try {
      const created = JSON.parse(
        execFileSync(executable, ['create', '--manifest-file', '-', '--json'], {
          input: JSON.stringify({
            format_version: 1,
            launch: {
              argv: ['/bin/sh', '-c', 'sleep 0.5; exit 7'],
              cwd: home,
              env: {},
              size: { cols: 80, rows: 24 }
            },
            display: { name: 'overlord-disposable-end-test', source: { kind: 'overlord' } }
          }),
          encoding: 'utf8',
          timeout: 15_000
        })
      );
      sessionId = created.session.id;
      assert.equal(
        (await inspectLatchSession({ executable, providerSessionId: sessionId! })).state,
        'running'
      );
      await client.run('UPDATE execution_requests SET metadata_json = ? WHERE id = ?', [
        JSON.stringify({ providerSession: { ...f.mapping, providerSessionId: sessionId } }),
        f.request.id
      ]);
      const exitDeadline = Date.now() + 10_000;
      while (
        (await inspectLatchSession({ executable, providerSessionId: sessionId! })).state !==
          'exited' &&
        Date.now() < exitDeadline
      ) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const { stops } = await withRunner(
        f,
        () => new TerminalSessionObserver().runOnce(),
        'exited',
        'exited',
        true
      );
      assert.equal(stops, 0);
      const ended = (await getMissionDetail(f.mission.id)).terminalSessions[0]!;
      assert.equal(
        ended.endReason,
        'exited',
        JSON.stringify({
          ended,
          jobs: await client.all(
            'SELECT metadata_json, last_error FROM execution_requests WHERE mission_id = ?',
            [f.mission.id]
          )
        })
      );
      assert.equal(
        Date.parse(ended.endedAt!),
        Date.parse(
          (await inspectLatchSession({ executable, providerSessionId: sessionId! })).endedAt!
        )
      );
      assert.equal(
        (await inspectLatchSession({ executable, providerSessionId: sessionId! })).state,
        'exited'
      );
      assert.equal((await post(f.mission.id, f.request.id)).state, 'ended');
      assert.equal(
        (await getMissionDetail(f.mission.id)).terminalSessions[0]!.lastObservedState,
        'exited'
      );
    } finally {
      if (sessionId)
        await stopLatchSession({ executable, providerSessionId: sessionId }).catch(() => {});
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      rmSync(home, { recursive: true, force: true });
    }
  }
);

test('observer forgets absent sessions without inventing terminal exit or polling them again', async () => {
  const f = await fixture();
  const { stops } = await withRunner(
    f,
    () => new TerminalSessionObserver().runOnce(),
    'exited',
    'absent'
  );
  assert.equal(stops, 0);
  assert.equal((await getMissionDetail(f.mission.id)).terminalSessions.length, 0);
  const row = await client.get<{ metadata_json: string }>(
    'SELECT metadata_json FROM execution_requests WHERE id = ?',
    [f.request.id]
  );
  const metadata = JSON.parse(row!.metadata_json);
  assert.equal(metadata.providerSession, undefined);
  assert.equal(metadata.endedTerminalSession, undefined);
  assert.equal((await getMissionDetail(f.mission.id)).objectives[0]!.state, 'executing');
  const countChecks = () =>
    client.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM execution_requests WHERE mission_id = ? AND requested_source = 'local_target_mutation'`,
      [f.mission.id]
    );
  const before = await countChecks();
  await withRunner(f, () => new TerminalSessionObserver().runOnce());
  assert.deepEqual(await countChecks(), before);
});
