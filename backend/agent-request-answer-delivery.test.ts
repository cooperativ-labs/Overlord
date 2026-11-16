import assert from 'node:assert/strict';
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { listenForTest, routerTestApp } from './http/test-app-fixture.ts';

/**
 * Answer delivery for blocking questions (ADR 0065), over real HTTP, the real runner queue, the
 * real generic runner dispatcher and the production Latch Conversation Hub client talking to a
 * loopback stand-in gateway. Only Latch itself is replaced; `OVERLORD_LIVE_LATCH_ANSWER_TEST=1`
 * runs the same path against a real Latch session (see the last test).
 */

const { createIntegrationTestDb } = await import('./test-helpers.ts');
const harness = await createIntegrationTestDb('ovld-answer-delivery-');
const dbModule = await import('./db.ts');
const client = dbModule.requireDatabaseClient();
const { createProject, createProjectResource, createMission } = await import('./repository.ts');
const { launchObjective } = await import('./execution/launch.ts');
const { answerDeliveryTiming, createAgentRequestHumanRouter } =
  await import('./agent-session-routes.ts');
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
const { expireStaleExecutionRequests } =
  await import('../packages/core/service/execution-requests.ts');
const { attachSession, askQuestion } = await import('../packages/core/service/protocol.ts');
const { sendLatchMessage } = await import('../packages/core/service/latch-session.ts');
const { SESSION_ID, snapshot, startFakeGateway } =
  await import('../packages/core/service/test-latch-gateway.ts');
const { resolveLatchBinaryPath } = await import('../packages/core/service/latch-binary.ts');

const server = await listenForTest(
  routerTestApp(
    app => {
      app.use('/api/agent-requests', createAgentRequestHumanRouter());
    },
    { json: false }
  )
);
after(async () => {
  await server.close();
  harness.db.close();
  rmSync(harness.tempDir, { recursive: true, force: true });
});

type Delivery = {
  mode: string;
  reason: string | null;
  state: string | null;
  stage: string | null;
  attempt: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  canRedeliver: boolean;
  confirmationRequired: boolean;
  sessionState: string | null;
};
type RequestBody = { id: string; status: string; revision: number; delivery: Delivery };

async function operatorCtx() {
  return await dbModule.buildWebappServiceContextForWorkspace(
    'local-workspace',
    client,
    harness.operatorWorkspaceUserId
  );
}

/**
 * A launched objective with a Latch mapping, an attached agent session, and a question asked
 * through `ovld protocol ask`. No session channel is prepared: that is what production does.
 */
async function fixture({
  providerSessionId = SESSION_ID,
  question = 'Which database should I use?'
}: { providerSessionId?: string; question?: string } = {}) {
  const ctx = await operatorCtx();
  const target = await ensureCallerDeviceTarget({ ctx });
  await recordRunnerHeartbeat({
    ctx,
    executionTargetId: target.executionTargetId,
    runnerInstanceId: 'answer-test-runner',
    relation: 'native'
  });
  const project = await createProject({ name: `Answer delivery ${crypto.randomUUID()}` });
  await createProjectResource(project.id, {
    directoryPath: createIsolatedCheckout('answer-delivery-'),
    executionTargetId: target.executionTargetId,
    isPrimary: true
  });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Ask a question' });
  const objectiveId = mission.objectives[0]!.id;
  const request = await launchObjective(objectiveId, { agent: 'claude' });
  await client.run(
    `UPDATE execution_requests SET status = 'launched', metadata_json = ? WHERE id = ?`,
    [
      JSON.stringify({
        providerSession: {
          provider: 'latch',
          providerSessionId,
          sessionName: 'answer-test',
          executionTargetId: target.executionTargetId,
          agentSessionId: null,
          createdAt: new Date().toISOString(),
          lastObservedState: 'running'
        }
      }),
      request.id
    ]
  );
  const attached = await attachSession({
    ctx: { ...ctx, source: 'protocol' },
    missionId: mission.id,
    objectiveId,
    executionRequestId: request.id,
    agentIdentifier: 'claude'
  });
  const asked = await askQuestion({
    ctx: { ...ctx, source: 'protocol' },
    missionId: mission.id,
    sessionKey: attached.sessionKey,
    question
  });
  const row = await client.get<{ id: string }>(
    `SELECT id FROM agent_requests WHERE mission_id = ? AND deleted_at IS NULL`,
    [mission.id]
  );
  assert.ok(row, 'ask opened an answerable request without a launch channel');
  return { ctx, target, project, mission, objectiveId, request, requestId: row.id, asked };
}

