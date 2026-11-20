import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ServiceContext } from './context.js';
import {
  canonicalJson,
  DELIVERY_ALREADY_ACCEPTED,
  DELIVERY_OPERATION_CONFLICT,
  finalizationRequestDigest,
  readDeliveryReceipt
} from './delivery-finalization.js';
import { ServiceError } from './errors.js';
import { createMissionWithObjectives } from './missions.js';
import { createProject } from './projects.js';
import { attachSession, deliverSession, recordWork } from './protocol.js';
import { RUN_QUEUE_DISPATCH_JOB_TYPE } from './run-queue.js';
import { createSeededServiceContext, seedServiceOperator } from './test-helpers.js';

async function setup() {
  return createSeededServiceContext({ source: 'cli' });
}

async function attachedMission(ctx: ServiceContext, name: string, objectiveCount = 1) {
  const project = await createProject({ ctx, name });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: Array.from({ length: objectiveCount }, (_, index) => ({
      instructions: `Work ${index + 1} for ${name}`
    }))
  });
  const objectiveId = objectives[0]!.id;
  await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectiveId]);
  const attached = await attachSession({
    ctx,
    missionId: mission.displayId,
    objectiveId,
    agentIdentifier: 'claude'
  });
  return { project, mission, objectiveId, sessionKey: attached.sessionKey };
}

async function count(ctx: ServiceContext, sql: string, params: unknown[]): Promise<number> {
  const row = await ctx.db.get<{ n: number }>(sql, params as never[]);
  return Number(row?.n ?? 0);
}

async function finalizationCounts(ctx: ServiceContext, missionId: string) {
  return {
    deliveries: await count(ctx, `SELECT COUNT(*) AS n FROM deliveries WHERE mission_id = ?`, [
      missionId
    ]),
    receipts: await count(
      ctx,
      `SELECT COUNT(*) AS n FROM delivery_finalizations WHERE mission_id = ?`,
      [missionId]
    ),
    deliveryEvents: await count(
      ctx,
      `SELECT COUNT(*) AS n FROM mission_events WHERE mission_id = ? AND type = 'delivery'`,
      [missionId]
    ),
    jobs: await count(ctx, `SELECT COUNT(*) AS n FROM worker_jobs`, []),
    notifications: await count(
      ctx,
      `SELECT COUNT(*) AS n FROM notifications WHERE mission_id = ?`,
      [missionId]
    )
  };
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof ServiceError && error.code === code;
}

