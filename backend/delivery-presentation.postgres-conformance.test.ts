import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  persistDeliveryPresentation,
  readDeliveryComposeContext
} from '../packages/core/service/delivery-presentation.ts';
import { buildDeliveryReport } from '../packages/core/service/delivery-report.ts';

import {
  bindWebappDatabaseClient,
  conformanceAdapters,
  createConformanceDatabase
} from './test-helpers.ts';

for (const adapter of conformanceAdapters()) {
  describe(`delivery presentation service [${adapter}]`, () => {
    it('loads compose evidence, ignores a lost CAS, and triggers summary only for a committed presentation', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'delivery_present');
      try {
        await bindWebappDatabaseClient({ client: db });
        const { createProject, createMission } = await import('./repository.ts');
        const project = await createProject({ name: `Presentation ${adapter}` });
        const mission = await createMission({
          projectId: project.id,
          firstObjective: 'Compose a persisted delivery.'
        });
        const objective = mission.objectives[0]!;
        const report = buildDeliveryReport({
          summary: 'Original delivery summary.',
          deliveryReport: { schemaVersion: 1, agentReport: { knownRisks: ['A bounded risk.'] } }
        });
        const stamp = new Date().toISOString();
        await db.run(
          `INSERT INTO deliveries (
             id, workspace_id, project_id, mission_id, objective_id, summary,
             payload_json, delivered_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `delivery-${adapter}`,
            mission.workspaceId,
            project.id,
            mission.id,
            objective.id,
            'Original delivery summary.',
            JSON.stringify({ deliveryReport: report }),
            stamp,
            stamp,
            stamp
          ]
        );

        const context = await readDeliveryComposeContext(db, `delivery-${adapter}`);
        assert.ok(context);
        assert.equal(context.report.agentReport.knownRisks[0], 'A bounded risk.');
        assert.deepEqual(context.objective.instruction, 'Compose a persisted delivery.');
        assert.deepEqual(context.filePaths, []);
        assert.deepEqual(context.plannedObjectives, []);
        const resolveChangeAttribution = async () => ({
          actorWorkspaceUserId: null,
          actorTokenId: null,
          source: 'webapp'
        });

        const pending = {
          ...report,
          presentation: { ...report.presentation, status: 'pending' as const }
        };
        await persistDeliveryPresentation({
          db,
          delivery: { ...context.delivery, revision: context.delivery.revision - 1 },
          nextReport: pending,
          changedFields: ['payload_json', 'presentation'],
          resolveChangeAttribution: async () => {
            assert.fail('a lost CAS must not resolve or emit a change');
          }
        });
        assert.equal(
          await db.get('SELECT mission_id FROM mission_summaries WHERE mission_id = ?', [
            mission.id
          ]),
          undefined,
          'a lost compare-and-swap does not trigger summary composition'
        );
        assert.equal(
          await db.get(
            `SELECT seq FROM entity_changes WHERE entity_type = 'delivery' AND entity_id = ?`,
            [`delivery-${adapter}`]
          ),
          undefined,
          'a lost compare-and-swap does not emit a delivery change'
        );
        assert.deepEqual(
          (await readDeliveryComposeContext(db, context.delivery.id))!.delivery,
          context.delivery,
          'a lost CAS leaves the delivery unchanged'
        );

        await assert.rejects(
          persistDeliveryPresentation({
            db,
            delivery: context.delivery,
            nextReport: pending,
            changedFields: ['payload_json', 'presentation'],
            resolveChangeAttribution: async () => {
              throw new Error('attribution failed');
            }
          }),
          /attribution failed/
        );
        assert.deepEqual(
          (await readDeliveryComposeContext(db, context.delivery.id))!.delivery,
          context.delivery,
          'a change-feed failure rolls back the presentation'
        );

        await persistDeliveryPresentation({
          db,
          delivery: context.delivery,
          nextReport: pending,
          changedFields: ['payload_json', 'presentation'],
          resolveChangeAttribution
        });
        assert.equal(
          await db.get('SELECT mission_id FROM mission_summaries WHERE mission_id = ?', [
            mission.id
          ]),
          undefined,
          'a committed pending presentation does not trigger summary'
        );

        const current = await readDeliveryComposeContext(db, `delivery-${adapter}`);
        assert.ok(current);
        const fallback = {
          ...report,
          presentation: { ...report.presentation, status: 'fallback' as const }
        };
        await persistDeliveryPresentation({
          db,
          delivery: current.delivery,
          nextReport: fallback,
          changedFields: ['payload_json', 'presentation'],
          resolveChangeAttribution
        });
        assert.ok(
          await db.get('SELECT mission_id FROM mission_summaries WHERE mission_id = ?', [
            mission.id
          ]),
          'a committed fallback presentation triggers summary composition'
        );
        const change = await db.get<{ changed_fields_json: string; source: string }>(
          `SELECT changed_fields_json, source FROM entity_changes
            WHERE entity_type = 'delivery' AND entity_id = ? ORDER BY seq DESC LIMIT 1`,
          [`delivery-${adapter}`]
        );
        assert.deepEqual(JSON.parse(change!.changed_fields_json), ['payload_json', 'presentation']);
        assert.equal(change!.source, 'webapp');
        const presented = (await readDeliveryComposeContext(db, context.delivery.id))!;
        const before = await db.get<{ requested_generation: number }>(
          'SELECT requested_generation FROM mission_summaries WHERE mission_id = ?',
          [mission.id]
        );
        await persistDeliveryPresentation({
          db,
          delivery: presented.delivery,
          nextReport: { ...report, presentation: { ...report.presentation, status: 'composed' } },
          changedFields: ['payload_json', 'presentation'],
          resolveChangeAttribution
        });
        const after = await db.get<{ requested_generation: number }>(
          'SELECT requested_generation FROM mission_summaries WHERE mission_id = ?',
          [mission.id]
        );
        assert.equal(
          after!.requested_generation,
          before!.requested_generation + 1,
          'a committed composed presentation requests a new summary generation'
        );
      } finally {
        await cleanup();
      }
    });
  });
}