async function read(f: { mission: { id: string }; requestId: string }): Promise<RequestBody> {
  const response = await fetch(
    `${server.baseUrl}/api/agent-requests?missionId=${f.mission.id}&status=open&limit=50`
  );
  const open = ((await response.json()) as { requests: RequestBody[] }).requests;
  const found = open.find(request => request.id === f.requestId);
  if (found) return found;
  const all = (await (
    await fetch(`${server.baseUrl}/api/agent-requests?missionId=${f.mission.id}`)
  ).json()) as { requests: RequestBody[] };
  const request = all.requests.find(candidate => candidate.id === f.requestId);
  assert.ok(request);
  return request;
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${server.baseUrl}/api/agent-requests/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    json: (await response.json()) as {
      resolved?: boolean;
      redelivered?: boolean;
      request?: RequestBody;
      code?: string;
      error?: string;
    }
  };
}

type Gateway = Awaited<ReturnType<typeof startFakeGateway>>;

/**
 * Run the runner's half while `action` is in flight: claim queued jobs for the target, dispatch
 * them through the generic runner dispatcher, and store the result. `sendLatchMessage` is the
 * production client pointed at the stand-in gateway. `claimOnly` models a runner that takes a
 * job and dies before reporting.
 */
async function withRunner<T>(
  f: Awaited<ReturnType<typeof fixture>>,
  gateway: Gateway | null,
  action: () => Promise<T>,
  { claimOnly = false, env }: { claimOnly?: boolean; env?: NodeJS.ProcessEnv } = {}
): Promise<T> {
  let done = false;
  const provider: InstanceType<typeof FakeLocalTargetProvider> = new FakeLocalTargetProvider({
    target: {
      executionTargetId: f.target.executionTargetId,
      transport: 'fake',
      deviceLabel: 'test runner'
    },
    handlers: {
      sendLatchMessage: async input => {
        try {
          return {
            ok: true,
            target: provider.target,
            value: await sendLatchMessage({
              ...input,
              ...(gateway ? { gateway: { baseUrl: gateway.baseUrl, token: gateway.token } } : {}),
              ...(env ? { env } : {})
            })
          };
        } catch (error) {
          return {
            ok: false,
            target: provider.target,
            code: 'TARGET_OPERATION_FAILED',
            message: error instanceof Error ? error.message : 'failed'
          };
        }
      }
    }
  });
  const pending = action().finally(() => {
    done = true;
  });
  const deadline = Date.now() + 30_000;
  while (!done && Date.now() < deadline) {
    const row = await client.get<{ id: string; metadata_json: string }>(
      `SELECT id, metadata_json FROM execution_requests WHERE execution_target_id = ?
        AND requested_source = 'local_target_mutation' AND status = 'queued' LIMIT 1`,
      [f.target.executionTargetId]
    );
    if (!row) {
      await new Promise(resolve => setTimeout(resolve, 5));
      continue;
    }
    const mutation = parseLocalTargetMutation(row.metadata_json);
    assert.ok(mutation);
    const claimed = await client.run(
      `UPDATE execution_requests
          SET status = 'claimed', claim_expires_at = ?
        WHERE id = ? AND status = 'queued'`,
      [new Date(Date.now() + 60_000).toISOString(), row.id]
    );
    if (claimed.changes === 0 || claimOnly) continue;
    const result = await executeLocalTargetMutation({ mutation, provider });
    await completeLocalTargetMutationRequest({ ctx: f.ctx, requestId: row.id, result });
  }
  assert.ok(done, 'HTTP request completed within the runner test deadline');
  return await pending;
}

function acceptingGateway() {
  return startFakeGateway({
    onOpen: session => session.send(snapshot({ phase: 'idle', enabled: true })),
    onMessage: (message, session) =>
      session.send({
        type: 'operation_result',
        operationId: message.operationId,
        status: 'accepted',
        itemId: 'item-1',
        reason: null
      })
  });
}

