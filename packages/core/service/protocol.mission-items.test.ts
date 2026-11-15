import type { DeliveryReportPayloadV1 } from '@overlord/contract';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ServiceContext } from './context.js';
import {
  persistDeliveryPresentation,
  readDeliveryComposeContext
} from './delivery-presentation.js';
import { closeMissionItem } from './mission-items.js';
import { createMissionWithObjectives } from './missions.js';
import { createProject } from './projects.js';
import { attachSession, deliverSession, recordWork, resumeFollowUp } from './protocol.js';
import { createSeededServiceContext } from './test-helpers.js';

/**
 * The protocol write paths of `mission_items` (coo:1260.430y): a delivery and a
 * record-work insert their items in the delivery transaction, a re-delivery
 * supersedes the objective's earlier open human actions, and saving a composed
 * or fallback presentation reconciles the rows.
 */

interface ItemRow {
  id: string;
  delivery_id: string;
  kind: string;
  text: string;
  status: string;
  resolved_by_kind: string | null;
}

async function items(ctx: ServiceContext, missionId: string): Promise<ItemRow[]> {
  return ctx.db.all<ItemRow>(
    `SELECT mi.id, mi.delivery_id, mi.kind, mi.text, mi.status, mi.resolved_by_kind
       FROM mission_items mi
       JOIN deliveries d ON d.id = mi.delivery_id
      WHERE mi.mission_id = ?
      ORDER BY d.delivered_at ASC, mi.kind ASC, mi.position ASC`,
    [missionId]
  );
}