describe('replay-safe delivery finalization (ADR 0075)', () => {
  it('canonical digests ignore key order and undefined members but keep array order', () => {
    assert.equal(
      canonicalJson({ b: 1, a: { d: undefined, c: [2, 1] } }),
      '{"a":{"c":[2,1]},"b":1}'
    );
    assert.equal(
      finalizationRequestDigest('deliver', { a: 1, b: 2 }),
      finalizationRequestDigest('deliver', { b: 2, a: 1 })
    );
    assert.notEqual(
      finalizationRequestDigest('deliver', { list: [1, 2] }),
      finalizationRequestDigest('deliver', { list: [2, 1] })
    );
    assert.notEqual(
      finalizationRequestDigest('deliver', { a: 1 }),
      finalizationRequestDigest('record_work', { a: 1 })
    );
  });

  it('replays the same operation after the session ended without writing anything again', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey } = await attachedMission(ctx, 'Replay Deliver');
    const request = {
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Implemented the receipt path.',
      operationId: 'op-deliver-0001'
    };

    const first = await deliverSession(request);
    assert.equal(first.operationId, 'op-deliver-0001');
    assert.equal(first.replayed, undefined);
    const afterFirst = await finalizationCounts(ctx, mission.id);
    assert.equal(afterFirst.deliveries, 1);
    assert.equal(afterFirst.receipts, 1);

    // A lost response: the client retries the same operation after the session ended.
    const replay = await deliverSession(request);
    assert.equal(replay.replayed, true);
    assert.equal(replay.deliveryId, first.deliveryId);
    assert.equal(replay.eventId, first.eventId);
    assert.equal(replay.instruction, first.instruction);
    assert.deepEqual(await finalizationCounts(ctx, mission.id), afterFirst);

    await db.close();
  });

  it('refuses the same operation id with a different request body', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey } = await attachedMission(ctx, 'Digest Mismatch');
    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Original summary.',
      operationId: 'op-digest-0001'
    });
    await assert.rejects(
      deliverSession({
        ctx,
        missionId: mission.displayId,
        sessionKey,
        summary: 'Edited summary.',
        operationId: 'op-digest-0001'
      }),
      hasCode(DELIVERY_OPERATION_CONFLICT)
    );
    assert.equal((await finalizationCounts(ctx, mission.id)).deliveries, 1);
    await db.close();
  });

  it('never finalizes one session twice: a new id or a legacy request gets the accepted delivery id', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey } = await attachedMission(ctx, 'Second Finalization');
    const first = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Done.',
      operationId: 'op-first-00001'
    });

    for (const operationId of ['op-second-0001', undefined]) {
      await assert.rejects(
        deliverSession({
          ctx,
          missionId: mission.displayId,
          sessionKey,
          summary: 'Done.',
          ...(operationId ? { operationId } : {})
        }),
        (error: unknown) =>
          error instanceof ServiceError &&
          error.code === DELIVERY_ALREADY_ACCEPTED &&
          error.status === 409 &&
          (error.details as { deliveryId: string }).deliveryId === first.deliveryId
      );
    }
    assert.equal((await finalizationCounts(ctx, mission.id)).deliveries, 1);
    await db.close();
  });

  it('serializes concurrent deliveries of one session under the mission lock', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey } = await attachedMission(ctx, 'Concurrent Deliver');
    const results = await Promise.allSettled([
      deliverSession({
        ctx,
        missionId: mission.displayId,
        sessionKey,
        summary: 'Attempt A.',
        operationId: 'op-race-a-0001'
      }),
      deliverSession({
        ctx,
        missionId: mission.displayId,
        sessionKey,
        summary: 'Attempt B.',
        operationId: 'op-race-b-0001'
      })
    ]);
    const accepted = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter(result => result.status === 'rejected');
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(hasCode(DELIVERY_ALREADY_ACCEPTED)((rejected[0] as PromiseRejectedResult).reason));
    const counts = await finalizationCounts(ctx, mission.id);
    assert.equal(counts.deliveries, 1);
    assert.equal(counts.receipts, 1);
    assert.equal(counts.deliveryEvents, 1);
    await db.close();
  });

  it('concurrent retries of the same operation return one delivery', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey } = await attachedMission(ctx, 'Concurrent Same Op');
    const request = {
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Same attempt.',
      operationId: 'op-same-race-01'
    };
    const [a, b] = await Promise.all([deliverSession(request), deliverSession(request)]);
    assert.equal(a.deliveryId, b.deliveryId);
    assert.equal([a.replayed, b.replayed].filter(Boolean).length, 1);
    assert.equal((await finalizationCounts(ctx, mission.id)).deliveries, 1);
    await db.close();
  });

  it('a historical delivered session without a receipt still counts as accepted', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey } = await attachedMission(ctx, 'Historical Session');
    const first = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Delivered before receipts existed.'
    });
    // Simulate a pre-receipt delivery: receipts are never backfilled.
    await db.run(`DELETE FROM delivery_finalizations WHERE delivery_id = ?`, [first.deliveryId]);
    await assert.rejects(
      deliverSession({
        ctx,
        missionId: mission.displayId,
        sessionKey,
        summary: 'Delivered before receipts existed.',
        operationId: 'op-historic-001'
      }),
      (error: unknown) =>
        hasCode(DELIVERY_ALREADY_ACCEPTED)(error) &&
        ((error as ServiceError).details as { deliveryId: string }).deliveryId === first.deliveryId
    );
    await db.close();
  });

  it('hands required follow-on scheduling off in the finalization transaction, exactly once', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey, project } = await attachedMission(ctx, 'Durable Handoff', 2);
    await db.run(`UPDATE missions SET assigned_workspace_user_id = ? WHERE id = ?`, [
      ctx.actorWorkspaceUserId,
      mission.id
    ]);
    const request = {
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Handoff.',
      operationId: 'op-handoff-001'
    };
    const first = await deliverSession(request);
    const dispatchJobs = await count(
      ctx,
      `SELECT COUNT(*) AS n FROM worker_jobs WHERE type = ? AND payload_json LIKE ?`,
      [RUN_QUEUE_DISPATCH_JOB_TYPE, `%${project.id}%`]
    );
    assert.equal(dispatchJobs, 1);
    const awaiting = await count(
      ctx,
      `SELECT COUNT(*) AS n FROM mission_events WHERE mission_id = ? AND type = 'awaiting_approval'`,
      [mission.id]
    );
    assert.equal(awaiting, 1);
    const before = await finalizationCounts(ctx, mission.id);

    const replay = await deliverSession(request);
    assert.equal(replay.deliveryId, first.deliveryId);
    assert.deepEqual(await finalizationCounts(ctx, mission.id), before);
    assert.equal(
      await count(
        ctx,
        `SELECT COUNT(*) AS n FROM mission_events WHERE mission_id = ? AND type = 'awaiting_approval'`,
        [mission.id]
      ),
      1
    );
    await db.close();
  });

  it('a rejected request creates no receipt and leaves the session deliverable', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey } = await attachedMission(ctx, 'Rejected First');
    await assert.rejects(
      deliverSession({
        ctx,
        missionId: mission.displayId,
        sessionKey,
        summary: 'Bad deferred work.',
        payloadJson: {
          deliveryReport: { schemaVersion: 1, agentReport: { deferredWork: ['loose'] } }
        },
        operationId: 'op-reject-0001'
      }),
      hasCode('invalid_input')
    );
    assert.equal((await finalizationCounts(ctx, mission.id)).receipts, 0);
    const accepted = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Fixed.',
      operationId: 'op-reject-0001'
    });
    assert.ok(accepted.deliveryId);
    await db.close();
  });

  it('receipts are immutable after insertion', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey } = await attachedMission(ctx, 'Immutable Receipt');
    await deliverSession({ ctx, missionId: mission.displayId, sessionKey, summary: 'Done.' });
    await assert.rejects(
      db.run(
        `UPDATE delivery_finalizations SET request_digest = 'v1:tampered' WHERE mission_id = ?`,
        [mission.id]
      ),
      /immutable/
    );
    await db.close();
  });

  it('rechecks current access on replay and on receipt reads', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey } = await attachedMission(ctx, 'Access Recheck');
    const request = {
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Done.',
      operationId: 'op-access-0001'
    };
    const first = await deliverSession(request);

    const byOperation = await readDeliveryReceipt({ ctx, operationId: 'op-access-0001' });
    assert.equal(byOperation.receipt.deliveryId, first.deliveryId);
    assert.equal(byOperation.receipt.result.deliveryId, first.deliveryId);
    const byDelivery = await readDeliveryReceipt({
      ctx,
      missionId: mission.displayId,
      deliveryId: first.deliveryId
    });
    assert.equal(byDelivery.receipt.operationId, 'op-access-0001');

    // Another member cannot borrow the operation id or read the receipt.
    const otherMember = await seedServiceOperator({
      db,
      profileId: 'other-user',
      workspaceUserId: 'other-workspace-user'
    });
    const other: ServiceContext = { ...ctx, actorWorkspaceUserId: otherMember };
    await assert.rejects(
      readDeliveryReceipt({ ctx: other, operationId: 'op-access-0001' }),
      hasCode('delivery_receipt_not_found')
    );
    await assert.rejects(
      readDeliveryReceipt({ ctx: other, deliveryId: first.deliveryId }),
      hasCode('delivery_receipt_not_found')
    );

    // A token whose project scope no longer covers the mission cannot replay or read.
    const revoked: ServiceContext = { ...ctx, allowedProjectIds: [] };
    await assert.rejects(deliverSession({ ...request, ctx: revoked }));
    await assert.rejects(
      readDeliveryReceipt({ ctx: revoked, operationId: 'op-access-0001' }),
      hasCode('delivery_receipt_not_found')
    );
    await db.close();
  });
});