async function answerEvents(missionId: string) {
  return await client.all<{ summary: string }>(
    `SELECT summary FROM mission_events WHERE mission_id = ? AND type = 'answer'`,
    [missionId]
  );
}

async function deliveryChanges(requestId: string) {
  const rows = await client.all<{ changed_fields_json: string | null }>(
    `SELECT changed_fields_json FROM entity_changes
      WHERE entity_type = 'agent_request' AND entity_id = ?`,
    [requestId]
  );
  return rows.filter(row => (row.changed_fields_json ?? '').includes('application_state'));
}

test('an ask from a launched session is answerable, and the answer reaches Latch once', async () => {
  const f = await fixture();
  const before = await read(f);
  assert.equal(before.status, 'open');
  assert.deepEqual(
    { mode: before.delivery.mode, stage: before.delivery.stage, attempt: before.delivery.attempt },
    { mode: 'latch', stage: null, attempt: null }
  );
  assert.equal(before.delivery.sessionState, 'running');
  const channel = await client.get<{
    launch_kind: string;
    credential_hash: string | null;
    lease_expires_at: string | null;
    state: string;
  }>(
    `SELECT launch_kind, credential_hash, lease_expires_at, state FROM agent_session_channels
      WHERE mission_id = ?`,
    [f.mission.id]
  );
  assert.deepEqual(
    { ...channel },
    { launch_kind: 'protocol', credential_hash: null, lease_expires_at: null, state: 'online' }
  );

  const gateway = await acceptingGateway();
  try {
    const result = await withRunner(f, gateway, () =>
      post(`${f.requestId}/resolve`, {
        expectedRevision: before.revision,
        resolution: { text: 'Postgres' }
      })
    );
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.resolved, true);
    const delivery = result.json.request!.delivery;
    assert.equal(delivery.stage, 'confirmed');
    assert.equal(delivery.state, 'applied');
    assert.equal(delivery.attempt, 1);
    assert.equal(delivery.failureCode, null);
    assert.equal(delivery.canRedeliver, false);
    assert.deepEqual(gateway.received, [
      {
        type: 'send_message',
        operationEpoch: 'epoch-1',
        operationId: f.requestId,
        text: 'Postgres'
      }
    ]);
    assert.equal((await answerEvents(f.mission.id)).length, 1);

    // Repeating the answer, or asking for a redelivery of a confirmed one, sends nothing.
    const repeat = await post(`${f.requestId}/resolve`, {
      expectedRevision: result.json.request!.revision,
      resolution: { text: 'Postgres' }
    });
    assert.equal(repeat.status, 409);
    assert.equal(repeat.json.code, 'request_not_deliverable');
    const redeliver = await post(`${f.requestId}/redeliver`, { expectedAttempt: 1 });
    assert.equal(redeliver.status, 409);
    assert.equal(redeliver.json.code, 'agent_request_delivery_conflict');
    assert.equal(gateway.received.length, 1);
  } finally {
    await gateway.close();
  }
});

test('concurrent answers record one resolution and send one message', async () => {
  const f = await fixture();
  const before = await read(f);
  const gateway = await acceptingGateway();
  try {
    const results = await withRunner(f, gateway, () =>
      Promise.all(
        ['Postgres', 'SQLite'].map(text =>
          post(`${f.requestId}/resolve`, {
            expectedRevision: before.revision,
            resolution: { text }
          })
        )
      )
    );
    const winners = results.filter(result => result.status === 200 && result.json.resolved);
    assert.equal(winners.length, 1, JSON.stringify(results.map(result => result.json)));
    for (const loser of results.filter(result => !winners.includes(result))) {
      assert.ok(
        loser.status === 409 || loser.json.resolved === false,
        'the losing answer is told it did not take effect'
      );
    }
    assert.equal(gateway.received.filter(message => message.type === 'send_message').length, 1);
    assert.equal((await answerEvents(f.mission.id)).length, 1);
  } finally {
    await gateway.close();
  }
});

