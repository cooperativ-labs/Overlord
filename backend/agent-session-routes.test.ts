import express from 'express';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-agent-session-routes-'));
process.env.OVERLORD_SQLITE_PATH = path.join(tempDir, 'webapp.sqlite');
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-32-chars-min';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:4319';

const dbModule = await import('./db.ts');
const client = await dbModule.initDatabase();

const {
  createAgentRequestHumanRouter,
  createAgentSessionChannelRouter,
  createAgentSessionInputHumanRouter,
  AGENT_SESSION_CHANNEL_ROUTE_PREFIX
} = await import('./agent-session-routes.ts');
const { createSessionChannel } = await import('../packages/core/service/agent-session/channels.ts');
const { createProject } = await import('../packages/core/service/projects.ts');
const { protocolCreate } = await import('../packages/core/service/protocol.ts');
const { seedServiceOperator } = await import('../packages/core/service/test-helpers.ts');
const { createServiceContext } = await import('../packages/core/service/context.ts');

/**
 * The adapter route family, exercised over real HTTP.
 *
 * The property under test is not "does the endpoint work" but "who is it reachable by". A
 * channel credential and a human credential are separate authentication families, and the
 * separation is enforced by where this router is mounted — ahead of the `/api` human guard —
 * rather than by a check inside a shared handler. These tests pin that behavior so a later
 * refactor that moves the mount point fails loudly instead of silently widening authority.
 */

let baseUrl = '';
let server: ReturnType<express.Express['listen']>;
let channelToken = '';
let channelId = '';
let otherToken = '';
let fixtureMissionId = '';
let fixtureObjectiveId = '';
let fixtureObjectiveDisplayId = '';
let fixtureProjectId = '';

before(async () => {
  const app = express();
  app.use(AGENT_SESSION_CHANNEL_ROUTE_PREFIX, createAgentSessionChannelRouter());
  app.use('/api/agent-requests', createAgentRequestHumanRouter());
  app.use('/api/agent-session-inputs', createAgentSessionInputHumanRouter());
  // Everything else demands a human. A channel credential must never reach it.
  app.use('/api', (_req, res) => res.status(401).json({ error: 'Authentication required' }));

  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  await seedServiceOperator({ db: client });
  await dbModule.setActiveWorkspace('local-workspace');
  const ctx = await createServiceContext({ db: client, source: 'protocol' });
  const project = await createProject({ ctx, name: 'Routes', slug: 'routes' });
  const mission = await protocolCreate({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'Route test' }]
  });
  fixtureMissionId = mission.mission.id;
  fixtureObjectiveId = mission.objectives[0]!.id;
  fixtureObjectiveDisplayId = mission.objectives[0]!.displayId;
  fixtureProjectId = project.id;

  const prepared = await createSessionChannel({
    ctx,
    missionId: mission.mission.id,
    projectId: project.id,
    adapterKey: 'claude'
  });
  channelId = prepared.channel.id;
  channelToken = prepared.bootstrap.token;

  const second = await createSessionChannel({
    ctx,
    missionId: mission.mission.id,
    projectId: project.id,
    adapterKey: 'claude'
  });
  otherToken = second.bootstrap.token;
});

