import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bindWebappDatabaseClient,
  conformanceAdapters,
  createConformanceDatabase
} from './test-helpers.ts';

/**
 * Adapter conformance for the item write paths of coo:1260.430y: a protocol
 * delivery and a record-work insert `mission_items` rows in their transaction,
 * reopening an objective supersedes them, a person closes and restores any item
 * through `/api/mission-items/:id/resolution`, and the delivery card's
 * deferred-work routes read and write the same rows. SQLite always runs;
 * Postgres runs when `TEST_DATABASE_URL` is set.
 */

const agentReport = {
  deliveryReport: {
    schemaVersion: 1,
    agentReport: {
      humanActions: [{ action: 'Run the backfill in production.', category: 'database' }],
      knownRisks: ['The backfill holds a lock per batch.'],
      deferredWork: [
        {
          title: 'Report backfill progress',
          change: 'Log each finished batch.',
          location: 'database/src/mission-items-migration-runtime.ts',
          doneWhen: 'Each batch logs a line.'
        }
      ]
    }
  }
};

for (const adapter of conformanceAdapters()) {
  describe(`mission item write paths [${adapter}]`, () => {
    it('delivers, record-works, reopens, closes and restores items identically', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_mission_items_rest');
      try {
        await bindWebappDatabaseClient({ client: db });
        const repo = await import('./repository.ts');
        const { buildWebappServiceContext } = await import('./db.ts');
        const { deliverSession, protocolPrompt, recordWork } =
          await import('../packages/core/service/protocol.ts');
        const { resolveMissionItem, restoreMissionItemResolution } =
          await import('./mission-item-resolutions.ts');
        const { resolveDeferredWork, reopenDeferredWork } =
          await import('./deferred-work-resolutions.ts');

        const project = await repo.createProject({ name: 'Item write paths' });
        const ctx = buildWebappServiceContext();
        const prompted = await protocolPrompt({
          ctx,
          projectId: project.id,
          objectives: [{ objective: 'Backfill items' }],
          agentIdentifier: 'codex'
        });
        const { deliveryId } = await deliverSession({
          ctx,
          missionId: prompted.mission.id,
          sessionKey: prompted.sessionKey,
          summary: 'Backfilled.',
          payloadJson: agentReport
        });
        const rows = () =>
          db.all<{ id: string; kind: string; status: string; delivery_id: string }>(
            `SELECT id, kind, status, delivery_id FROM mission_items
              WHERE mission_id = ? ORDER BY kind ASC`,
            [prompted.mission.id]
          );
        assert.deepEqual(
          (await rows()).map(row => [row.kind, row.status, row.delivery_id]),
          [
            ['human_action', 'open', deliveryId],
            ['risk', 'open', deliveryId],
            ['suggestion', 'open', deliveryId]
          ]
        );

        const recorded = await recordWork({
          ctx,
          projectId: project.id,
          objective: 'Recorded work',
          summary: 'Done.',
          payloadJson: agentReport
        });
        const recordedCount = await db.get<{ n: number | string }>(
          'SELECT COUNT(*) AS n FROM mission_items WHERE delivery_id = ?',
          [recorded.deliveryId]
        );
        assert.equal(Number(recordedCount?.n), 3);

        const [action, risk, suggestion] = await rows();
        const closedRisk = await resolveMissionItem(risk!.id, {
          status: 'done',
          reason: 'Batches are lock-free now.'
        });
        assert.equal(closedRisk.status, 'done');
        assert.equal(closedRisk.reason, 'Batches are lock-free now.');
        assert.equal(closedRisk.resolvedBy?.kind, 'person');
        const closedAction = await resolveMissionItem(action!.id, { status: 'dismissed' });
        assert.equal(closedAction.status, 'dismissed');
        assert.equal((await restoreMissionItemResolution(action!.id)).status, 'open');

        const [card] = (await repo.listMissionDeliveries(prompted.mission.id)).items.find(
          delivery => delivery.id === deliveryId
        )!.deferredWorkItems;
        const resolved = await resolveDeferredWork(deliveryId, card!.actionId, {
          status: 'done',
          outcome: 'mission_created',
          outcomeRef: 'test:9'
        });
        assert.equal(resolved.resolution?.resolvedBy.kind, 'person');
        const suggestionRow = (await rows()).find(row => row.id === suggestion!.id)!;
        assert.equal(suggestionRow.status, 'done', 'the card writes the suggestion row');
        assert.equal((await reopenDeferredWork(deliveryId, card!.actionId)).resolution, null);

        const objectiveId = prompted.objective.id;
        await db.run(`UPDATE objectives SET state = 'complete' WHERE id = ?`, [objectiveId]);
        await repo.updateObjective(objectiveId, { state: 'draft' });
        assert.deepEqual(
          (await rows()).map(row => [row.kind, row.status]),
          [
            ['human_action', 'superseded'],
            ['risk', 'done'],
            ['suggestion', 'superseded']
          ]
        );
        await assert.rejects(
          restoreMissionItemResolution(action!.id),
          (error: { status?: number; code?: string }) =>
            error.status === 409 && error.code === 'mission_item_superseded'
        );
        assert.equal((await restoreMissionItemResolution(risk!.id)).status, 'superseded');

        const changes = await db.get<{ n: number | string }>(
          `SELECT COUNT(*) AS n FROM entity_changes WHERE entity_type = 'mission_item' AND mission_id = ?`,
          [prompted.mission.id]
        );
        assert.ok(Number(changes?.n) >= 10, 'every item write appends a change');
      } finally {
        await cleanup();
      }
    });
  });
}