test('a refused delivery is failed, and a guarded redelivery sends the same answer once', async () => {
  const f = await fixture();
  const before = await read(f);
  let refuse = true;
  const gateway = await startFakeGateway({
    onOpen: session =>
      session.send(
        refuse
          ? snapshot({
              phase: 'awaiting_input',
              enabled: false,
              reason: 'resolve the pending request first'
            })
          : snapshot({ phase: 'idle', enabled: true })
      ),
    onMessage: (message, session) =>
      session.send({
        type: 'operation_result',
        operationId: message.operationId,
        status: 'accepted',
        itemId: null,
        reason: null
      })
  });
  try {
    const failed = await withRunner(f, gateway, () =>
      post(`${f.requestId}/resolve`, {
        expectedRevision: before.revision,
        resolution: { text: 'Use the staging bucket' }
      })
    );
    assert.equal(failed.json.resolved, true, 'the answer is recorded');
    const delivery = failed.json.request!.delivery;
    assert.equal(delivery.stage, 'failed', 'recording is not reported as delivery');
    assert.equal(delivery.state, 'not_applied');
    assert.equal(delivery.failureCode, 'latch_refused');
    assert.match(delivery.failureMessage ?? '', /pending request/);
    assert.equal(delivery.canRedeliver, true);
    assert.equal(delivery.confirmationRequired, false);
    assert.equal(gateway.received.length, 0, 'a refused answer was never sent');
    assert.equal((await deliveryChanges(f.requestId)).length >= 2, true);

    const stale = await post(`${f.requestId}/redeliver`, { expectedAttempt: 2 });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, 'agent_request_delivery_conflict');

    refuse = false;
    const retries = await withRunner(f, gateway, () =>
      Promise.all([1, 2].map(() => post(`${f.requestId}/redeliver`, { expectedAttempt: 1 })))
    );
    assert.deepEqual(retries.map(result => result.status).sort(), [200, 409]);
    const retried = retries.find(result => result.status === 200)!;
    assert.equal(retried.json.redelivered, true);
    assert.equal(retried.json.request!.delivery.stage, 'confirmed');
    assert.equal(retried.json.request!.delivery.attempt, 2);
    assert.deepEqual(gateway.received, [
      {
        type: 'send_message',
        operationEpoch: 'epoch-1',
        operationId: `${f.requestId}.2`,
        text: 'Use the staging bucket'
      }
    ]);
    assert.equal((await answerEvents(f.mission.id)).length, 1, 'no second answer event');
  } finally {
    await gateway.close();
  }
});

test('an unconfirmed delivery is never resent blindly and is reconciled from the Latch receipt', async () => {
  const f = await fixture();
  const before = await read(f);
  const gateway = await startFakeGateway({
    onOpen: session => session.send(snapshot({ phase: 'idle', enabled: true })),
    onMessage: (message, session) => {
      // The first send lands in Latch and the socket dies before the receipt is returned.
      if (message.type === 'send_message') session.close();
      else if (message.type === 'operation_status') {
        session.send({
          type: 'operation_result',
          operationId: message.operationId,
          status: 'accepted',
          itemId: 'item-9',
          reason: null
        });
      }
    }
  });
  try {
    const first = await withRunner(f, gateway, () =>
      post(`${f.requestId}/resolve`, {
        expectedRevision: before.revision,
        resolution: { text: 'Yes, drop the table' }
      })
    );
    const delivery = first.json.request!.delivery;
    assert.equal(delivery.stage, 'unconfirmed');
    assert.equal(delivery.state, 'unknown');
    assert.equal(delivery.failureCode, 'unconfirmed');
    assert.equal(delivery.confirmationRequired, true);
    assert.equal(delivery.canRedeliver, true);

    const blind = await post(`${f.requestId}/redeliver`, { expectedAttempt: 1 });
    assert.equal(blind.status, 409);
    assert.equal(blind.json.code, 'delivery_confirmation_required');
    assert.equal(gateway.received.length, 1, 'nothing was sent without confirmation');

    const confirmed = await withRunner(f, gateway, () =>
      post(`${f.requestId}/redeliver`, { expectedAttempt: 1, confirmUnconfirmed: true })
    );
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    assert.equal(confirmed.json.request!.delivery.stage, 'confirmed');
    assert.deepEqual(
      gateway.received.map(message => [message.type, message.operationId]),
      [
        ['send_message', f.requestId],
        ['operation_status', f.requestId]
      ],
      'the receipt proved delivery, so the answer was not typed a second time'
    );
  } finally {
    await gateway.close();
  }
});