describe('human objective scoping', () => {
  it('returns request rows only for the addressed objective', async () => {
    const { insertObjective } = await import('../packages/core/service/missions.ts');
    const { createRequest, releaseRequestToTerminal } =
      await import('../packages/core/service/agent-session/requests.ts');
    const ctx = await createServiceContext({ db: client, source: 'protocol' });
    const sibling = await insertObjective({
      ctx,
      missionId: fixtureMissionId,
      instructionText: 'Sibling route scope',
      state: 'future'
    });
    const firstChannel = await createSessionChannel({
      ctx,
      missionId: fixtureMissionId,
      objectiveId: fixtureObjectiveId,
      projectId: fixtureProjectId
    });
    const siblingChannel = await createSessionChannel({
      ctx,
      missionId: fixtureMissionId,
      objectiveId: sibling.id,
      projectId: fixtureProjectId
    });
    const first = await createRequest({
      ctx,
      channel: firstChannel.channel,
      kind: 'permission',
      summary: 'First objective request'
    });
    const other = await createRequest({
      ctx,
      channel: siblingChannel.channel,
      kind: 'permission',
      summary: 'Sibling objective request'
    });
    await releaseRequestToTerminal({ ctx, requestId: first.id, reason: 'local_activity' });
    await releaseRequestToTerminal({ ctx, requestId: other.id, reason: 'local_activity' });

    const response = await fetch(
      `${baseUrl}/api/agent-requests?objectiveId=${encodeURIComponent(fixtureObjectiveDisplayId)}`
    );
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const body = JSON.parse(responseText) as { requests: Array<{ id: string }> };
    assert.deepEqual(
      body.requests.map(request => request.id),
      [first.id]
    );
  });

  it('returns input rows and the channel only for the addressed objective', async () => {
    const { listObjectives } = await import('../packages/core/service/missions.ts');
    const { enqueueSessionInput } =
      await import('../packages/core/service/agent-session/inputs.ts');
    const { attachSession } = await import('../packages/core/service/protocol.ts');
    const ctx = await createServiceContext({ db: client, source: 'protocol' });
    const objectives = await listObjectives({ ctx, missionId: fixtureMissionId });
    const sibling = objectives.find(objective => objective.id !== fixtureObjectiveId);
    assert.ok(sibling);
    const firstChannel = await createSessionChannel({
      ctx,
      missionId: fixtureMissionId,
      objectiveId: fixtureObjectiveId,
      projectId: fixtureProjectId
    });
    const siblingChannel = await createSessionChannel({
      ctx,
      missionId: fixtureMissionId,
      objectiveId: sibling.id,
      projectId: fixtureProjectId
    });
    const attached = await attachSession({
      ctx,
      missionId: fixtureMissionId,
      objectiveId: fixtureObjectiveId,
      sessionChannelId: firstChannel.channel.id
    });
    const firstInput = await enqueueSessionInput({
      ctx,
      channel: {
        ...firstChannel.channel,
        session_id: attached.session.id,
        state: 'online'
      },
      kind: 'instruction',
      body: 'First objective input'
    });
    await client.run(`UPDATE agent_session_inputs SET status = 'emitted' WHERE id = ?`, [
      firstInput.id
    ]);
    await client.run(
      `INSERT INTO agent_session_inputs (
         id, workspace_id, project_id, mission_id, objective_id, channel_id, session_id,
         kind, body, idempotency_key, created_by_workspace_user_id, status,
         attempt_count, created_at, updated_at, revision
       ) SELECT ?, workspace_id, project_id, mission_id, ?, ?, session_id,
                kind, ?, NULL, created_by_workspace_user_id, 'emitted',
                0, created_at, updated_at, 1
           FROM agent_session_inputs WHERE id = ?`,
      [
        'sibling-input',
        sibling.id,
        siblingChannel.channel.id,
        'Sibling objective input',
        firstInput.id
      ]
    );

    const response = await fetch(
      `${baseUrl}/api/agent-session-inputs?objectiveId=${encodeURIComponent(
        fixtureObjectiveDisplayId
      )}`
    );
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const body = JSON.parse(responseText) as {
      inputs: Array<{ id: string }>;
      liveChannel: { id: string } | null;
    };
    assert.deepEqual(
      body.inputs.map(input => input.id),
      [firstInput.id]
    );
    assert.equal(body.liveChannel?.id, firstChannel.channel.id);
  });
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
});

function adapterUrl(pathname: string): string {
  return `${baseUrl}${AGENT_SESSION_CHANNEL_ROUTE_PREFIX}${pathname}`;
}

