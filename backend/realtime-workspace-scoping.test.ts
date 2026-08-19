import type { Response } from 'express';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { setupSecondaryWorkspaceFixture } from './secondary-workspace-fixture.ts';

interface FakeSseResponse {
  response: Response;
  chunks: string[];
  ended: boolean;
}

function fakeSseResponse(): FakeSseResponse {
  const chunks: string[] = [];
  const sink = { response: null as unknown as Response, chunks, ended: false };
  const response = {
    writeHead: () => response,
    write: (chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    },
    end: () => {
      sink.ended = true;
      return response;
    }
  } as unknown as Response;
  sink.response = response;
  return sink;
}

function changeEvents(chunks: string[]): Array<{
  id: number;
  data: { cursor: number; changes: Array<{ workspaceId: string; entityId: string }> };
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
const { RealtimeHub, readableChangeFeedWorkspaceIds, readChangesAfter } =
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
});

after(async () => {
  await client.close();
});
