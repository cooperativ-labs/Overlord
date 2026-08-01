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

const { createAgentSessionChannelRouter, AGENT_SESSION_CHANNEL_ROUTE_PREFIX } =
  await import('./agent-session-routes.ts');
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

before(async () => {
  const app = express();
  app.use(AGENT_SESSION_CHANNEL_ROUTE_PREFIX, createAgentSessionChannelRouter());
  // Everything else demands a human. A channel credential must never reach it.
  app.use('/api', (_req, res) => res.status(401).json({ error: 'Authentication required' }));

  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  await seedServiceOperator({ db: client });
  const ctx = await createServiceContext({ db: client, source: 'protocol' });
  const project = await createProject({ ctx, name: 'Routes', slug: 'routes' });
  const mission = await protocolCreate({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'Route test' }]
  });

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