describe('adapter route authentication', () => {
  it('rejects a request with no credential', async () => {
    const response = await fetch(adapterUrl('/self'));
    assert.equal(response.status, 401);
  });

  it('rejects a normal USER_TOKEN', async () => {
    // A user token is not merely insufficient here — it is not a member of this
    // credential family at all, and the rejection is indistinguishable from an
    // unknown credential so the endpoint cannot be used as a probing oracle.
    const response = await fetch(adapterUrl('/self'), {
      headers: { authorization: 'Bearer out_deadbeefdeadbeefdeadbeefdeadbeef' }
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Session channel credential required' });
  });

  it('rejects a protocol session key', async () => {
    const response = await fetch(adapterUrl('/self'), {
      headers: { authorization: 'Bearer sess_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }
    });
    assert.equal(response.status, 401);
  });

  it('accepts its own channel credential and reports only that channel', async () => {
    const response = await fetch(adapterUrl('/self'), {
      headers: { authorization: `Bearer ${channelToken}` }
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { channelId: string; bound: boolean };
    assert.equal(body.channelId, channelId);
    // No session has attached yet, and the channel says so rather than guessing.
    assert.equal(body.bound, false);
  });

  it('scopes a credential to exactly one channel', async () => {
    const response = await fetch(adapterUrl('/self'), {
      headers: { authorization: `Bearer ${otherToken}` }
    });
    const body = (await response.json()) as { channelId: string };
    // The second channel's credential can only ever describe — and therefore only
    // ever affect — the second channel. There is no channel id in any request
    // body or path, so naming another channel is not expressible.
    assert.notEqual(body.channelId, channelId);
  });

  it('never lets a channel credential reach a human route', async () => {
    const response = await fetch(`${baseUrl}/api/missions`, {
      headers: { authorization: `Bearer ${channelToken}` }
    });
    assert.equal(response.status, 401);
  });
});

describe('adapter route operations', () => {
  it('appends an event idempotently and heartbeats the lease', async () => {
    const post = async (pathname: string, body: unknown): Promise<Response> =>
      await fetch(adapterUrl(pathname), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${channelToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      });

    const first = await post('/events', {
      events: [{ eventId: 'route-1', kind: 'session.started', producerSequence: 1 }]
    });
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as { accepted: { duplicate: boolean; id: string }[] };
    assert.equal(firstBody.accepted[0].duplicate, false);

    // At-least-once delivery is the design, so a replay is a no-op that returns the
    // original row rather than a second card in the feed.
    const replay = await post('/events', {
      events: [{ eventId: 'route-1', kind: 'session.started', producerSequence: 1 }]
    });
    const replayBody = (await replay.json()) as { accepted: { duplicate: boolean; id: string }[] };
    assert.equal(replayBody.accepted[0].duplicate, true);
    assert.equal(replayBody.accepted[0].id, firstBody.accepted[0].id);

    const heartbeat = await post('/heartbeat', { state: 'online' });
    assert.equal(heartbeat.status, 200);
    const heartbeatBody = (await heartbeat.json()) as { leaseExpiresAt: string };
    assert.ok(new Date(heartbeatBody.leaseExpiresAt) > new Date());
  });

  it('refuses to operate on another channel’s request', async () => {
    const create = await fetch(adapterUrl('/requests'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${channelToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ kind: 'permission', summary: 'Run tests' })
    });
    const { requestId } = (await create.json()) as { requestId: string };

    // The other channel holds a valid credential for *itself*, which buys it
    // nothing here: the handler checks that the request belongs to the
    // authenticated channel before touching it.
    const stolen = await fetch(adapterUrl(`/requests/${requestId}/release`), {
      method: 'POST',
      headers: { authorization: `Bearer ${otherToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'timeout' })
    });
    assert.equal(stolen.status, 404);
  });
});

describe('adapter closed-vocabulary boundaries', () => {
  async function postAdapter({
    pathname,
    body,
    token = channelToken
  }: {
    pathname: string;
    body: unknown;
    token?: string;
  }): Promise<Response> {
    return fetch(adapterUrl(pathname), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  }

  async function createOpenRequest(kind: string): Promise<string> {
    const created = await postAdapter({
      pathname: '/requests',
      body: { kind, summary: 'Vocabulary check' }
    });
    assert.equal(created.status, 200);
    const body = (await created.json()) as { requestId: string };
    return body.requestId;
  }

  it('accepts the last AgentRequestKind and rejects the first invalid kind', async () => {
    const { AGENT_REQUEST_KINDS } = await import('../packages/core/service/agent-session/index.ts');
    const lastValid = AGENT_REQUEST_KINDS[AGENT_REQUEST_KINDS.length - 1];
    const valid = await postAdapter({
      pathname: '/requests',
      body: { kind: lastValid, summary: 'Last kind' }
    });
    assert.equal(valid.status, 200);

    const invalid = await postAdapter({
      pathname: '/requests',
      body: { kind: 'comment', summary: 'Not a kind' }
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), {
      error: 'Unknown request kind',
      code: 'invalid_request'
    });
  });

  it('accepts the last adapter release reason and falls back when channel_ended is sent', async () => {
    const { RELEASE_REASONS } = await import('../packages/core/service/agent-session/index.ts');
    const adapterReasons = RELEASE_REASONS.filter(reason => reason !== 'channel_ended');
    const lastValid = adapterReasons[adapterReasons.length - 1];

    const validId = await createOpenRequest('permission');
    const valid = await postAdapter({
      pathname: `/requests/${validId}/release`,
      body: { reason: lastValid }
    });
    assert.equal(valid.status, 200);
    const validRow = await client.get<{ released_reason: string | null }>(
      `SELECT released_reason FROM agent_requests WHERE id = ?`,
      [validId]
    );
    assert.equal(validRow?.released_reason, lastValid);

    const invalidId = await createOpenRequest('permission');
    const invalid = await postAdapter({
      pathname: `/requests/${invalidId}/release`,
      body: { reason: 'channel_ended' }
    });
    assert.equal(invalid.status, 200);
    const invalidRow = await client.get<{ released_reason: string | null }>(
      `SELECT released_reason FROM agent_requests WHERE id = ?`,
      [invalidId]
    );
    assert.equal(invalidRow?.released_reason, 'timeout');
  });

  it('accepts the last application state and falls back on the first invalid value', async () => {
    const { APPLICATION_STATES } = await import('../packages/core/service/agent-session/index.ts');
    const lastValid = APPLICATION_STATES[APPLICATION_STATES.length - 1];

    const validId = await createOpenRequest('choice');
    const valid = await postAdapter({
      pathname: `/requests/${validId}/application`,
      body: { applicationState: lastValid }
    });
    assert.equal(valid.status, 200);
    const validRow = await client.get<{ application_state: string }>(
      `SELECT application_state FROM agent_requests WHERE id = ?`,
      [validId]
    );
    assert.equal(validRow?.application_state, lastValid);

    const invalidId = await createOpenRequest('choice');
    const invalid = await postAdapter({
      pathname: `/requests/${invalidId}/application`,
      body: { applicationState: 'pending' }
    });
    assert.equal(invalid.status, 200);
    const invalidRow = await client.get<{ application_state: string }>(
      `SELECT application_state FROM agent_requests WHERE id = ?`,
      [invalidId]
    );
    assert.equal(invalidRow?.application_state, 'unknown');
  });

  it('accepts the last delivery outcome and stores null for the first invalid value', async () => {
    const { createServiceContext } = await import('../packages/core/service/context.ts');
    const { createSessionChannel } =
      await import('../packages/core/service/agent-session/channels.ts');
    const { enqueueSessionInput } =
      await import('../packages/core/service/agent-session/inputs.ts');
    const { DELIVERY_OUTCOMES } = await import('../packages/core/service/agent-session/index.ts');
    const { attachSession } = await import('../packages/core/service/protocol.ts');

    const ctx = await createServiceContext({ db: client, source: 'protocol' });
    const existing = await client.get<{ mission_id: string; project_id: string }>(
      `SELECT mission_id, project_id FROM agent_session_channels WHERE id = ?`,
      [channelId]
    );
    assert.ok(existing);

    const lastValid = DELIVERY_OUTCOMES[DELIVERY_OUTCOMES.length - 1];
    const cases = [
      { outcome: lastValid, expected: lastValid },
      { outcome: 'queued', expected: null }
    ];

    for (const testCase of cases) {
      const prepared = await createSessionChannel({
        ctx,
        missionId: existing.mission_id,
        projectId: existing.project_id,
        adapterKey: 'claude'
      });
      const attached = await attachSession({
        ctx,
        missionId: existing.mission_id,
        agentIdentifier: 'claude-code',
        sessionChannelId: prepared.channel.id
      });
      await enqueueSessionInput({
        ctx,
        channel: { ...prepared.channel, session_id: attached.session.id, state: 'online' },
        kind: 'instruction',
        body: `Delivery ${testCase.outcome}`
      });
      const claimed = await postAdapter({
        pathname: '/inputs/claim',
        body: {},
        token: prepared.bootstrap.token
      });
      assert.equal(claimed.status, 200);
      const claimedBody = (await claimed.json()) as {
        input: { id: string; leaseId: string } | null;
      };
      assert.ok(claimedBody.input);

      const emitted = await postAdapter({
        pathname: `/inputs/${claimedBody.input.id}/emitted`,
        body: {
          leaseId: claimedBody.input.leaseId,
          deliveryOutcome: testCase.outcome
        },
        token: prepared.bootstrap.token
      });
      assert.equal(emitted.status, 200);
      const row = await client.get<{ delivery_outcome: string | null }>(
        `SELECT delivery_outcome FROM agent_session_inputs WHERE id = ?`,
        [claimedBody.input.id]
      );
      assert.equal(row?.delivery_outcome, testCase.expected);
    }
  });
});
