import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bindWebappDatabaseClient,
  conformanceAdapters,
  createConformanceDatabase
} from './test-helpers.ts';

/**
 * Durable draft evidence (coo:1297.c6h4, ADR 0078) behaves identically on both
 * editions. On Postgres the pool has several connections, so concurrent
 * batches, deliveries and replays really race and serialize on the mission
 * lock; sealed immutability is enforced by the database itself.
 */

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

const risk = (entryId: string, text: string) => ({
  op: 'upsert',
  entryId,
  kind: 'known_risk',
  content: { text }
});

for (const adapter of conformanceAdapters()) {
  describe(`durable report drafts [${adapter}]`, () => {
    it('A/B/A replay, concurrent batches, seal, revocation and immutability', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_drafts');
      try {
        await bindWebappDatabaseClient({ client: db });
        const repo = await import('./repository.ts');
        const { buildWebappServiceContext } = await import('./db.ts');
        const { attachSession, deliverSession, updateSession } =
          await import('../packages/core/service/protocol.ts');
        const { listObjectiveReportDrafts, readReportDraft } =
          await import('../packages/core/service/report-draft.ts');

        const ctx = buildWebappServiceContext();
        const project = await repo.createProject({ name: 'Drafts' });
        const mission = await repo.createMission({ projectId: project.id, firstObjective: 'A' });
        const [objective] = mission.objectives;
        const session = await attachSession({
          ctx,
          missionId: mission.id,
          objectiveId: objective!.id
        });
        const base = { ctx, missionId: mission.id, sessionKey: session.sessionKey, summary: '' };

        const batchA = {
          ...base,
          reportDraft: {
            operationId: 'pg-draft-a-001',
            expectedRevision: 0,
            operations: [risk('r1', 'Original')]
          }
        };
        const a = await updateSession(batchA);
        assert.equal(a.reportDraft?.revision, 1);

        // Two batches race on revision 1: exactly one applies, the other gets the fresh draft.
        const race = await Promise.allSettled(
          ['pg-draft-b-001', 'pg-draft-c-001'].map(operationId =>
            updateSession({
              ...base,
              reportDraft: {
                operationId,
                expectedRevision: 1,
                operations: [risk('r1', `Edited by ${operationId}`)]
              }
            })
          )
        );
        const won = race.filter(result => result.status === 'fulfilled');
        const lost = race.filter(result => result.status === 'rejected');
        assert.equal(won.length, 1);
        assert.equal(errorCode((lost[0] as PromiseRejectedResult).reason), 'report_draft_conflict');

        // Concurrent replays of A return A's receipt without writing anything.
        const events = async () =>
          Number(
            (
              await db.get<{ n: number }>(
                `SELECT COUNT(*) AS n FROM mission_events WHERE mission_id = ? AND type = 'update'`,
                [mission.id]
              )
            )?.n
          );
        const before = await events();
        const replays = await Promise.all([updateSession(batchA), updateSession(batchA)]);
        for (const replay of replays) {
          assert.equal(replay.eventId, a.eventId);
          assert.equal(replay.reportDraft?.revision, 1);
          assert.equal(replay.reportDraft?.replayed, true);
        }
        assert.equal(await events(), before);
        const read = await readReportDraft({
          ctx,
          missionId: mission.id,
          sessionKey: session.sessionKey
        });
        assert.equal(read.revision, 2);
        assert.match(
          String((read.draft?.entries[0]?.content as { text: string }).text),
          /^Edited by/
        );

        // Revoked project scope loses even the receipt read.
        const revoked = { ...ctx, allowedProjectIds: [] as string[] };
        await assert.rejects(updateSession({ ...batchA, ctx: revoked }));

        // Deliver and a racing batch serialize: one order wins.
        const settle = await Promise.allSettled([
          deliverSession({
            ctx,
            missionId: mission.id,
            sessionKey: session.sessionKey,
            summary: 'Done.',
            operationId: 'pg-draft-deliver1',
            reportDraft: { expectedRevision: 2 }
          }),
          updateSession({
            ...base,
            reportDraft: {
              operationId: 'pg-draft-d-001',
              expectedRevision: 2,
              operations: [risk('r2', 'Late observation')]
            }
          })
        ]);
        assert.equal(
          settle.filter(result => result.status === 'fulfilled').length,
          1,
          JSON.stringify(settle.map(result => result.status))
        );
        const drafts = await listObjectiveReportDrafts(db, {
          workspaceId: ctx.workspace.id,
          objectiveId: objective!.id
        });
        assert.equal(drafts.length, 1);
        const delivered = settle[0];
        if (delivered.status === 'fulfilled') {
          assert.equal(drafts[0]?.state, 'sealed');
          assert.equal(drafts[0]?.sealedDeliveryId, delivered.value.deliveryId);
          // A lost deliver response replays the sealed result; nothing reseals.
          const replay = await deliverSession({
            ctx,
            missionId: mission.id,
            sessionKey: session.sessionKey,
            summary: 'Done.',
            operationId: 'pg-draft-deliver1',
            reportDraft: { expectedRevision: 2 }
          });
          assert.equal(replay.replayed, true);
          assert.deepEqual(replay.reportDraft, delivered.value.reportDraft);
          // The database refuses any change to a sealed draft.
          await assert.rejects(
            db.run(`UPDATE delivery_report_draft_entries SET withdrawn_reason = 'x'`, [])
          );
          await assert.rejects(
            db.run(`UPDATE delivery_report_drafts SET revision = revision + 1`, [])
          );
          await assert.rejects(
            db.run(`UPDATE delivery_report_draft_batches SET result_revision = 9`, [])
          );
          // Mission items come only from the accepted delivery.
          const items = await db.all<{ delivery_id: string }>(
            `SELECT delivery_id FROM mission_items WHERE mission_id = ?`,
            [mission.id]
          );
          assert.ok(items.every(item => item.delivery_id === delivered.value.deliveryId));
        } else {
          assert.equal(drafts[0]?.state, 'open');
          assert.equal(drafts[0]?.revision, 3);
        }
      } finally {
        await cleanup();
      }
    });
  });
}
