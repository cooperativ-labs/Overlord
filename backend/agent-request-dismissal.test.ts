import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { listenForTest, routerTestApp, type TestServer } from './http/test-app-fixture.ts';

process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-32-chars-min';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:4319';

const { createIntegrationTestDb } = await import('./test-helpers.ts');
const harness = await createIntegrationTestDb('overlord-agent-request-dismissal-');
const dbModule = await import('./db.ts');
const client = dbModule.requireDatabaseClient();

const { createAgentRequestHumanRouter, setAgentRequestDismissal } =
  await import('./agent-session-routes.ts');
const { createSessionChannel } = await import('../packages/core/service/agent-session/channels.ts');
const {
  createRequest,
  getRequest,
  readRequestDismissals,
  releaseRequestToTerminal,
  resolveRequest,
  setRequestDismissal
} = await import('../packages/core/service/agent-session/requests.ts');
const { createProject } = await import('../packages/core/service/projects.ts');
const { protocolCreate } = await import('../packages/core/service/protocol.ts');
const { seedServiceOperator } = await import('../packages/core/service/test-helpers.ts');
const { createServiceContext } = await import('../packages/core/service/context.ts');

/**
 * Per-member dismissal of an agent request's notification (ADR 0063), over real HTTP with
 * response conformance against contract/api/openapi.yaml.
 */

type RequestBody = {
  id: string;
  status: string;
  revision: number;
  dismissed?: boolean;
  dismissedAt?: string | null;
  delivery: { mode: string; reason: string | null };
};

let server: TestServer;
let baseUrl = '';
let missionId = '';
let projectId = '';
let objectiveId = '';
const SECOND_MEMBER = 'dismissal-second-member';

before(async () => {
  server = await listenForTest(
    routerTestApp(
      app => {
        app.use('/api/agent-requests', createAgentRequestHumanRouter());
      },
      { json: false }
    )
  );
  baseUrl = server.baseUrl;
  await seedServiceOperator({ db: client });
  await dbModule.setActiveWorkspace('local-workspace');
  const ctx = await createServiceContext({ db: client, source: 'protocol' });
  const project = await createProject({ ctx, name: 'Dismissal', slug: 'dismissal' });
  const mission = await protocolCreate({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'Dismissal test' }]
  });
  missionId = mission.mission.id;
  objectiveId = mission.objectives[0]!.id;
  projectId = project.id;

  // A second active member of the same workspace.
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
});

after(async () => {
  await server.close();
  rmSync(harness.tempDir, { recursive: true, force: true });
});

async function operatorCtx() {
  return await dbModule.buildWebappServiceContextForWorkspace(
    'local-workspace',
    client,
    harness.operatorWorkspaceUserId
  );
}

async function openQuestion(summary = 'Which database?') {
  const ctx = await operatorCtx();
  const channel = await createSessionChannel({ ctx, missionId, objectiveId, projectId });
  return await createRequest({
    ctx,
    channel: channel.channel,
    kind: 'question',
    summary,
    allowsFreeText: true
  });
}

async function call(
  method: 'POST' | 'DELETE',
  id: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/agent-requests/${id}/dismissal`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function list(query: string): Promise<RequestBody[]> {
  const response = await fetch(`${baseUrl}/api/agent-requests?${query}`);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return (JSON.parse(text) as { requests: RequestBody[] }).requests;
}

async function dismissalChanges(requestId: string): Promise<number> {
  const row = await client.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM entity_changes
      WHERE entity_type = 'agent_request' AND entity_id = ? AND changed_fields_json LIKE '%dismissal%'`,
    [requestId]
  );
  return Number(row?.count ?? 0);
}