describe('replay-safe record-work (ADR 0075)', () => {
  async function missionCount(ctx: ServiceContext, projectId: string) {
    return await count(ctx, `SELECT COUNT(*) AS n FROM missions WHERE project_id = ?`, [projectId]);
  }

  it('a retried operation returns the same mission and delivery', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Record Replay' });
    const request = {
      ctx,
      projectId: project.id,
      objective: 'Fix the parser.',
      summary: 'Fixed the parser.',
      operationId: 'op-record-0001'
    };
    const first = await recordWork(request);
    const replay = await recordWork(request);
    assert.equal(replay.replayed, true);
    assert.equal(replay.mission.id, first.mission.id);
    assert.equal(replay.deliveryId, first.deliveryId);
    assert.equal(await missionCount(ctx, project.id), 1);

    await assert.rejects(
      recordWork({ ...request, summary: 'Different work.' }),
      hasCode(DELIVERY_OPERATION_CONFLICT)
    );
    assert.equal(await missionCount(ctx, project.id), 1);

    const receipt = await readDeliveryReceipt({
      ctx,
      operationId: 'op-record-0001',
      operationKind: 'record_work'
    });
    assert.equal(receipt.receipt.missionId, first.mission.id);
    await db.close();
  });

  it('concurrent same-operation record-work creates one mission', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Record Race' });
    const request = {
      ctx,
      projectId: project.id,
      objective: 'Write docs.',
      summary: 'Wrote docs.',
      operationId: 'op-record-race1'
    };
    const [a, b] = await Promise.all([recordWork(request), recordWork(request)]);
    assert.equal(a.mission.id, b.mission.id);
    assert.equal(await missionCount(ctx, project.id), 1);
    await db.close();
  });

  it('intentionally identical work under distinct ids, or legacy calls without ids, stays separate', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Record Separate' });
    const base = {
      ctx,
      projectId: project.id,
      objective: 'Rotate the key.',
      summary: 'Rotated the key.'
    };
    const a = await recordWork({ ...base, operationId: 'op-separate-01' });
    const b = await recordWork({ ...base, operationId: 'op-separate-02' });
    assert.notEqual(a.mission.id, b.mission.id);
    const c = await recordWork(base);
    const d = await recordWork(base);
    assert.notEqual(c.mission.id, d.mission.id);
    assert.equal(await missionCount(ctx, project.id), 4);
    await db.close();
  });

  it('a failed record-work rolls back its mission creation entirely', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Record Rollback' });
    await assert.rejects(
      recordWork({
        ctx,
        projectId: project.id,
        objective: 'Bad artifact.',
        summary: 'Has a bad artifact.',
        artifacts: [{ type: 'note', label: 'x' }],
        operationId: 'op-rollback-01'
      })
    );
    assert.equal(await missionCount(ctx, project.id), 0);
    await db.close();
  });

  it('rejects malformed operation ids before any write', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Record Bad Id' });
    await assert.rejects(
      recordWork({
        ctx,
        projectId: project.id,
        objective: 'x',
        summary: 'y',
        operationId: 'short'
      }),
      hasCode('invalid_input')
    );
    assert.equal(await missionCount(ctx, project.id), 0);
    await db.close();
  });
});
