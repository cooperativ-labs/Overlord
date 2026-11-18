import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
        await db.run(
          `INSERT INTO mission_events
          (id, workspace_id, project_id, mission_id, objective_id, type, summary, source, created_at)
          VALUES (?, ?, ?, ?, ?, 'user_follow_up', 'Keep this direction', 'cli', ?)`,
          [
            randomUUID(),
            ctx.workspace.id,
            project.id,
            mission.id,
            first!.id,
            new Date().toISOString()
          ]
        );
        const reattached = await attachSession({
          ctx,
          missionId: mission.id,
          existingSessionKey: a.sessionKey,
          connectionMethod: 'mcp'
        });
        assert.deepEqual(
          reattached.directives.map(event => event.summary),
          ['Keep this direction']
        );
        assert.deepEqual(
          reattached.objectives.map(objective => [objective.displayId, objective.state]),
          [[second.displayId, 'executing']]
        );
        assert.equal('history' in reattached, false);
        assert.equal(a.missionSummary?.contentRevision, 0);
        assert.equal(b.missionSummary?.contentRevision, 0);

        const delivered = await deliverSession({
          ctx,
          missionId: mission.id,
          sessionKey: a.sessionKey,
          summary: 'A.',
          payloadJson: agentReport,
          missionSummary: {
            baseContentRevision: 0,
            baseEvidenceRevision: 0,
            headline: 'A landed.',
            summary: 'A is tested.'
          }
        });
        assert.equal(delivered.missionSummary?.contentRevision, 1);

        const risk = (await db.get<{ id: string }>(
          `SELECT id FROM mission_items WHERE mission_id = ? AND kind = 'risk'`,
          [mission.id]
        ))!.id;
        // Stale prose is accepted and withheld (ADR 0076): the delivery and closes land.
        const stale = await deliverSession({
          ctx,
          missionId: mission.id,
          sessionKey: b.sessionKey,
          summary: 'B.',
          payloadJson: agentReport,
          missionSummary: {
            baseContentRevision: 0,
            baseEvidenceRevision: 0,
            headline: 'B landed.',
            summary: 'B.',
            closeItems: [
              { id: risk, status: 'done', reason: 'Batched in B.' },
              { id: 'missing', status: 'dismissed', reason: 'Unknown.' }
            ]
          }
        });
        assert.deepEqual(stale.missionSummary?.closedItemIds, [risk]);
        assert.equal(stale.missionSummary?.narrativeWritten, false);
        assert.equal(stale.missionSummary?.publication?.withheldReason, 'stale_content');
        assert.equal(stale.missionSummary?.baseline?.contentRevision, 1);
        assert.deepEqual(stale.missionSummary?.baseline?.openItems.map(item => item.kind).sort(), [
          'human_action',
          'human_action',
          'risk'
        ]);
        const deliveries = await db.all<{ objective_id: string }>(
          `SELECT objective_id FROM deliveries WHERE mission_id = ? ORDER BY delivered_at`,
          [mission.id]
        );
        assert.deepEqual(
          deliveries.map(row => row.objective_id),
          [first!.id, second.id]
        );

        const { publishDeliverySummary } =
          await import('../packages/core/service/delivery-summary-publication.ts');
        const published = await publishDeliverySummary({
          ctx,
          missionId: mission.id,
          deliveryId: stale.deliveryId,
          sessionKey: b.sessionKey,
          operationId: 'publish-b-conformance',
          narrative: {
            baseContentRevision: stale.missionSummary!.baseline!.contentRevision,
            baseEvidenceRevision: stale.missionSummary!.baseline!.evidenceRevision,
            headline: 'A and B landed.',
            summary: 'Both are tested.'
          }
        });
        assert.equal(published.contentRevision, 2);

        const summary = (await getMissionSummary(mission.id)).summary!;
        assert.equal(summary.status, 'composed');
        assert.deepEqual(summary.author, {
          kind: 'agent',
          objectiveId: second.id,
          deliveryId: stale.deliveryId
        });
        assert.equal(summary.headline, 'A and B landed.');
        const closed = summary.closedItems.find(item => item.id === risk);
        assert.equal(closed?.reason, 'Batched in B.');
        assert.equal(closed?.resolvedBy?.kind, 'agent');
        assert.equal((await getMissionSummary(mission.id)).narrative?.state, 'current');

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