describe('agent request dismissal', () => {
  it('dismisses idempotently without changing the request, and every read returns it', async () => {
    const request = await openQuestion();
    const before = await getRequest({ ctx: await operatorCtx(), requestId: request.id });

    const first = await call('POST', request.id);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.changed, true);
    const dismissed = first.json.request as RequestBody;
    assert.equal(dismissed.dismissed, true);
    assert.equal(typeof dismissed.dismissedAt, 'string');
    assert.equal(dismissed.status, 'open');
    assert.equal(dismissed.revision, before.revision);

    const repeat = await call('POST', request.id);
    assert.equal(repeat.status, 200);
    assert.equal(repeat.json.changed, false);
    assert.equal((repeat.json.request as RequestBody).dismissedAt, dismissed.dismissedAt);
    assert.equal(await dismissalChanges(request.id), 1, 'one realtime change for one state change');

    // The request row itself is untouched: status, revision, lease and delivery state.
    const afterRow = await getRequest({ ctx: await operatorCtx(), requestId: request.id });
    assert.equal(afterRow.status, 'open');
    assert.equal(afterRow.revision, before.revision);
    assert.equal(afterRow.updated_at, before.updated_at);
    assert.equal(afterRow.application_state, before.application_state);

    // Still returned by the open-status paged read, the legacy read and the inbox read.
    const paged = await list(`missionId=${encodeURIComponent(missionId)}&status=open`);
    const pagedRow = paged.find(row => row.id === request.id);
    assert.ok(pagedRow, 'a dismissed open request is still returned by status=open');
    assert.equal(pagedRow.dismissed, true);
    assert.equal(pagedRow.delivery.mode, dismissed.delivery.mode);
    const legacy = await list(`missionId=${encodeURIComponent(missionId)}`);
    assert.equal(legacy.find(row => row.id === request.id)?.dismissed, true);
    const inbox = await list('');
    assert.equal(inbox.find(row => row.id === request.id)?.dismissed, true);
  });

  it('restores idempotently', async () => {
    const request = await openQuestion();
    assert.equal((await call('POST', request.id)).status, 200);
    const restored = await call('DELETE', request.id);
    assert.equal(restored.status, 200, JSON.stringify(restored.json));
    assert.equal(restored.json.changed, true);
    assert.equal((restored.json.request as RequestBody).dismissed, false);
    assert.equal((restored.json.request as RequestBody).dismissedAt, null);
    const again = await call('DELETE', request.id);
    assert.equal(again.status, 200);
    assert.equal(again.json.changed, false);
    const rows = await list(`missionId=${encodeURIComponent(missionId)}&status=open`);
    assert.equal(rows.find(row => row.id === request.id)?.dismissed, false);
    assert.equal(await dismissalChanges(request.id), 2);
  });

  it('is per workspace member', async () => {
    const request = await openQuestion();
    assert.equal((await call('POST', request.id)).status, 200);
    const second = await dbModule.buildWebappServiceContextForWorkspace(
      'local-workspace',
      client,
      SECOND_MEMBER
    );
    const forSecond = await readRequestDismissals({
      db: client,
      workspaceUserIds: [SECOND_MEMBER],
      requests: [request]
    });
    assert.equal(forSecond.has(request.id), false, 'another member still sees the card');

    const secondDismissal = await setRequestDismissal({
      ctx: second,
      requestId: request.id,
      dismissed: true
    });
    assert.equal(secondDismissal.changed, true);
    // Restoring for the second member leaves the operator's dismissal in place.
    await setRequestDismissal({ ctx: second, requestId: request.id, dismissed: false });
    const forOperator = await readRequestDismissals({
      db: client,
      workspaceUserIds: [harness.operatorWorkspaceUserId],
      requests: [request]
    });
    assert.equal(forOperator.has(request.id), true);
  });

  it('applies only to the dismissed revision, so a changed request appears again', async () => {
    const request = await openQuestion();
    assert.equal((await call('POST', request.id, { expectedRevision: 1 })).status, 200);
    // A material change to an open request bumps its revision.
    await client.run(`UPDATE agent_requests SET revision = revision + 1 WHERE id = ?`, [
      request.id
    ]);
    const rows = await list(`missionId=${encodeURIComponent(missionId)}&status=open`);
    assert.equal(rows.find(row => row.id === request.id)?.dismissed, false);
    const stale = await call('POST', request.id, { expectedRevision: 1 });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, 'agent_request_conflict');
    const fresh = await call('POST', request.id, { expectedRevision: 2 });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.json.changed, true);
    assert.equal((fresh.json.request as RequestBody).dismissed, true);
  });

  it('keeps a dismissed question answerable', async () => {
    const request = await openQuestion();
    assert.equal((await call('POST', request.id)).status, 200);
    const result = await resolveRequest({
      ctx: await operatorCtx(),
      requestId: request.id,
      resolution: { text: 'Postgres' },
      expectedRevision: request.revision
    });
    assert.equal(result.resolved, true);
    assert.equal(result.request.status, 'resolved');
    // A resolved request's revision moved on, so it no longer reads as dismissed.
    const rows = await list(`missionId=${encodeURIComponent(missionId)}`);
    assert.equal(rows.find(row => row.id === request.id)?.dismissed, false);
  });

  it('refuses to dismiss a closed request but allows restoring it', async () => {
    const request = await openQuestion();
    await releaseRequestToTerminal({
      ctx: await operatorCtx(),
      requestId: request.id,
      reason: 'local_activity'
    });
    const refused = await call('POST', request.id);
    assert.equal(refused.status, 409);
    assert.equal(refused.json.code, 'agent_request_not_open');
    const restored = await call('DELETE', request.id);
    assert.equal(restored.status, 200);
    assert.equal(restored.json.changed, false);
  });

  it('validates input and hides unknown requests', async () => {
    const request = await openQuestion();
    const invalid = await call('POST', request.id, { expectedRevision: 'one' });
    assert.equal(invalid.status, 400);
    const missing = await call('POST', crypto.randomUUID());
    assert.equal(missing.status, 404);
    const missingRestore = await call('DELETE', crypto.randomUUID());
    assert.equal(missingRestore.status, 404);
  });

  it('requires session:read in the request workspace', async () => {
    const request = await openQuestion();
    await dbModule.withRequestContextAsync(async () => {
      dbModule.setActiveTokenAuth({
        workspaceUserId: harness.operatorWorkspaceUserId,
        tokenId: 'no-session-read',
        scopeGrants: ['mission:read']
      });
      await assert.rejects(setAgentRequestDismissal(request.id, {}, true), { status: 403 });
    });
    await dbModule.withRequestContextAsync(async () => {
      dbModule.setActiveTokenAuth({
        workspaceUserId: harness.operatorWorkspaceUserId,
        tokenId: 'session-read',
        scopeGrants: ['mission:read', 'session:read']
      });
      const result = await setAgentRequestDismissal(request.id, {}, true);
      assert.equal(result.changed, true);
    });
  });
});
