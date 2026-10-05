import { createSqliteClient, openInMemoryDatabase } from '@overlord/database';
import express from 'express';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { once } from 'node:events';
import { it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { type ChatOwner, Conversations } from '../packages/core/service/chat/conversations.ts';
import { ChatRuns } from '../packages/core/service/chat/runs.ts';

import { createChatRouter } from './chat.ts';
import { type ChatRuntime, ChatRuntimeFailure, ChatWorker } from './chat-worker.ts';
import { apiErrorHandler } from './errors.ts';

async function setup() {
  const raw = openInMemoryDatabase(),
    db = createSqliteClient(raw),
    now = new Date().toISOString();
  await db.run(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ('owner', 'Owner', 'owner@test.invalid', 0, ?, ?)`,
    [now, now]
  );
  await db.run(
    "INSERT INTO organizations (id, name, created_at, updated_at) VALUES ('org', 'Org', ?, ?)",
    [now, now]
  );
  await db.run(
    "INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at) VALUES ('ws', 'org', 'ws', 'Ws', 'hosted', ?, ?)",
    [now, now]
  );
  await db.run(
    "INSERT INTO workspace_users (id, workspace_id, profile_id, member_key, status, created_at, updated_at) VALUES ('member', 'ws', 'owner', 'owner', 'active', ?, ?)",
    [now, now]
  );
  const owner = { profileId: 'owner', organizationId: 'org' },
    c = new Conversations(db),
    runs = new ChatRuns(db);
  return { db, c, runs, owner, close: () => raw.close() };
}
it('authenticated chat JSON/poll/SSE replay, live append, conflicts and Local guard', async () => {
  const f = await setup(),
    context = new AsyncLocalStorage<ChatOwner>(),
    app = express();
  let cloud = true;
  app.use(express.json());
  app.use((req, res, next) => {
    if (!req.headers.authorization) {
      res.sendStatus(401);
      return;
    }
    context.run(
      req.headers.authorization === 'Bearer owner' ? f.owner : { ...f.owner, profileId: 'other' },
      next
    );
  });
  app.use(
    '/api/chat',
    createChatRouter({
      cloud: () => cloud,
      service: () => f.c,
      owner: () => context.getStore() ?? null,
      streamPollMs: 10
    })
  );
  app.use(apiErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/chat`;
  const request = (path: string, method = 'GET', body?: unknown, auth = 'owner') =>
    fetch(url + path, {
      method,
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  const controller = new AbortController();
  try {
    assert.equal((await fetch(url + '/threads')).status, 401);
    const created = await request('/threads', 'POST', {
      message: { clientRequestId: 'initial', text: 'Feature' }
    });
    assert.equal(created.status, 200);
    const t = (await created.json()) as Awaited<ReturnType<Conversations['create']>>;
    const snap = await f.c.snapshot(f.owner, t.thread.id);
    assert.equal((await request(`/threads/${t.thread.id}`, 'GET', undefined, 'other')).status, 404);
    const conflict = await request(`/threads/${t.thread.id}/messages`, 'POST', {
      clientRequestId: 'other',
      text: 'Other'
    });
    assert.equal(conflict.status, 409);
    assert.equal(((await conflict.json()) as { code: string }).code, 'run_in_progress');
    assert.equal((await request(`/threads/${t.thread.id}/events?after=bad&poll=1`)).status, 400);
    const stream = await fetch(`${url}/threads/${t.thread.id}/events?after=${snap.eventCursor}`, {
      headers: { Authorization: 'Bearer owner' },
      signal: controller.signal
    });
    assert.equal(stream.headers.get('content-type')?.includes('text/event-stream'), true);
    const reader = stream.body!.getReader();
    const a = await f.runs.claim('fake', {
      provider: 'fake',
      model: 'fake',
      configDigest: 'fake',
      checkpointVersion: 1
    });
    assert.ok(a);
    await f.runs.text(a, 'Live answer');
    await f.runs.complete(a);
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    const text = new TextDecoder().decode(chunk.value);
    assert.ok(text.includes('"type":"event"'));
    assert.ok(text.includes('"seq":'));
    controller.abort();
    await reader.cancel().catch(() => {});
    const page = await request(`/threads/${t.thread.id}/events?after=${snap.eventCursor}&poll=1`);
    const replay = (await page.json()) as Awaited<ReturnType<Conversations['events']>>;
    assert.ok(replay.events.some(e => e.kind === 'message.created'));
    cloud = false;
    for (const path of [
      '/threads',
      `/threads/${t.thread.id}`,
      `/threads/${t.thread.id}/events?after=0`
    ]) {
      const local = await request(path);
      assert.equal(local.status, 404);
      assert.equal(((await local.json()) as { code: string }).code, 'chat_unavailable');
    }
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    f.close();
  }
});
it('fake runtime is scheduled durably and typed failures never expose provider errors', async () => {
  const f = await setup();
  const runtime: ChatRuntime = {
    identity: { provider: 'fake', model: 'fake', configDigest: 'fake', checkpointVersion: 1 },
    execute: async (a, runs) => {
      await runs.text(a, 'Fake answer');
      await runs.complete(a);
    }
  };
  const worker = new ChatWorker(() => f.runs, runtime);
  try {
    const t = await f.c.create(f.owner, { clientRequestId: 'fake', text: 'Hello' });
    await worker.tick();
    for (let i = 0; i < 100 && (await f.runs.run(t.run!.id)).state === 'running'; i++)
      await delay(5);
    assert.equal((await f.runs.run(t.run!.id)).state, 'completed');
    await worker.stop();
    const bad = await f.c.create(f.owner, { clientRequestId: 'bad', text: 'Unavailable' });
    const failing = new ChatWorker(() => f.runs, {
      ...runtime,
      execute: async () => {
        throw new ChatRuntimeFailure('rate_limited');
      }
    });
    await failing.tick();
    for (let i = 0; i < 100 && (await f.runs.run(bad.run!.id)).state === 'running'; i++)
      await delay(5);
    assert.equal((await f.runs.run(bad.run!.id)).failure_code, 'rate_limited');
    await failing.stop();
  } finally {
    await worker.stop();
    f.close();
  }
});
it('GET /api/chat/providers reports engine readiness and the caller connections, Cloud only', async () => {
  const f = await setup(),
    app = express();
  let cloud = true;
  const seen: ChatOwner[] = [];
  app.use(
    '/api/chat',
    createChatRouter({
      cloud: () => cloud,
      service: () => f.c,
      owner: () => f.owner,
      providers: async owner => {
        seen.push(owner);
        return {
          providers: [
            {
              provider: 'gemini',
              model: 'gemini-3.8-flash',
              state: 'not_configured',
              checkedAt: '2026-10-04T12:00:00.000Z'
            }
          ],
          connections: []
        };
      }
    })
  );
  app.use(apiErrorHandler);
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/chat`;
  try {
    const ok = await fetch(`${base}/providers`);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.providers[0].state, 'not_configured');
    assert.deepEqual(seen, [f.owner]);
    cloud = false;
    const local = await fetch(`${base}/providers`);
    assert.equal(local.status, 404);
    assert.equal((await local.json()).code, 'chat_unavailable');
  } finally {
    server.close();
    f.close();
  }
});

import {
  proposalFixture,
  proposalOwner
} from '../packages/core/service/chat/proposal-test-fixture.ts';
import { ChatProposals } from '../packages/core/service/chat/proposals.ts';
it('Create HTTP endpoint enforces caller, revision, Local guard, and receipt replay without launching', () =>
  proposalFixture('sqlite', async (db, c, projects) => {
    const t = await c.create(proposalOwner, { clientRequestId: 'draft', text: 'Prepare work' });
    const runs = new ChatRuns(db, c.options);
    const a = await runs.claim('worker', {
      provider: 'fake',
      model: 'fake',
      configDigest: 'fake',
      checkpointVersion: 1
    });
    assert.ok(a);
    const card = await new ChatProposals(db, c.options).prepare(a, 'operation', {
      missions: [
        {
          key: 'work',
          projectId: projects[0],
          title: 'Work',
          objectives: [
            {
              title: 'Build',
              objective: 'Build feature',
              resourceKey: 'primary',
              acceptanceCriteria: ['Works'],
              assignment: { agent: 'codex', model: 'test-model' }
            }
          ]
        }
      ]
    });
    const context = new AsyncLocalStorage<ChatOwner>();
    let cloud = true;
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      if (!req.headers.authorization) {
        res.sendStatus(401);
        return;
      }
      context.run(
        req.headers.authorization === 'Bearer owner'
          ? proposalOwner
          : { ...proposalOwner, profileId: 'stranger' },
        next
      );
    });
    app.use(
      '/api/chat',
      createChatRouter({
        cloud: () => cloud,
        service: () => c,
        owner: () => context.getStore() ?? null
      })
    );
    app.use(apiErrorHandler);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}/api/chat/proposals/${card.id}/create`;
    const request = (body: unknown, auth = 'owner') =>
      fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    try {
      assert.equal((await fetch(url, { method: 'POST' })).status, 401);
      assert.equal(
        (await request({ clientRequestId: 'create', expectedRevision: 1 }, 'stranger')).status,
        404
      );
      assert.equal((await request({ clientRequestId: 'create', expectedRevision: 2 })).status, 409);
      assert.equal((await request({ clientRequestId: 'create' })).status, 400);
      const first = await request({ clientRequestId: 'create', expectedRevision: 1 });
      assert.equal(first.status, 200);
      const saved = await first.json();
      const second = await request({ clientRequestId: 'create', expectedRevision: 1 });
      assert.equal(second.status, 200);
      const replay = await second.json();
      assert.deepEqual(saved.receipt, replay.receipt);
      assert.equal(replay.replayed, true);
      cloud = false;
      const local = await request({ clientRequestId: 'create', expectedRevision: 1 });
      assert.equal(local.status, 404);
      assert.equal((await local.json()).code, 'chat_unavailable');
      assert.equal(
        Number((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM execution_requests'))!.n),
        0
      );
      assert.equal((await c.snapshot(proposalOwner, t.thread.id)).openProposals.length, 0);
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
  }));

it('presence, acknowledgement and notification history routes are owner-scoped and Cloud only', async () => {
  const f = await setup(),
    context = new AsyncLocalStorage<ChatOwner>(),
    app = express();
  let cloud = true;
  app.use(express.json());
  app.use((req, _res, next) => {
    context.run(
      req.headers.authorization === 'Bearer owner' ? f.owner : { ...f.owner, profileId: 'other' },
      next
    );
  });
  app.use(
    '/api/chat',
    createChatRouter({
      cloud: () => cloud,
      service: () => f.c,
      owner: () => context.getStore() ?? null
    })
  );
  app.use(apiErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/chat`;
  const request = (path: string, method = 'GET', body?: unknown, auth = 'owner') =>
    fetch(url + path, {
      method,
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  try {
    const t = await f.c.create(f.owner, { clientRequestId: 'n', text: 'Notify me' });
    const a = await f.runs.claim('fake', {
      provider: 'fake',
      model: 'fake',
      configDigest: 'fake',
      checkpointVersion: 1
    });
    await f.runs.question(a!, 'Which one?');
    const seq = (await f.c.snapshot(f.owner, t.thread.id)).eventCursor;
    const presence = await request(`/threads/${t.thread.id}/presence`, 'PUT', {
      clientId: 'tab-1',
      platform: 'web',
      state: 'foreground'
    });
    assert.equal(presence.status, 200);
    assert.ok(((await presence.json()) as { expiresAt: string | null }).expiresAt);
    const ack = await request(`/threads/${t.thread.id}/ack`, 'POST', { clientId: 'tab-1', seq });
    assert.equal(ack.status, 200);
    const acked = (await ack.json()) as { ackedSeq: number; suppressedNotificationIds: string[] };
    assert.equal(acked.ackedSeq, seq);
    assert.equal(acked.suppressedNotificationIds.length, 1);
    assert.equal(
      (await request(`/threads/${t.thread.id}/ack`, 'POST', { clientId: 'tab-1', seq }, 'other'))
        .status,
      404
    );
    assert.equal(
      (await request(`/threads/${t.thread.id}/ack`, 'POST', { clientId: 'tab-1', seq: -1 })).status,
      400
    );
    const history = await request('/notifications');
    assert.deepEqual(await history.json(), { items: [], unreadCount: 0 });
    const missing = await request('/notifications/missing/read', 'POST', { expectedRevision: 1 });
    assert.equal(missing.status, 404);
    cloud = false;
    for (const [path, method] of [
      ['/notifications', 'GET'],
      [`/threads/${t.thread.id}/presence`, 'PUT'],
      [`/threads/${t.thread.id}/ack`, 'POST']
    ] as const) {
      const local = await request(
        path,
        method,
        method === 'GET' ? undefined : { clientId: 'x', seq: 0 }
      );
      assert.equal(local.status, 404);
      assert.equal(((await local.json()) as { code: string }).code, 'chat_unavailable');
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    f.close();
  }
});