test('an answer no runner picks up is withdrawn, reported failed, and never sent late', async () => {
  const f = await fixture();
  const before = await read(f);
  const previousWait = answerDeliveryTiming.waitMs;
  answerDeliveryTiming.waitMs = 300;
  const gateway = await acceptingGateway();
  try {
    const result = await post(`${f.requestId}/resolve`, {
      expectedRevision: before.revision,
      resolution: { text: 'Go ahead' }
    });
    assert.equal(result.status, 200);
    const delivery = result.json.request!.delivery;
    assert.equal(delivery.stage, 'failed');
    assert.equal(delivery.failureCode, 'not_dispatched');
    assert.equal(delivery.canRedeliver, true);
    const job = await client.get<{ status: string }>(
      `SELECT status FROM execution_requests WHERE idempotency_key = ?`,
      [f.requestId]
    );
    assert.equal(job?.status, 'cancelled');

    // The runner comes back: there is nothing left for it to deliver.
    await withRunner(f, gateway, () => new Promise(resolve => setTimeout(resolve, 100)));
    assert.equal(gateway.received.length, 0);

    answerDeliveryTiming.waitMs = previousWait;
    const retried = await withRunner(f, gateway, () =>
      post(`${f.requestId}/redeliver`, { expectedAttempt: 1 })
    );
    assert.equal(retried.json.request!.delivery.stage, 'confirmed');
    assert.equal(gateway.received.length, 1);
  } finally {
    answerDeliveryTiming.waitMs = previousWait;
    await gateway.close();
  }
});

test('a job a runner holds is dispatched, then unconfirmed if the runner never reports', async () => {
  const f = await fixture();
  const before = await read(f);
  const previousWait = answerDeliveryTiming.waitMs;
  answerDeliveryTiming.waitMs = 300;
  try {
    const result = await withRunner(
      f,
      null,
      () =>
        post(`${f.requestId}/resolve`, {
          expectedRevision: before.revision,
          resolution: { text: 'Go ahead' }
        }),
      { claimOnly: true }
    );
    assert.equal(result.json.request!.delivery.stage, 'dispatched');
    assert.equal(result.json.request!.delivery.state, 'emitted');
    assert.equal(result.json.request!.delivery.canRedeliver, false);
    const inFlight = await post(`${f.requestId}/redeliver`, { expectedAttempt: 1 });
    assert.equal(inFlight.status, 409, 'no second attempt while one is in flight');

    await expireStaleExecutionRequests({
      ctx: f.ctx,
      now: new Date(Date.now() + 3_600_000).toISOString()
    });
    const after = (await read(f)).delivery;
    assert.equal(after.stage, 'unconfirmed', 'a claimed job may have been sent');
    assert.equal(after.failureCode, 'runner_lost');
    assert.equal(after.confirmationRequired, true);
  } finally {
    answerDeliveryTiming.waitMs = previousWait;
  }
});

test('a runner that cannot reach a Latch gateway reports a definitive, actionable failure', async () => {
  const f = await fixture();
  const before = await read(f);
  const result = await withRunner(
    f,
    null,
    () =>
      post(`${f.requestId}/resolve`, {
        expectedRevision: before.revision,
        resolution: { text: 'Go ahead' }
      }),
    { env: { LATCH_HOME: `${harness.tempDir}/no-latch-home` } as NodeJS.ProcessEnv }
  );
  const delivery = result.json.request!.delivery;
  assert.equal(delivery.stage, 'failed');
  assert.equal(delivery.failureCode, 'gateway_unavailable');
  assert.match(delivery.failureMessage ?? '', /latch serve/);
  assert.equal(delivery.canRedeliver, true);
});

