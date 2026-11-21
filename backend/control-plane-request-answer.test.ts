import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { listenForTest, routerTestApp, type TestServer } from './http/test-app-fixture.ts';

process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-32-chars-min';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:4319';

const { createIntegrationTestDb } = await import('./test-helpers.ts');
const harness = await createIntegrationTestDb('overlord-control-plane-request-answer-');
const dbModule = await import('./db.ts');
const client = dbModule.requireDatabaseClient();

const { createAgentRequestHumanRouter } = await import('./agent-session-routes.ts');
const { createSessionChannel, endChannel } =
  await import('../packages/core/service/agent-session/channels.ts');
const { mintControlPlaneLaunchChannel } =
  await import('../packages/core/service/agent-session/launch-channels.ts');
const { acquireWaiterLease, createRequest, recordRequestApplication } =
  await import('../packages/core/service/agent-session/requests.ts');
const { createProject } = await import('../packages/core/service/projects.ts');
const { protocolCreate } = await import('../packages/core/service/protocol.ts');
const { seedServiceOperator } = await import('../packages/core/service/test-helpers.ts');
const { createServiceContext } = await import('../packages/core/service/context.ts');

/**
 * Answering control-plane requests from Overlord (ADR 0094), over real HTTP with response
 * conformance against contract/api/openapi.yaml: a Codex app-server approval is answerable by
 * the member who launched the session and nobody else, only with its own options, and the
 * answer is applied by the supervisor (never sent through Latch, never redelivered).
 */

type Delivery = { mode: string; reason: string | null; stage?: string | null };
type RequestBody = {
  id: string;
  kind: string;
  status: string;
  revision: number;
  delivery: Delivery;
};

const SECOND_MEMBER = 'control-plane-second-member';
const PERMISSION_OPTIONS = [
  { optionId: 'allow', label: 'Allow once', kind: 'allow' },
  { optionId: 'deny', label: 'Deny', kind: 'deny' }
];

let server: TestServer;
let baseUrl = '';
let missionId = '';
let projectId = '';

before(async () => {
  server = await listenForTest(
    routerTestApp(app => {
      app.use('/api/agent-requests', createAgentRequestHumanRouter());
    })
  );
  baseUrl = server.baseUrl;
  await seedServiceOperator({ db: client });
  await dbModule.setActiveWorkspace('local-workspace');
  const ctx = await createServiceContext({ db: client, source: 'protocol' });
  const project = await createProject({ ctx, name: 'Control plane', slug: 'control-plane' });
  projectId = project.id;
  const mission = await protocolCreate({
    ctx,
    projectId: project.id,
    objectives: [
      { instructions: 'Owned by the operator' },
      { instructions: 'Owned by another member' },
      { instructions: 'Hooks session' }
    ]
  });
  missionId = mission.mission.id;

  const now = new Date().toISOString();
  await client.run(
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 1, NULL, ?, ?)`,
    [SECOND_MEMBER, SECOND_MEMBER, `${SECOND_MEMBER}@overlord.local`, now, now]
  );
  await client.run(
    `INSERT INTO workspace_users
       (id, workspace_id, profile_id, member_key, status, metadata_json, created_at, updated_at, revision)
     VALUES (?, 'local-workspace', ?, ?, 'active', '{}', ?, ?, 1)`,
    [SECOND_MEMBER, SECOND_MEMBER, `auth:${SECOND_MEMBER}`, now, now]
  );
  objectiveIds = mission.objectives.map(objective => objective.id);
});

let objectiveIds: string[] = [];

after(async () => {
  await server.close();
  rmSync(harness.tempDir, { recursive: true, force: true });
});

async function memberCtx(workspaceUserId: string) {
  return await dbModule.buildWebappServiceContextForWorkspace(
    'local-workspace',
    client,
    workspaceUserId
  );
}

/** A control-plane channel minted by `owner`, as `ovld launch` would (ADR 0092). */
async function controlPlaneChannel(objectiveId: string, owner: string) {
  const ctx = await memberCtx(owner);
  const minted = await mintControlPlaneLaunchChannel({
    ctx,
    objectiveId,
    adapterKey: 'codex-app-server'
  });
  // The supervisor's first heartbeat brings the channel online.
  await client.run(`UPDATE agent_session_channels SET state = 'online' WHERE id = ?`, [
    minted.channelId
  ]);
  const channel = await client.get<Record<string, unknown>>(
    `SELECT * FROM agent_session_channels WHERE id = ?`,
    [minted.channelId]
  );
  return { ctx, channel: channel as never, channelId: minted.channelId };
}

async function approval(objectiveId: string, owner: string, summary = 'Run `ls -la`') {
  const { ctx, channel, channelId } = await controlPlaneChannel(objectiveId, owner);
  const request = await createRequest({
    ctx,
    channel,
    kind: 'permission',
    summary,
    options: PERMISSION_OPTIONS,
    allowsFreeText: false
  });
  return { ctx, request, channelId };
}

async function list(): Promise<RequestBody[]> {
  const response = await fetch(`${baseUrl}/api/agent-requests?missionId=${missionId}`);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return (JSON.parse(text) as { requests: RequestBody[] }).requests;
}

async function find(id: string): Promise<RequestBody> {
  const found = (await list()).find(request => request.id === id);
  assert.ok(found, `request ${id} listed`);
  return found;
}

async function resolve(
  id: string,
  body: unknown
): Promise<{ status: number; json: Record<string, any> }> {
  const response = await fetch(`${baseUrl}/api/agent-requests/${id}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, json: (await response.json()) as Record<string, any> };
}