async function itemChangeCount(ctx: ServiceContext, itemId: string): Promise<number> {
  const row = await ctx.db.get<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM entity_changes WHERE entity_type = 'mission_item' AND entity_id = ?`,
    [itemId]
  );
  return Number(row?.n ?? 0);
}

const agentReport = (tag: string) => ({
  deliveryReport: {
    schemaVersion: 1,
    agentReport: {
      humanActions: [
        {
          action: `Run the ${tag} migration in production.`,
          reason: 'The table is missing until it runs.',
          category: 'database'
        }
      ],
      knownRisks: [`The ${tag} backfill is slow on large workspaces.`],
      deferredWork: [
        {
          title: `Add a ${tag} progress bar`,
          change: 'Show backfill progress.',
          location: 'database/src/backfill.ts',
          doneWhen: 'Progress is visible.'
        }
      ]
    }
  }
});

async function attachedMission(ctx: ServiceContext, name: string) {
  const project = await createProject({ ctx, name });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ objective: `Work for ${name}` }]
  });
  const objectiveId = objectives[0]!.id;
  await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectiveId]);
  const attached = await attachSession({ ctx, missionId: mission.displayId });
  return { mission, objectiveId, sessionKey: attached.sessionKey };
}

describe('mission items on the protocol write paths', () => {
  it('deliverSession inserts the delivery items as open rows with a change each', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission, sessionKey } = await attachedMission(ctx, 'Items Deliver');

    const { deliveryId } = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Added the table.',
      payloadJson: agentReport('first')
    });

    const rows = await items(ctx, mission.id);
    assert.deepEqual(
      rows.map(row => [row.delivery_id, row.kind, row.status]),
      [
        [deliveryId, 'human_action', 'open'],
        [deliveryId, 'risk', 'open'],
        [deliveryId, 'suggestion', 'open']
      ]
    );
    assert.equal(rows[0]!.text, 'Run the first migration in production.');
    for (const row of rows) assert.equal(await itemChangeCount(ctx, row.id), 1);
    const change = await ctx.db.get<{ source: string; mission_id: string }>(
      `SELECT source, mission_id FROM entity_changes WHERE entity_type = 'mission_item' AND entity_id = ?`,
      [rows[0]!.id]
    );
    assert.equal(change?.source, 'cli');
    assert.equal(change?.mission_id, mission.id);

    await db.close();
  });

  it('a delivery without a report still succeeds and writes no items', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission, sessionKey } = await attachedMission(ctx, 'Items Summary Only');

    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Summary-only delivery.'
    });

    assert.deepEqual(await items(ctx, mission.id), []);
    await db.close();
  });

  it('a re-delivery supersedes the earlier open human actions only, never a closed one', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission, objectiveId, sessionKey } = await attachedMission(ctx, 'Items Redeliver');

    const first = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'First delivery.',
      payloadJson: {
        deliveryReport: {
          schemaVersion: 1,
          agentReport: {
            humanActions: [
              { action: 'Deploy the worker.', category: 'deployment' },
              { action: 'Rotate the key.', category: 'environment' }
            ],
            knownRisks: ['Retries may double-send.']
          }
        }
      }
    });
    const [deploy] = (await items(ctx, mission.id)).filter(row => row.kind === 'human_action');
    const closed = await closeMissionItem(ctx.db, {
      itemId: deploy!.id,
      status: 'done',
      reason: 'Deployed by hand.',
      resolver: { kind: 'person', workspaceUserId: null },
      attribution: { actorWorkspaceUserId: null, actorTokenId: null, source: 'webapp' }
    });
    assert.equal(closed.ok, true);

    const follow = await resumeFollowUp({ ctx, missionId: mission.displayId, objectiveId });
    const second = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: follow.sessionKey,
      summary: 'Second delivery.',
      payloadJson: agentReport('second')
    });

    const byDelivery = (deliveryId: string) =>
      items(ctx, mission.id).then(rows =>
        rows
          .filter(row => row.delivery_id === deliveryId)
          .map(row => [row.kind, row.text, row.status])
      );
    assert.deepEqual(await byDelivery(first.deliveryId), [
      ['human_action', 'Deploy the worker.', 'done'],
      ['human_action', 'Rotate the key.', 'superseded'],
      ['risk', 'Retries may double-send.', 'open']
    ]);
    assert.deepEqual(
      (await byDelivery(second.deliveryId)).map(([, , status]) => status),
      ['open', 'open', 'open']
    );

    await db.close();
  });

  it('recordWork inserts its items in the delivery transaction', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const project = await createProject({ ctx, name: 'Items Record Work' });

    const { mission, deliveryId } = await recordWork({
      ctx,
      projectId: project.id,
      objective: 'Build the exporter.',
      summary: 'Built the exporter.',
      payloadJson: agentReport('recorded')
    });

    const rows = await items(ctx, mission.id);
    assert.deepEqual(
      rows.map(row => [row.delivery_id, row.kind, row.status]),
      [
        [deliveryId, 'human_action', 'open'],
        [deliveryId, 'risk', 'open'],
        [deliveryId, 'suggestion', 'open']
      ]
    );
    await db.close();
  });

  it('saving a presentation reconciles items and keeps closed rows', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission, sessionKey } = await attachedMission(ctx, 'Items Reconcile');
    const { deliveryId } = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Delivered.',
      payloadJson: {
        deliveryReport: {
          schemaVersion: 1,
          agentReport: {
            knownRisks: ['Kept risk.', 'Dropped risk.', 'Closed risk.'],
            deferredWork: []
          }
        }
      }
    });
    const before = await items(ctx, mission.id);
    const closedRisk = before.find(row => row.text === 'Closed risk.')!;
    await closeMissionItem(ctx.db, {
      itemId: closedRisk.id,
      status: 'dismissed',
      resolver: { kind: 'person', workspaceUserId: null },
      attribution: { actorWorkspaceUserId: null, actorTokenId: null, source: 'webapp' }
    });

    const context = await readDeliveryComposeContext(ctx.db, deliveryId);
    assert.ok(context);
    const presented: DeliveryReportPayloadV1 = {
      ...context.report,
      presentation: {
        ...context.report.presentation,
        status: 'composed',
        knownRisks: ['Kept risk.'],
        humanActions: [
          {
            id: 'deterministic-migration',
            action: 'Apply the new migration before deploying.',
            category: 'database',
            source: 'deterministic_rule',
            sourceRef: 'database/sqlite/migrations/x.sql'
          }
        ]
      }
    };
    await persistDeliveryPresentation({
      db: ctx.db,
      delivery: context.delivery,
      nextReport: presented,
      changedFields: ['payload_json', 'presentation'],
      resolveChangeAttribution: async () => ({
        actorWorkspaceUserId: null,
        actorTokenId: null,
        source: 'runner'
      })
    });

    const after = await items(ctx, mission.id);
    assert.deepEqual(
      after.map(row => [row.kind, row.text, row.status]),
      [
        ['human_action', 'Apply the new migration before deploying.', 'open'],
        ['risk', 'Kept risk.', 'open'],
        ['risk', 'Closed risk.', 'dismissed']
      ]
    );
    const dropped = before.find(row => row.text === 'Dropped risk.')!;
    const deleteChange = await ctx.db.get<{ operation: string }>(
      `SELECT operation FROM entity_changes
        WHERE entity_type = 'mission_item' AND entity_id = ? ORDER BY seq DESC LIMIT 1`,
      [dropped.id]
    );
    assert.equal(deleteChange?.operation, 'delete');

    await db.close();
  });
});