test('an ended session refuses an answer; a lost one is attempted; an offline target refuses', async () => {
  const f = await fixture();
  const setState = async (state: string) => {
    const row = await client.get<{ metadata_json: string }>(
      `SELECT metadata_json FROM execution_requests WHERE id = ?`,
      [f.request.id]
    );
    const metadata = JSON.parse(row!.metadata_json) as {
      providerSession: Record<string, unknown>;
    };
    metadata.providerSession.lastObservedState = state;
    await client.run(`UPDATE execution_requests SET metadata_json = ? WHERE id = ?`, [
      JSON.stringify(metadata),
      f.request.id
    ]);
  };

  await setState('exited');
  const ended = await read(f);
  assert.deepEqual(
    [ended.delivery.mode, ended.delivery.reason, ended.delivery.sessionState],
    ['read_only', 'latch_session_exited', 'exited']
  );
  const refused = await post(`${f.requestId}/resolve`, {
    expectedRevision: ended.revision,
    resolution: { text: 'too late' }
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.code, 'request_not_deliverable');
  assert.equal((await read(f)).status, 'open', 'nothing was recorded');
  assert.equal((await answerEvents(f.mission.id)).length, 0);

  await setState('lost');
  const lost = await read(f);
  assert.deepEqual([lost.delivery.mode, lost.delivery.sessionState], ['latch', 'lost']);

  await client.run(
    `UPDATE execution_target_runner_registrations SET last_heartbeat_at = ? WHERE execution_target_id = ?`,
    ['2020-01-01T00:00:00.000Z', f.target.executionTargetId]
  );
  await setState('running');
  const offline = await read(f);
  assert.deepEqual(
    [offline.delivery.mode, offline.delivery.reason],
    ['read_only', 'target_offline']
  );
  const blocked = await post(`${f.requestId}/resolve`, {
    expectedRevision: offline.revision,
    resolution: { text: 'nobody home' }
  });
  assert.equal(blocked.status, 409);
  assert.equal((await read(f)).status, 'open');
  await recordRunnerHeartbeat({
    ctx: f.ctx,
    executionTargetId: f.target.executionTargetId,
    runnerInstanceId: 'answer-test-runner',
    relation: 'native'
  });
});

test('answering and redelivering both require session:attach', async () => {
  const f = await fixture();
  // The same router behind a token that can read sessions but not attach to them.
  const readOnly = await listenForTest(
    routerTestApp(
      app => {
        app.use((_req, res, next) => {
          void dbModule.withRequestContextAsync(async () => {
            dbModule.setActiveTokenAuth({
              workspaceUserId: harness.operatorWorkspaceUserId,
              tokenId: 'read-only-token',
              scopeGrants: ['mission:read', 'session:read']
            });
            next();
            await new Promise(resolve => res.once('close', resolve));
          });
        });
        app.use('/api/agent-requests', createAgentRequestHumanRouter());
      },
      { json: false }
    )
  );
  try {
    const before = await read(f);
    const call = async (path: string, body: unknown) =>
      (
        await fetch(`${readOnly.baseUrl}/api/agent-requests/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        })
      ).status;
    assert.equal(
      await call(`${f.requestId}/resolve`, {
        expectedRevision: before.revision,
        resolution: { text: 'no' }
      }),
      403
    );
    assert.equal(await call(`${f.requestId}/redeliver`, { expectedAttempt: 1 }), 403);
    assert.equal((await read(f)).status, 'open');
    assert.equal((await answerEvents(f.mission.id)).length, 0);
  } finally {
    await readOnly.close();
  }
});

// ---------------------------------------------------------------------------
// Live: a real harness in a real Latch session receives the answer.
// ---------------------------------------------------------------------------

type LiveSnapshot = {
  items: unknown[];
  state: { phase: string; sendMessage: { enabled: boolean; reason: string | null } };
};

/** Read one Conversation Hub snapshot from a real gateway; null while the session is unbound. */
function liveSnapshot(
  baseUrl: string,
  token: string,
  sessionId: string
): Promise<LiveSnapshot | null> {
  return new Promise(resolve => {
    const socket = new WebSocket(
      `${baseUrl.replace(/^http/, 'ws')}/v2/sessions/${sessionId}/conversation`,
      [`latch.v2.${token}`]
    );
    const timer = setTimeout(() => {
      socket.close();
      resolve(null);
    }, 8_000);
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)) as { type?: string } & LiveSnapshot;
      if (message.type !== 'snapshot') return;
      clearTimeout(timer);
      socket.close();
      resolve(message);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function waitFor<T>(
  label: string,
  timeoutMs: number,
  probe: () => Promise<T | null | undefined | false>
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
}

/**
 * Opt-in (`OVERLORD_LIVE_LATCH_ANSWER_TEST=1`). Needs Latch (with `latchd`) and a signed-in
 * harness on this machine: `claude` by default, or `OVERLORD_LIVE_LATCH_AGENT=codex`.
 *
 * Everything Latch-side is disposable: a private `LATCH_HOME`, its own gateway on an ephemeral
 * loopback port, and its own token, laid out the way Latch's Remote Link supervisor lays them
 * out so the production discovery is what finds the gateway. The harness is real and so is the
 * Conversation Hub. The answer travels HTTP resolve -> runner queue -> runner dispatcher ->
 * `sendLatchMessage`, and the proof is the user turn in the agent's own conversation.
 */
test(
  'live Latch: an answer submitted over HTTP arrives as one user turn in a real waiting agent',
  { skip: process.env.OVERLORD_LIVE_LATCH_ANSWER_TEST !== '1', timeout: 300_000 },
  async () => {
    const agent = process.env.OVERLORD_LIVE_LATCH_AGENT === 'codex' ? 'codex' : 'claude';
    const executable = resolveLatchBinaryPath(
      process.env.OVERLORD_LIVE_LATCH_EXECUTABLE ?? 'latch'
    );
    assert.ok(executable, 'Install Latch before running this opt-in test');
    const root = mkdtempSync('/tmp/ovld-ans-');
    const home = `${root}/home`;
    const runtime = `${home}/remote-access/runtime`;
    const workdir = join(
      process.env.OVERLORD_LIVE_LATCH_CWD ?? process.cwd(),
      `.overlord/tmp/live-answer-${crypto.randomUUID().slice(0, 8)}`
    );
    mkdirSync(runtime, { recursive: true });
    mkdirSync(workdir, { recursive: true });
    mkdirSync(`${root}/ovld`, { recursive: true });
    const keys = [
      'LATCH_HOME',
      'LATCHD_SOCKET_DIR',
      'LATCH_LATCHD_BIN',
      'LATCH_SESSION_ID',
      'TMUX'
    ];
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    process.env.LATCH_HOME = home;
    process.env.LATCHD_SOCKET_DIR = `${root}/s`;
    process.env.LATCH_LATCHD_BIN = previous.LATCH_LATCHD_BIN ?? join(dirname(executable), 'latchd');
    delete process.env.LATCH_SESSION_ID;
    delete process.env.TMUX;
    let gatewayProcess: ChildProcess | undefined;
    let sessionId: string | undefined;
    try {
      const readyFile = `${runtime}/remote-link-gateway-ready.json`;
      const tokenFile = `${runtime}/remote-link-gateway.token`;
      gatewayProcess = spawn(
        executable,
        ['serve', '--bind', '127.0.0.1:0', '--token-file', tokenFile, '--ready-file', readyFile],
        { stdio: 'ignore', env: process.env }
      );
      await waitFor('the disposable Latch gateway', 20_000, async () => existsSync(readyFile));
      const ready = JSON.parse(readFileSync(readyFile, 'utf8')) as { url: string };
      const token = readFileSync(tokenFile, 'utf8').trim();

      const nonce = `OVLD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const prompt =
        'This is an automated delivery test. Reply with the single word READY and then wait. ' +
        'Do not use any tools.';
      const created = JSON.parse(
        execFileSync(executable, ['create', '--manifest-file', '-', '--json'], {
          input: JSON.stringify({
            format_version: 1,
            launch: {
              argv:
                agent === 'claude'
                  ? ['claude', '--model', process.env.OVERLORD_LIVE_LATCH_MODEL ?? 'haiku', prompt]
                  : ['codex', prompt],
              cwd: workdir,
              // An empty Overlord home keeps this throwaway agent's hooks away from real missions.
              env: {
                OVLD_HOME: `${root}/ovld`,
                OVERLORD_MISSION_ID: '',
                OVERLORD_OBJECTIVE_ID: ''
              },
              inherit_env: true,
              size: { cols: 120, rows: 36 },
              agent,
              login_shell: { path: process.env.SHELL ?? '/bin/zsh' }
            },
            display: { name: 'overlord-disposable-answer-test', source: { kind: 'overlord' } }
          }),
          encoding: 'utf8',
          timeout: 30_000
        })
      ) as { session: { id: string } };
      sessionId = created.session.id;

      // The agent finishes its first turn and waits: this is the "waiting agent".
      await waitFor('the agent to become idle', 120_000, async () => {
        const state = (await liveSnapshot(ready.url, token, sessionId!))?.state;
        return state?.phase === 'idle' && state.sendMessage.enabled;
      });

      const f = await fixture({
        providerSessionId: sessionId,
        question: 'Which token should I print?'
      });
      const before = await read(f);
      assert.equal(before.delivery.mode, 'latch');
      const answer = `Reply with exactly this token and nothing else: ${nonce}`;
      const result = await withRunner(f, null, () =>
        post(`${f.requestId}/resolve`, {
          expectedRevision: before.revision,
          resolution: { text: answer }
        })
      );
      assert.equal(result.status, 200, JSON.stringify(result.json));
      assert.equal(
        result.json.request!.delivery.stage,
        'confirmed',
        JSON.stringify(result.json.request!.delivery)
      );

      // The proof comes from the agent side, not from Overlord: Latch's record of what its
      // bridge handed to the harness, and what the harness said at the end of that turn.
      const hookLog = `${home}/sessions/${sessionId}/conversation-source-hooks.jsonl`;
      const hookEvents = () =>
        readFileSync(hookLog, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(line => JSON.parse(line) as Record<string, unknown>);
      const submitted = () =>
        hookEvents().filter(
          event =>
            event.bridge_event === 'command.result' &&
            String(event.command_id ?? '').startsWith('submit_prompt') &&
            event.outcome === 'accepted'
        ).length;
      const reply = await waitFor('the agent to act on the delivered answer', 120_000, async () =>
        hookEvents().find(
          event =>
            event.hook_event_name === 'Stop' &&
            String(event.last_assistant_message ?? '').includes(nonce)
        )
      );
      assert.equal(submitted(), 1, 'the harness was handed the answer exactly once');
      const turn = (await liveSnapshot(ready.url, token, sessionId!))!.items.filter(item =>
        JSON.stringify(item).includes(answer)
      );
      assert.equal(turn.length, 1, 'the answer is one user turn in the conversation');

      // A repeated submission cannot send a second copy.
      const repeat = await post(`${f.requestId}/resolve`, {
        expectedRevision: result.json.request!.revision,
        resolution: { text: answer }
      });
      assert.equal(repeat.status, 409);
      const redeliver = await post(`${f.requestId}/redeliver`, { expectedAttempt: 1 });
      assert.equal(redeliver.status, 409);
      await new Promise(resolve => setTimeout(resolve, 3_000));
      assert.equal(submitted(), 1, 'still exactly one delivered turn');
      console.warn(
        `[live-answer] agent=${agent} harness=${String(
          hookEvents().find(event => event.claude_version)?.claude_version ?? 'unknown'
        )} session=${sessionId} stage=confirmed submitted=${submitted()} ` +
          `reply=${JSON.stringify(reply.last_assistant_message)}`
      );

      // An ended session never receives an answer: Latch refuses, and it is reported failed.
      execFileSync(executable, ['stop', sessionId, '--json'], { timeout: 15_000 });
      const g = await fixture({ providerSessionId: sessionId, question: 'One more thing?' });
      const late = await read(g);
      const afterStop = await withRunner(g, null, () =>
        post(`${g.requestId}/resolve`, {
          expectedRevision: late.revision,
          resolution: { text: 'This must not arrive' }
        })
      );
      assert.equal(afterStop.json.request!.delivery.stage, 'failed');
      console.warn(
        `[live-answer] after stop: stage=failed code=${afterStop.json.request!.delivery.failureCode} ` +
          `message=${afterStop.json.request!.delivery.failureMessage}`
      );
    } finally {
      if (sessionId) {
        try {
          execFileSync(executable, ['stop', sessionId, '--json'], { timeout: 15_000 });
        } catch {
          // Already stopped.
        }
      }
      gatewayProcess?.kill();
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(root, { recursive: true, force: true });
      rmSync(workdir, { recursive: true, force: true });
    }
  }
);
