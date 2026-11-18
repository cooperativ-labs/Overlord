import type { DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bindWebappDatabaseClient, createConformanceDatabase } from './test-helpers.ts';

/** Agent delivery takes the summary lock before closing an item. Operator
 * resolution must use the same order, or concurrent writers deadlock on PG. */
test(
  'operator resolution and agent summary use the same lock order [postgres]',
  {
    skip: !process.env.TEST_DATABASE_URL,
    timeout: 15_000
  },
  async () => {
    const { db, cleanup } = await createConformanceDatabase('postgres', 'ovld_summary_lock');
    try {
      await bindWebappDatabaseClient({ client: db });
      const { createProject } = await import('./repository.ts');
      const { buildWebappServiceContext } = await import('./db.ts');
      const { recordWork } = await import('../packages/core/service/protocol.ts');
      const { closeMissionItemAsPerson } = await import('./mission-item-resolutions.ts');
      const { prepareMissionSummaryWrite, applyMissionSummaryWrite, parseMissionSummaryInput } =
        await import('../packages/core/service/mission-summary-agent.ts');
      const project = await createProject({ name: 'Lock order' });
      const ctx = buildWebappServiceContext();
      const recorded = await recordWork({
        ctx,
        projectId: project.id,
        objective: 'Verify locks',
        summary: 'Initial report.',
        payloadJson: {
          deliveryReport: { schemaVersion: 1, agentReport: { knownRisks: ['Concurrent writes.'] } }
        },
        missionSummary: { headline: 'Initial narrative.', summary: 'Local verification.' }
      });
      const item = (await db.get<{ id: string; objective_id: string }>(
        'SELECT id, objective_id FROM mission_items WHERE mission_id = ?',
        [recorded.mission.id]
      ))!;
      let reached!: () => void;
      const atSummary = new Promise<void>(resolve => {
        reached = resolve;
      });
      let release!: () => void;
      const agentHasLock = new Promise<void>(resolve => {
        release = resolve;
      });
      let intercepted = false;
      function intercept(client: DatabaseClient): DatabaseClient {
        return new Proxy(client, {
          get(target, key) {
            if (key === 'transaction')
              return (fn: (tx: DatabaseClient) => Promise<unknown>) =>
                target.transaction(tx => fn(intercept(tx)));
            if (key === 'get')
              return async (sql: string, params?: unknown[]) => {
                if (
                  !intercepted &&
                  (sql.includes('FROM mission_summaries') || sql.includes('FROM missions')) &&
                  sql.includes('FOR UPDATE')
                ) {
                  intercepted = true;
                  reached();
                  await agentHasLock;
                }
                return target.get(sql, params);
              };
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
      }
      await bindWebappDatabaseClient({ client: intercept(db) });
      const person = closeMissionItemAsPerson({
        itemId: item.id,
        workspaceId: project.workspaceId,
        workspaceUserId: 'operator-workspace-user',
        status: 'done',
        reason: 'Verified by person.'
      });
      // Attach rejection handlers immediately while the deliberate interleaving runs.
      const personResult = person.then(
        () => null,
        error => error
      );
      await atSummary;
      const agent = db.transaction(async tx => {
        const { lockMissionObjectiveQueue } =
          await import('../packages/core/service/objective-queue.ts');
        await lockMissionObjectiveQueue(tx, recorded.mission.id);
        const mission = {
          id: recorded.mission.id,
          workspaceId: project.workspaceId,
          projectId: project.id
        };
        const input = parseMissionSummaryInput(
          {
            baseContentRevision: 1,
            baseEvidenceRevision: 1,
            headline: 'Verified narrative.',
            summary: 'Concurrent verification.',
            closeItems: [{ id: item.id, status: 'done', reason: 'Verified by agent.' }]
          },
          { requireBase: true }
        )!;
        const prepared = await prepareMissionSummaryWrite(tx, {
          mission,
          input,
          mode: 'deliver'
        }).finally(release);
        await applyMissionSummaryWrite(tx, {
          prepared,
          mission,
          objectiveId: item.objective_id,
          // The lock order is what matters here; no second publication row.
          deliveryId: null,
          model: null,
          attribution: { actorWorkspaceUserId: null, source: 'protocol' }
        });
      });
      const results = await Promise.all([
        personResult,
        agent.then(
          () => null,
          error => error
        )
      ]);
      assert.deepEqual(results, [null, null], 'both writes commit without a deadlock victim');
    } finally {
      await cleanup();
    }
  }
);
