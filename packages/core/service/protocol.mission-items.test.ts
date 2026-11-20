import type { DeliveryReportPayloadV1 } from '@overlord/contract';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ServiceContext } from './context.js';
import {
  persistDeliveryPresentation,
  readDeliveryComposeContext
} from './delivery-presentation.js';
import { buildDeliveryReport } from './delivery-report.js';
import { closeMissionItem, insertDeliveryMissionItems } from './mission-items.js';
import { createMissionWithObjectives } from './missions.js';
import { createProject } from './projects.js';
import {
  attachSession,
  closeAgentMissionItems,
  deliverSession,
  readAgentMissionItems,
  recordWork,
  resumeFollowUp
} from './protocol.js';
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
    objectives: [{ instructions: `Work for ${name}` }]
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

describe('agent item inspection and standalone closure', () => {
  it('pages beyond 60 with full detail, prioritizes blockers, and closes without delivery', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    try {
      const project = await createProject({ ctx, name: 'Paged items' });
      const { mission, objectives } = await createMissionWithObjectives({
        ctx,
        projectId: project.id,
        objectives: [{ instructions: 'Report work' }, { instructions: 'Inspect work' }]
      });
      const first = await attachSession({
        ctx,
        missionId: mission.id,
        objectiveId: objectives[0]!.id
      });
      const delivered = await deliverSession({
        ctx,
        missionId: mission.id,
        sessionKey: first.sessionKey,
        summary: 'Reported work.'
      });
      const payload = agentReport('page').deliveryReport;
      const report = buildDeliveryReport({
        summary: 'Report',
        deliveryReport: {
          ...payload,
          agentReport: {
            ...payload.agentReport,
            knownRisks: Array.from(
              { length: 65 },
              (_, i) => `Risk ${i}: ${'Long detail '.repeat(45)}`
            ),
            humanActions: [
              { action: 'Optional action', reason: 'Useful', category: 'other', blocking: false },
              {
                action: 'Apply migration',
                reason: 'Required',
                category: 'database',
                blocking: true,
                command: 'yarn migrate',
                verify: 'Check schema'
              }
            ]
          }
        }
      });
      report.presentation.knownRisks = Array.from(
        { length: 65 },
        (_, i) => `Risk ${i}: ${'Long detail '.repeat(45)}`
      );
      await insertDeliveryMissionItems(db, {
        delivery: {
          id: delivered.deliveryId,
          workspaceId: ctx.workspace.id,
          projectId: project.id,
          missionId: mission.id,
          objectiveId: objectives[0]!.id,
          deliveredAt: new Date().toISOString()
        },
        report,
        attribution: { source: ctx.source, actorWorkspaceUserId: ctx.actorWorkspaceUserId }
      });
      const attached = await attachSession({
        ctx,
        missionId: mission.id,
        objectiveId: objectives[1]!.id
      });
      assert.equal(attached.missionSummary?.totalOpenItems, 68);
      assert.equal(attached.missionSummary?.openItems.length, 60);
      assert.equal(attached.missionSummary?.openItems[0]?.blocking, true);
      const scope = { ctx, missionId: mission.id, sessionKey: attached.sessionKey };
      const page = await readAgentMissionItems(scope);
      assert.equal(page.total, 68);
      assert.equal(page.nextOffset, 60);
      assert.equal(page.items[0]!.detail.command, 'yarn migrate');
      assert.equal(page.items[0]!.detail.verify, 'Check schema');
      const last = await readAgentMissionItems({ ...scope, offset: page.nextOffset! });
      assert.equal(last.nextOffset, null);
      assert.equal(new Set([...page.items, ...last.items].map(item => item.id)).size, 68);
      assert.ok(page.items.find(item => item.kind === 'risk')!.text.length > 400);
      const suggestion = [...page.items, ...last.items].find(item => item.kind === 'suggestion')!;
      assert.ok(suggestion.detail.change);
      assert.ok(suggestion.detail.location);
      assert.ok(suggestion.detail.doneWhen);
      const target = last.items.find(item => item.kind === 'risk')!;
      const before = await db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM deliveries WHERE mission_id = ?',
        [mission.id]
      );
      const closed = await closeAgentMissionItems({
        ...scope,
        closeItems: [
          { id: target.id, status: 'done', reason: 'Verified fixed.' },
          { id: target.id, status: 'dismissed', reason: 'Duplicate.' },
          { id: 'missing', status: 'done', reason: 'Missing.' }
        ]
      });
      assert.deepEqual(closed.closedItemIds, [target.id]);
      assert.equal(closed.warnings.length, 2);
      assert.equal(closed.narrativeWritten, false);
      const row = await db.get<any>('SELECT * FROM mission_items WHERE id = ?', [target.id]);
      assert.equal(row.resolved_by_kind, 'agent');
      assert.equal(row.resolved_by_objective_id, objectives[1]!.id);
      assert.equal(row.resolved_by_delivery_id, null);
      assert.equal(row.status_reason, 'Verified fixed.');
      assert.equal(await itemChangeCount(ctx, target.id), 2);
      assert.deepEqual(
        await db.get('SELECT COUNT(*) AS n FROM deliveries WHERE mission_id = ?', [mission.id]),
        before
      );
      assert.equal((await readAgentMissionItems(scope)).total, 67);
      await assert.rejects(
        closeAgentMissionItems({ ...scope, closeItems: [{ id: suggestion.id, status: 'done' }] })
      );
      await assert.rejects(readAgentMissionItems({ ...scope, offset: -1 }));
      await assert.rejects(readAgentMissionItems({ ...scope, sessionKey: 'invalid' }));
      const other = await attachedMission(ctx, 'Foreign mission');
      await assert.rejects(readAgentMissionItems({ ...scope, missionId: other.mission.id }));
      await assert.rejects(
        closeAgentMissionItems({
          ...scope,
          missionId: other.mission.id,
          closeItems: [{ id: target.id, status: 'done', reason: 'Wrong mission.' }]
        })
      );
      const skipped = await closeAgentMissionItems({
        ctx,
        missionId: other.mission.id,
        sessionKey: other.sessionKey,
        closeItems: [{ id: suggestion.id, status: 'dismissed', reason: 'Foreign item.' }]
      });
      assert.equal(skipped.closedItemIds.length, 0);
      assert.match(skipped.warnings[0]!.message, /no item has this id/);
      await assert.rejects(
        readAgentMissionItems({ ...scope, ctx: { ...ctx, allowedProjectIds: ['other-project'] } })
      );
      await assert.rejects(
        readAgentMissionItems({
          ...scope,
          ctx: { ...ctx, workspace: { ...ctx.workspace, id: 'other-workspace' } }
        })
      );
      await deliverSession({ ...scope, summary: 'Inspection done.' });
      await assert.rejects(
        closeAgentMissionItems({
          ...scope,
          closeItems: [{ id: suggestion.id, status: 'done', reason: 'Too late.' }]
        })
      );
    } finally {
      await db.close();
    }
  });
});
