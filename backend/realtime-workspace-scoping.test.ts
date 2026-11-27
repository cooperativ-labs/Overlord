import type { Response } from 'express';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { after, before, describe, it } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { setupSecondaryWorkspaceFixture } from './secondary-workspace-fixture.ts';

function fakeSseResponse(backpressure: (chunk: string) => boolean = () => false) {
  const chunks: string[] = [];
  const sink = { response: null as unknown as Response, chunks, ended: false, destroyed: false };
  const response = Object.assign(new EventEmitter(), {
    writableNeedDrain: false,
    writeHead: () => response,
    write: (chunk: string) => {
      chunks.push(chunk);
      response.writableNeedDrain ||= backpressure(chunk);
      return !response.writableNeedDrain;
    },
    end: () => {
      sink.ended = true;
      response.emit('close');
      return response;
    },
    destroy: () => {
      sink.destroyed = true;
      response.emit('close');
      return response;
    }
  });
  sink.response = response as unknown as Response;
  return Object.assign(sink, {
    drain() {
      response.writableNeedDrain = false;
      response.emit('drain');
    },
    listeners: (name: string) => response.listenerCount(name)
  });
}

function changeEvents(chunks: string[]): Array<{
  id: number;
  data: { cursor: number; changes: Array<{ seq: number; workspaceId: string; entityId: string }> };
}> {
  return chunks
    .join('')
    .split('\n\n')
    .filter(block => block.startsWith('event: change\n'))
    .map(block => {
      const lines = block.split('\n');
      const id = Number(lines.find(line => line.startsWith('id: '))?.slice(4));
      const data = JSON.parse(lines.find(line => line.startsWith('data: '))!.slice(6));
      return { id, data };
    });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for SSE change event');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

const fixture = await setupSecondaryWorkspaceFixture({ namePrefix: 'Realtime Isolation' });
const dbModule = await import('./db.ts');
const { ExpiredChangeCursor, RealtimeHub, readableChangeFeedWorkspaceIds, readChangesAfter } =
  await import('./realtime.ts');
const { seedAuthenticatedOperatorClient, DEFAULT_TEST_ORGANIZATION_ID } =
  await import('./test-helpers.ts');

const client = dbModule.requireDatabaseClient();
const viewerProfileId = 'realtime-workspace-a-viewer';
const viewerWorkspaceUserId = 'realtime-workspace-a-viewer-membership';
const viewerSecondaryWorkspaceUserId = 'realtime-workspace-b-viewer-membership';
let workspaceA: { id: string; slug: string; name: string; kind: string };

async function runAsWorkspaceAViewer<T>(fn: () => Promise<T>): Promise<T> {
  return dbModule.withRequestContextAsync(async () => {
    dbModule.setAuthorizedWorkspacesContext({
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      workspaces: [
        {
          workspaceId: fixture.workspaceAId,
          workspaceUserId: viewerWorkspaceUserId,
          roleKeys: ['MEMBER'],
          workspace: workspaceA
        }
      ]
    });
    return fn();
  });
}

async function appendChange(workspaceId: string, entityId: string, entityType = 'test_realtime') {
  await dbModule.recordChange({
    workspaceId,
    entityType,
    entityId,
    operation: 'update',
    actorWorkspaceUserId: null,
    changedFields: ['updated_at']
  });
  const row = await client.get<{ seq: number }>(
    `SELECT seq FROM entity_changes WHERE entity_type = ? AND entity_id = ? ORDER BY seq DESC LIMIT 1`,
    [entityType, entityId]
  );
  assert.ok(row);
  return row.seq;
}

before(async () => {
  const row = await client.get<{ id: string; slug: string; name: string; kind: string }>(
    `SELECT id, slug, name, kind FROM workspaces WHERE id = ?`,
    [fixture.workspaceAId]
  );
  assert.ok(row);
  workspaceA = row;
  await seedAuthenticatedOperatorClient({
    client,
    organizationId: DEFAULT_TEST_ORGANIZATION_ID,
    workspaceId: fixture.workspaceAId,
    profileId: viewerProfileId,
    workspaceUserId: viewerWorkspaceUserId
  });
  // The profile is also a live, readable member of B. The request snapshot
  // deliberately contains only A, mirroring a token that consented to A only;
  // realtime must not rebuild memberships and widen past that snapshot.
  await seedAuthenticatedOperatorClient({
    client,
    organizationId: DEFAULT_TEST_ORGANIZATION_ID,
    workspaceId: fixture.secondary.id,
    profileId: viewerProfileId,
    workspaceUserId: viewerSecondaryWorkspaceUserId
  });
});

describe('realtime workspace isolation', () => {
  it('requires a snapshot for an expired cursor on catch-up and SSE', async () => {
    const seq = await appendChange(fixture.workspaceAId, 'retention-boundary');
    await client.run(`UPDATE entity_change_retention SET retained_through = ? WHERE id = 1`, [seq]);
    const hub = new RealtimeHub();
    const sink = fakeSseResponse();
    try {
      await assert.rejects(
        () => readChangesAfter(0, [fixture.workspaceAId]),
        error => error instanceof ExpiredChangeCursor && error.cursor >= seq
      );
      hub.addClient(sink.response, {
        afterSeq: 0,
        signalReplayCompletion: true,
        workspaceIds: [fixture.workspaceAId]
      });
      await waitFor(() => sink.ended);
      assert.match(sink.chunks.join(''), /event: snapshot_required/);
      assert.doesNotMatch(sink.chunks.join(''), /event: hello/);
      const snapshotFrame = sink.chunks
        .join('')
        .split('\n\n')
        .find(frame => frame.startsWith('event: snapshot_required'));
      assert.ok(snapshotFrame);
      assert.doesNotMatch(
        snapshotFrame,
        /\nid:/,
        'recovery must not acknowledge an unrefreshed cursor'
      );
      const batch = await readChangesAfter(seq, [fixture.workspaceAId]);
      assert.ok(batch.cursor >= seq);
    } finally {
      hub.removeClient(sink.response);
      await client.run(`UPDATE entity_change_retention SET retained_through = 0 WHERE id = 1`);
    }
  });

  it('forces snapshot recovery if pruning overtakes a live hub', async () => {
    const hub = new RealtimeHub();
    await hub.pollNow();
    const sink = fakeSseResponse();
    hub.addClient(sink.response, { workspaceIds: [fixture.workspaceAId] });
    try {
      const seq = await appendChange(fixture.workspaceAId, 'hub-overtaken');
      await client.run(`UPDATE entity_change_retention SET retained_through = ? WHERE id = 1`, [
        seq
      ]);
      await hub.pollNow();
      assert.equal(sink.ended, true);
      assert.match(sink.chunks.join(''), /event: snapshot_required/);
    } finally {
      hub.removeClient(sink.response);
      await client.run(`UPDATE entity_change_retention SET retained_through = 0 WHERE id = 1`);
    }
  });
  it('GET /sync/changes semantics expose only readable workspaces and converge across global gaps', async () => {
    const beforeSeq = await dbModule.currentMaxSeq(client);
    await appendChange(fixture.secondary.id, 'pull-hidden-before');
    const firstVisibleSeq = await appendChange(fixture.workspaceAId, 'pull-visible-1');
    await appendChange(fixture.secondary.id, 'pull-hidden-middle');
    await appendChange(fixture.workspaceAId, 'pull-visible-2');
    const trailingHiddenSeq = await appendChange(fixture.secondary.id, 'pull-hidden-after');

    const workspaceIds = await runAsWorkspaceAViewer(readableChangeFeedWorkspaceIds);
    assert.deepEqual(workspaceIds, [fixture.workspaceAId]);
    const deniedWorkspaceIds = await dbModule.withRequestContextAsync(async () => {
      dbModule.setAuthorizedWorkspacesContext({
        organizationId: DEFAULT_TEST_ORGANIZATION_ID,
        workspaces: [
          {
            workspaceId: fixture.workspaceAId,
            workspaceUserId: viewerWorkspaceUserId,
            roleKeys: [],
            workspace: workspaceA
          }
        ]
      });
      return readableChangeFeedWorkspaceIds();
    });
    assert.deepEqual(deniedWorkspaceIds, [], 'PROJECT_READ remains enforced per workspace');

    const first = await readChangesAfter(beforeSeq, workspaceIds, 1);
    assert.deepEqual(
      first.changes.map(change => change.entityId),
      ['pull-visible-1']
    );
    assert.equal(first.changes[0]!.workspaceId, fixture.workspaceAId);
    assert.equal(first.cursor, firstVisibleSeq);
    assert.equal(first.hasMore, true);

    const second = await readChangesAfter(first.cursor, workspaceIds, 1);
    assert.deepEqual(
      second.changes.map(change => change.entityId),
      ['pull-visible-2']
    );
    assert.equal(second.cursor, trailingHiddenSeq);
    assert.equal(second.hasMore, false);

    const exhausted = await readChangesAfter(second.cursor, workspaceIds, 1);
    assert.deepEqual(exhausted, { changes: [], cursor: trailingHiddenSeq, hasMore: false });

    // Mirror an enumerable GET /sync/changes attack beginning at ?after=0:
    // every page remains workspace A-only and the cursor eventually reaches
    // the global high-water mark even though workspace B occupies sequence gaps.
    let cursor = 0;
    let hasMore = true;
    const walkedEntityIds: string[] = [];
    for (let page = 0; hasMore && page < 1_000; page += 1) {
      const batch = await readChangesAfter(cursor, workspaceIds, 3);
      assert.ok(batch.cursor > cursor || !batch.hasMore, 'a paginated cursor must make progress');
      assert.ok(batch.changes.every(change => change.workspaceId === fixture.workspaceAId));
      walkedEntityIds.push(...batch.changes.map(change => change.entityId));
      cursor = batch.cursor;
      hasMore = batch.hasMore;
    }
    assert.equal(hasMore, false, 'the filtered feed must converge');
    assert.equal(cursor, trailingHiddenSeq);
    assert.ok(walkedEntityIds.includes('pull-visible-1'));
    assert.ok(walkedEntityIds.includes('pull-visible-2'));
    assert.ok(!walkedEntityIds.some(entityId => entityId.startsWith('pull-hidden')));
  });

  it('SSE catch-up after an old cursor omits changes from another workspace', async () => {
    const hub = new RealtimeHub();
    await hub.pollNow();
    const beforeSeq = await dbModule.currentMaxSeq(client);
    await appendChange(fixture.secondary.id, 'catch-up-hidden');
    await appendChange(fixture.workspaceAId, 'catch-up-visible');
    const trailingHiddenSeq = await appendChange(fixture.secondary.id, 'catch-up-hidden-after');
    await hub.pollNow();

    const sink = fakeSseResponse();
    hub.addClient(sink.response, {
      afterSeq: beforeSeq,
      workspaceIds: [fixture.workspaceAId]
    });
    try {
      await waitFor(() => changeEvents(sink.chunks).length > 0);
      const events = changeEvents(sink.chunks);
      assert.deepEqual(
        events.flatMap(event => event.data.changes.map(change => change.entityId)),
        ['catch-up-visible']
      );
      assert.equal(events.at(-1)!.data.cursor, trailingHiddenSeq);
      assert.equal(events.at(-1)!.id, trailingHiddenSeq);
    } finally {
      hub.removeClient(sink.response);
    }
  });

  it('signals completion for empty replay and advances past invisible changes', async () => {
    const hub = new RealtimeHub();
    await hub.pollNow();
    const beforeSeq = await dbModule.currentMaxSeq(client);
    const invisibleSeq = await appendChange(fixture.secondary.id, 'empty-replay-hidden');
    const sink = fakeSseResponse();
    hub.addClient(sink.response, {
      afterSeq: beforeSeq,
      signalReplayCompletion: true,
      workspaceIds: [fixture.workspaceAId]
    });
    try {
      await waitFor(() => sink.chunks.join('').includes('event: hello'));
      assert.deepEqual(changeEvents(sink.chunks), []);
      assert.ok(
        sink.chunks.join('').includes(
          JSON.stringify({
            type: 'hello',
            cursor: invisibleSeq,
            replayComplete: true
          })
        )
      );
    } finally {
      hub.removeClient(sink.response);
    }
  });

  it('signals completion after sending every replay page and queued live changes in order', async () => {
    const hub = new RealtimeHub();
    await hub.pollNow();
    const beforeSeq = await dbModule.currentMaxSeq(client);
    const backlog = Array.from({ length: 501 }, (_, index) => `ordered-backlog-${index}`);
    for (const entityId of backlog) await appendChange(fixture.workspaceAId, entityId);
    await hub.pollNow();
    let unblock!: () => void;
    let paused = false;
    const gate = new Promise<void>(resolve => {
      unblock = resolve;
    });
    let armed = false;
    const delayed = new Proxy(client, {
      get(target, key) {
        if (key === 'transaction')
          return async (fn: Parameters<typeof client.transaction>[0]) => {
            const result = await target.transaction(fn);
            if (armed && changeEvents(sink.chunks).length === 1) {
              armed = false;
              paused = true;
              await gate;
            }
            return result;
          };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    await dbModule.bindDatabaseClient(delayed);
    const sink = fakeSseResponse();
    try {
      armed = true;
      hub.addClient(sink.response, {
        afterSeq: beforeSeq,
        signalReplayCompletion: true,
        workspaceIds: [fixture.workspaceAId]
      });
      await waitFor(() => paused);
      const liveSeq = await appendChange(fixture.workspaceAId, 'ordered-live');
      await hub.pollNow();
      assert.deepEqual(
        changeEvents(sink.chunks).map(event => event.data.changes.length),
        [500]
      );
      assert.doesNotMatch(sink.chunks.join(''), /event: hello/);
      unblock();
      await waitFor(() => sink.chunks.join('').includes('event: hello'));
      assert.deepEqual(
        changeEvents(sink.chunks).map(event => event.data.changes.length),
        [500, 1, 1]
      );
      assert.deepEqual(
        changeEvents(sink.chunks).flatMap(event =>
          event.data.changes.map(change => change.entityId)
        ),
        [...backlog, 'ordered-live']
      );
      const frames = sink.chunks.join('').trimEnd().split('\n\n');
      assert.equal(
        frames.at(-1),
        `event: hello\ndata: ${JSON.stringify({
          type: 'hello',
          cursor: liveSeq,
          replayComplete: true
        })}`
      );
    } finally {
      unblock();
      hub.removeClient(sink.response);
      await dbModule.bindDatabaseClient(client);
    }
  });

  it('SSE live broadcast filters per client and reconnects before authorization changes fan out', async () => {
    const hub = new RealtimeHub();
    await hub.pollNow();
    const sink = fakeSseResponse();
    hub.addClient(sink.response, {
      workspaceIds: [fixture.workspaceAId]
    });
    try {
      await appendChange(fixture.secondary.id, 'live-hidden');
      await appendChange(fixture.workspaceAId, 'live-visible');
      const trailingHiddenSeq = await appendChange(fixture.secondary.id, 'live-hidden-after');
      await hub.pollNow();

      let events = changeEvents(sink.chunks);
      assert.deepEqual(
        events.flatMap(event => event.data.changes.map(change => change.entityId)),
        ['live-visible']
      );
      assert.equal(events.at(-1)!.data.cursor, trailingHiddenSeq);

      await appendChange(fixture.workspaceAId, 'membership-revoked', 'workspace_user');
      await appendChange(fixture.workspaceAId, 'live-after-revocation');
      await hub.pollNow();

      assert.equal(sink.ended, true, 'authorization changes must force reauthentication');
      events = changeEvents(sink.chunks);
      assert.deepEqual(
        events.flatMap(event => event.data.changes.map(change => change.entityId)),
        ['live-visible']
      );
    } finally {
      hub.removeClient(sink.response);
    }
  });

  const replayOptions = (afterSeq: number) => ({
    afterSeq,
    signalReplayCompletion: true,
    workspaceIds: [fixture.workspaceAId]
  });
  const backpressureOnChange = (chunk: string) => chunk.startsWith('event: change\n');

  it('waits before reading another page and preserves order through a backpressured handoff', async () => {
    const hub = new RealtimeHub();
    const afterSeq = await dbModule.currentMaxSeq(client);
    const backlog = Array.from({ length: 501 }, (_, index) => `drain-backlog-${index}`);
    for (const entityId of backlog) await appendChange(fixture.workspaceAId, entityId);
    await hub.pollNow();
    const slow = fakeSseResponse(backpressureOnChange);
    const fast = fakeSseResponse();
    let reads = 0;
    const counted = new Proxy(client, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        if (key === 'transaction')
          return (fn: Parameters<typeof client.transaction>[0]) => {
            reads += 1;
            return target.transaction(fn);
          };
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    await dbModule.bindDatabaseClient(counted);
    try {
      hub.addClient(slow.response, replayOptions(afterSeq));
      await waitFor(() => slow.listeners('drain') === 1);
      assert.equal(reads, 1);
      assert.equal(changeEvents(slow.chunks)[0]!.data.changes.length, 500);
      hub.addClient(fast.response, replayOptions(afterSeq));
      await waitFor(() => fast.chunks.join('').includes('replayComplete'));
      assert.equal(reads, 3, 'the healthy client reads both pages while the other remains paused');
      assert.equal(changeEvents(slow.chunks).length, 1);
      slow.drain();
      await waitFor(() => changeEvents(slow.chunks).length === 2);
      assert.equal(reads, 4);
      const liveSeq = await appendChange(fixture.workspaceAId, 'drain-live');
      await hub.pollNow();
      assert.ok(fast.chunks.join('').includes('drain-live'));
      assert.doesNotMatch(slow.chunks.join(''), /drain-live|replayComplete/);
      for (let i = 0; i < 3; i++) hub.refreshAll();
      assert.doesNotMatch(slow.chunks.join(''), /event: refresh/);
      slow.drain();
      await waitFor(() => changeEvents(slow.chunks).length === 3);
      assert.doesNotMatch(slow.chunks.join(''), /replayComplete/);
      slow.drain();
      await waitFor(() => slow.chunks.join('').includes('replayComplete'));
      assert.deepEqual(
        changeEvents(slow.chunks).flatMap(event =>
          event.data.changes.map(change => change.entityId)
        ),
        [...backlog, 'drain-live']
      );
      assert.match(
        slow.chunks.find(chunk => chunk.startsWith('event: hello'))!,
        new RegExp(`"cursor":${liveSeq},"replayComplete":true`)
      );
      assert.equal(slow.chunks.filter(chunk => chunk.startsWith('event: refresh')).length, 1);
      assert.equal(slow.listeners('drain'), 0);
    } finally {
      hub.removeClient(slow.response);
      hub.removeClient(fast.response);
      await dbModule.bindDatabaseClient(client);
    }
  });

  it('cancels a drain wait on disconnect or authorization change', async () => {
    const hub = new RealtimeHub();
    await hub.pollNow();
    const afterSeq = await dbModule.currentMaxSeq(client);
    await appendChange(fixture.workspaceAId, 'cancel-drain');
    await hub.pollNow();
    const disconnected = fakeSseResponse(backpressureOnChange);
    const revoked = fakeSseResponse(backpressureOnChange);
    try {
      for (const sink of [disconnected, revoked])
        hub.addClient(sink.response, replayOptions(afterSeq));
      await waitFor(() => [disconnected, revoked].every(sink => sink.listeners('drain') === 1));
      disconnected.response.destroy();
      await appendChange(fixture.workspaceAId, 'revoke-during-drain', 'workspace_user');
      await appendChange(fixture.workspaceAId, 'never-send-after-revocation');
      await hub.pollNow();
      assert.equal(revoked.destroyed, true);
      for (const sink of [disconnected, revoked]) {
        assert.equal(sink.listeners('drain'), 0);
        assert.equal(sink.listeners('close'), 0);
        sink.drain();
      }
      await setImmediate();
      for (const sink of [disconnected, revoked])
        assert.doesNotMatch(sink.chunks.join(''), /never-send-after-revocation|replayComplete/);
      const reauthenticated = fakeSseResponse();
      hub.addClient(reauthenticated.response, {
        ...replayOptions(afterSeq),
        workspaceIds: [fixture.secondary.id]
      });
      try {
        await waitFor(() => reauthenticated.chunks.join('').includes('replayComplete'));
        assert.deepEqual(changeEvents(reauthenticated.chunks), []);
      } finally {
        hub.removeClient(reauthenticated.response);
      }
    } finally {
      hub.removeClient(disconnected.response);
      hub.removeClient(revoked.response);
    }
  });

  it('disconnects when queued live bytes fill the replay budget and resumes from the applied cursor', async () => {
    const hub = new RealtimeHub();
    await hub.pollNow();
    const afterSeq = await dbModule.currentMaxSeq(client);
    const applied = await appendChange(fixture.workspaceAId, 'before-overflow');
    await hub.pollNow();
    const slow = fakeSseResponse(backpressureOnChange);
    const resumed = fakeSseResponse();
    const fast = fakeSseResponse();
    try {
      hub.addClient(slow.response, replayOptions(afterSeq));
      hub.addClient(fast.response, { workspaceIds: [fixture.workspaceAId] });
      await waitFor(() => slow.listeners('drain') === 1);
      assert.equal(changeEvents(slow.chunks)[0]!.id, applied);
      const expected = [];
      for (let index = 0; index < 3; index += 1) {
        const seq = await appendChange(fixture.workspaceAId, `overflow-${index}`);
        expected.push(seq);
        await client.run('UPDATE entity_changes SET changed_fields_json = ? WHERE seq = ?', [
          JSON.stringify(['é'.repeat(200_000)]),
          seq
        ]);
        await hub.pollNow();
        assert.equal(slow.destroyed, index === 2);
      }
      assert.equal(slow.listeners('drain'), 0);
      assert.doesNotMatch(slow.chunks.join(''), /replayComplete|overflow-[0-9]/);
      hub.addClient(resumed.response, replayOptions(applied));
      await waitFor(() => resumed.chunks.join('').includes('replayComplete'));
      for (const sink of [fast, resumed])
        assert.deepEqual(
          changeEvents(sink.chunks).flatMap(event => event.data.changes.map(change => change.seq)),
          expected
        );
    } finally {
      for (const sink of [slow, resumed, fast]) hub.removeClient(sink.response);
    }
  });
});

after(async () => {
  await client.close();
});