describe('answering control-plane requests (ADR 0094)', () => {
  it('lets the launching member allow an approval, which the supervisor then applies', async () => {
    const { ctx, request } = await approval(objectiveIds[0]!, harness.operatorWorkspaceUserId);
    const listed = await find(request.id);
    assert.equal(listed.kind, 'permission');
    assert.equal(listed.delivery.mode, 'control_plane');
    assert.equal(listed.delivery.reason, null);

    // Only the card's own options; never text, never extra fields such as a standing grant.
    for (const resolution of [
      { text: 'yes' },
      { decision: 'ask' },
      { decision: 'allow', optionId: 'allow' },
      { optionId: 'acceptForSession' },
      { optionId: 'allow', persistent: true },
      {}
    ]) {
      const refused = await resolve(request.id, { resolution, expectedRevision: request.revision });
      assert.equal(refused.status, 400, JSON.stringify(refused.json));
      assert.equal(refused.json.code, 'invalid_resolution');
    }

    const answered = await resolve(request.id, {
      resolution: { optionId: 'allow' },
      expectedRevision: request.revision
    });
    assert.equal(answered.status, 200, JSON.stringify(answered.json));
    assert.equal(answered.json.resolved, true);
    assert.equal(answered.json.request.status, 'resolved');
    assert.equal(answered.json.request.delivery.mode, 'read_only');
    assert.equal(answered.json.request.delivery.stage, 'recorded');

    // The supervisor's waiter lease poll reads the answer back.
    await assert.rejects(
      acquireWaiterLease({ ctx, requestId: request.id }),
      (error: { code?: string }) => error.code === 'waiter_lease_unavailable'
    );
    const row = await client.get<{
      resolution_json: string;
      resolved_by_workspace_user_id: string;
    }>(`SELECT resolution_json, resolved_by_workspace_user_id FROM agent_requests WHERE id = ?`, [
      request.id
    ]);
    assert.deepEqual(JSON.parse(row!.resolution_json), { optionId: 'allow' });
    assert.equal(row!.resolved_by_workspace_user_id, harness.operatorWorkspaceUserId);

    // The supervisor wrote the answer to Codex and reports it.
    await recordRequestApplication({ ctx, requestId: request.id, applicationState: 'emitted' });
    assert.equal((await find(request.id)).delivery.stage, 'confirmed');

    // Nothing to send again: the supervisor applied it.
    const redeliver = await fetch(`${baseUrl}/api/agent-requests/${request.id}/redeliver`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedAttempt: 1 })
    });
    assert.equal(redeliver.status, 409);
    assert.equal(((await redeliver.json()) as { code: string }).code, 'request_not_deliverable');
  });

  it('accepts the CLI form `{ decision }` and stores it as the option', async () => {
    const { request } = await approval(
      objectiveIds[0]!,
      harness.operatorWorkspaceUserId,
      'Run `git status`'
    );
    const answered = await resolve(request.id, {
      resolution: { decision: 'deny' },
      expectedRevision: request.revision
    });
    assert.equal(answered.status, 200, JSON.stringify(answered.json));
    const row = await client.get<{ resolution_json: string }>(
      `SELECT resolution_json FROM agent_requests WHERE id = ?`,
      [request.id]
    );
    assert.deepEqual(JSON.parse(row!.resolution_json), { optionId: 'deny' });
  });

  it('refuses an approval to a member who did not launch the session', async () => {
    const { request } = await approval(objectiveIds[1]!, SECOND_MEMBER, 'Run `rm -rf build`');
    const listed = await find(request.id);
    assert.equal(listed.delivery.mode, 'read_only');
    assert.equal(listed.delivery.reason, 'not_session_owner');

    const refused = await resolve(request.id, {
      resolution: { optionId: 'allow' },
      expectedRevision: request.revision
    });
    assert.equal(refused.status, 403, JSON.stringify(refused.json));
    assert.equal(refused.json.code, 'not_session_owner');
    const row = await client.get<{ status: string }>(
      `SELECT status FROM agent_requests WHERE id = ?`,
      [request.id]
    );
    assert.equal(row!.status, 'open');
  });

  it('keeps a question on another member’s control-plane session answerable by the workspace', async () => {
    const { ctx, channel } = await controlPlaneChannel(objectiveIds[1]!, SECOND_MEMBER);
    const question = await createRequest({
      ctx,
      channel,
      kind: 'question',
      summary: 'Which database?',
      allowsFreeText: true
    });
    assert.equal((await find(question.id)).delivery.mode, 'control_plane');
    const answered = await resolve(question.id, {
      resolution: { text: 'Postgres' },
      expectedRevision: question.revision
    });
    assert.equal(answered.status, 200, JSON.stringify(answered.json));
    assert.equal(answered.json.resolved, true);
    assert.equal(answered.json.request.delivery.stage, 'recorded');
  });

  it('refuses an answer once the session channel has ended', async () => {
    const { ctx, request, channelId } = await approval(
      objectiveIds[0]!,
      harness.operatorWorkspaceUserId,
      'Run `make`'
    );
    await endChannel({ ctx, channelId, reason: 'session_ended' });
    const listed = await find(request.id);
    if (listed.status === 'open') {
      assert.equal(listed.delivery.mode, 'read_only');
      assert.equal(listed.delivery.reason, 'channel_ended');
      const refused = await resolve(request.id, {
        resolution: { optionId: 'deny' },
        expectedRevision: listed.revision
      });
      assert.equal(refused.status, 409, JSON.stringify(refused.json));
      assert.equal(refused.json.code, 'request_not_deliverable');
    } else {
      // Ending a channel may close its open cards itself; either way nothing is answerable.
      assert.equal(listed.delivery.mode, 'read_only');
    }
  });

  it('still refuses an approval from a session that is not a control-plane channel', async () => {
    const ctx = await memberCtx(harness.operatorWorkspaceUserId);
    const channel = await createSessionChannel({
      ctx,
      missionId,
      objectiveId: objectiveIds[2]!,
      projectId
    });
    const request = await createRequest({
      ctx,
      channel: channel.channel,
      kind: 'permission',
      summary: 'Run `ls`',
      options: PERMISSION_OPTIONS,
      allowsFreeText: false
    });
    assert.notEqual((await find(request.id)).delivery.mode, 'control_plane');
    const refused = await resolve(request.id, {
      resolution: { optionId: 'allow' },
      expectedRevision: request.revision
    });
    assert.equal(refused.status, 410);
    assert.equal(refused.json.code, 'session_controls_gone');
  });
});
