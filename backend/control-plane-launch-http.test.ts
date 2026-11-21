import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { listenForTest, type TestServer } from './http/test-app-fixture.ts';

/**
 * Codex app-server launch through the real app (ADR 0092): the launch-channel mint route, the
 * heartbeat lifecycle fields a control-plane supervisor stops on, and attach binding the minted
 * channel by objective. Under the API conformance report every response is also checked against
 * its OpenAPI operation (ADR 0051).
 */

process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-32-chars-min';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:4328';

const { createIntegrationTestDb } = await import('./test-helpers.ts');
const { tempDir } = await createIntegrationTestDb('overlord-control-plane-launch-http-');
const { createProject, createUserToken } = await import('./repository.ts');
const { app } = await import('./app.ts');
const dbModule = await import('./db.ts');

let server: TestServer;
let baseUrl = '';
let secret = '';

async function call(
  method: string,
  path: string,
  body?: unknown,
  token: string = secret
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

before(async () => {
  secret = (await createUserToken({ label: 'control-plane-launch-http' })).secret;
  server = await listenForTest(app);
  baseUrl = server.baseUrl;
});

after(async () => {
  await server.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('control-plane launch channel (ADR 0092)', () => {
  it('mints a credentialed channel the supervisor can heartbeat and attach binds', async () => {
    const project = await createProject({ name: `Codex app server ${Date.now()}` });
    const mission = await call('POST', '/api/missions', {
      projectId: project.id,
      objectives: [{ instructions: 'Run through the app server' }]
    });
    assert.equal(mission.status, 200, JSON.stringify(mission.body));
    const objective = mission.body.objectives[0];

    const refused = await call('POST', `/api/objectives/${objective.displayId}/session-channels`, {
      adapterKey: 'claude'
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, 'adapter_not_control_plane');

    const missing = await call(
      'POST',
      `/api/objectives/${objective.displayId}/session-channels`,
      {}
    );
    assert.equal(missing.status, 400);

    const minted = await call('POST', `/api/objectives/${objective.displayId}/session-channels`, {
      adapterKey: 'codex-app-server',
      adapterVersion: 'test'
    });
    assert.equal(minted.status, 200, JSON.stringify(minted.body));
    assert.equal(minted.body.launchKind, 'control_plane');
    assert.equal(minted.body.adapterKey, 'codex-app-server');
    assert.equal(minted.body.agentIdentifier, 'codex');
    assert.match(minted.body.token, /^osc_/);

    // The supervisor's first heartbeat: no session yet, objective still draft.
    const beat = await fetch(`${baseUrl}/api/agent-session-channels/v1/heartbeat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${minted.body.token}`
      },
      body: JSON.stringify({ nativeSessionId: 'thread-1' })
    });
    assert.equal(beat.status, 200);
    const beatBody = (await beat.json()) as Record<string, unknown>;
    assert.equal(beatBody.objectiveState, 'draft');
    assert.equal(beatBody.deliveryState, null);

    // A user token is not a channel credential, and a channel credential is not a user token.
    const crossed = await call(
      'POST',
      `/api/objectives/${objective.displayId}/session-channels`,
      { adapterKey: 'codex-app-server' },
      minted.body.token
    );
    assert.equal(crossed.status, 401);

    // Attach inside the thread carries no channel id; it binds the minted channel by objective,
    // and its `unknown` agent placeholder does not replace the channel's `codex`.
    const attach = await call('POST', '/api/protocol/attach', {
      flags: { '--mission-id': mission.body.displayId, '--objective-id': objective.displayId }
    });
    assert.equal(attach.status, 200, JSON.stringify(attach.body));
    const client = dbModule.requireDatabaseClient();
    const channel = await client.get<{
      session_id: string | null;
      state: string;
      agent_identifier: string | null;
      native_session_id: string | null;
    }>(
      `SELECT session_id, state, agent_identifier, native_session_id
         FROM agent_session_channels WHERE id = ?`,
      [minted.body.channelId]
    );
    assert.ok(channel?.session_id, 'attach bound the channel');
    assert.equal(channel?.state, 'online');
    assert.equal(channel?.agent_identifier, 'codex');
    assert.equal(channel?.native_session_id, 'thread-1');
  });

  it('refuses an objective that is complete', async () => {
    const project = await createProject({ name: `Codex complete ${Date.now()}` });
    const mission = await call('POST', '/api/missions', {
      projectId: project.id,
      objectives: [{ instructions: 'Already done' }]
    });
    const objective = mission.body.objectives[0];
    await dbModule
      .requireDatabaseClient()
      .run(`UPDATE objectives SET state = 'complete' WHERE id = ?`, [objective.id]);
    const minted = await call('POST', `/api/objectives/${objective.id}/session-channels`, {
      adapterKey: 'codex-app-server'
    });
    assert.equal(minted.status, 409);
    assert.equal(minted.body.code, 'objective_not_launchable');
  });
});
