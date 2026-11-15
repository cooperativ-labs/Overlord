import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bindWebappDatabaseClient,
  conformanceAdapters,
  createConformanceDatabase
} from './test-helpers.ts';

/**
 * The agent-facing mission summary behaves identically on both editions
 * (coo:1260.shmg): attach baseline, agent narrative and close writes in the
 * delivery transaction, the stale-base conflict that writes nothing, and
 * record-work without a base.
 */

const agentReport = {
  deliveryReport: {
    schemaVersion: 1,
    agentReport: {
      humanActions: [
        {
          action: 'Run the backfill in production.',
          reason: 'Rows are missing.',
          category: 'database'
        }
      ],
      knownRisks: ['The backfill is slow on large workspaces.'],
      deferredWork: []
    }
  }
};

for (const adapter of conformanceAdapters()) {
  describe(`agent mission summary [${adapter}]`, () => {
    it('writes the baseline, the narrative, item closes and the conflict identically', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_agent_summary');
      try {
        await bindWebappDatabaseClient({ client: db });
        const repo = await import('./repository.ts');
        const { buildWebappServiceContext } = await import('./db.ts');
        const { getMissionSummary } = await import('./mission-summary.ts');
        const { attachSession, deliverSession, recordWork } =
          await import('../packages/core/service/protocol.ts');
        const { ServiceError } = await import('../packages/core/service/errors.ts');

        const ctx = buildWebappServiceContext();
        const project = await repo.createProject({ name: 'Agent summary' });
        const mission = await repo.createMission({ projectId: project.id, firstObjective: 'A' });
        const second = await repo.createObjective({
          missionId: mission.id,
          instructionText: 'B',
          state: 'draft'
        });
        const [first] = mission.objectives;

        const a = await attachSession({ ctx, missionId: mission.id, objectiveId: first!.id });
        const b = await attachSession({ ctx, missionId: mission.id, objectiveId: second.id });
        assert.equal(a.missionSummary?.contentRevision, 0);
        assert.equal(b.missionSummary?.contentRevision, 0);

        const delivered = await deliverSession({
          ctx,
          missionId: mission.id,
          sessionKey: a.sessionKey,
          summary: 'A.',
          payloadJson: agentReport,
          missionSummary: { baseContentRevision: 0, headline: 'A landed.', summary: 'A is tested.' }
        });
        assert.equal(delivered.missionSummary?.contentRevision, 1);

        await assert.rejects(
          deliverSession({
            ctx,
            missionId: mission.id,
            sessionKey: b.sessionKey,
            summary: 'B.',
            payloadJson: agentReport,
            missionSummary: { baseContentRevision: 0, headline: 'B landed.', summary: 'B.' }
          }),
          (error: unknown) => {
            assert.ok(error instanceof ServiceError);
            assert.equal(error.code, 'mission_summary_conflict');
            const details = error.details as {
              missionSummary: { contentRevision: number; openItems: Array<{ kind: string }> };
            };
            assert.equal(details.missionSummary.contentRevision, 1);
            assert.deepEqual(details.missionSummary.openItems.map(item => item.kind).sort(), [
              'human_action',
              'risk'
            ]);
            return true;
          }
        );
        const deliveries = await db.all<{ objective_id: string }>(
          `SELECT objective_id FROM deliveries WHERE mission_id = ?`,
          [mission.id]
        );
        assert.deepEqual(
          deliveries.map(row => row.objective_id),
          [first!.id]
        );

        const risk = (await db.get<{ id: string }>(
          `SELECT id FROM mission_items WHERE mission_id = ? AND kind = 'risk'`,
          [mission.id]
        ))!.id;
        const retried = await deliverSession({
          ctx,
          missionId: mission.id,
          sessionKey: b.sessionKey,
          summary: 'B.',
          missionSummary: {
            baseContentRevision: 1,
            headline: 'A and B landed.',
            summary: 'Both are tested.',
            closeItems: [
              { id: risk, status: 'done', reason: 'Batched in B.' },
              { id: 'missing', status: 'dismissed', reason: 'Unknown.' }
            ]
          }
        });
        assert.deepEqual(retried.missionSummary?.closedItemIds, [risk]);
        assert.equal(retried.missionSummary?.contentRevision, 2);

        const summary = (await getMissionSummary(mission.id)).summary!;
        assert.equal(summary.status, 'composed');
        assert.deepEqual(summary.author, {
          kind: 'agent',
          objectiveId: second.id,
          deliveryId: retried.deliveryId
        });
        assert.equal(summary.headline, 'A and B landed.');
        const closed = summary.closedItems.find(item => item.id === risk);
        assert.equal(closed?.reason, 'Batched in B.');
        assert.equal(closed?.resolvedBy?.kind, 'agent');

        const recorded = await recordWork({
          ctx,
          projectId: project.id,
          objective: 'Recorded.',
          summary: 'Recorded.',
          missionSummary: { headline: 'Recorded work.', summary: 'Tested.' }
        });
        assert.equal(recorded.missionSummary?.contentRevision, 1);
        assert.equal((await getMissionSummary(recorded.mission.id)).summary?.author.kind, 'agent');
      } finally {
        await cleanup();
      }
    });
  });
}
